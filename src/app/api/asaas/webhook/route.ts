import { timingSafeEqual } from "node:crypto";
import { NextResponse, after, type NextRequest } from "next/server";
import { avisarDonoDoRepasse, ehProblemaDeChave } from "@/lib/chave-pix";
import { despachar } from "@/lib/avisos";
import { createAdminClient } from "@/lib/supabase/admin";
import { criarAviso } from "@/lib/avisos";
import { formatBRL } from "@/lib/br";
import { rotuloParcela } from "@/lib/jornada";

/**
 * Os avisos do Asaas: `POST /api/asaas/webhook`.
 *
 * Rota PÚBLICA (o Asaas não tem sessão), então a única porta é o token
 * secreto: ele é cadastrado no Asaas junto com a URL e vem em todo aviso no
 * cabeçalho `asaas-access-token`. Sem ele, ou diferente, nada é lido.
 *
 * Toda a regra mora no banco (`asaas_processar_evento`, Parte 3): gravar,
 * ignorar repetido, dar baixa — numa transação só. Aqui é só a porta.
 *
 * Respostas, e por quê:
 *   401  token errado            o Asaas não deve insistir num endereço errado
 *   400  corpo que não é JSON    idem
 *   500  banco fora do ar        o aviso NÃO foi gravado: o Asaas reenvia
 *   200  todo o resto            inclusive erro de processamento — o aviso já
 *                                está gravado com o motivo, e responder erro
 *                                faria o Asaas reenviar em loop até pausar a
 *                                fila (15 falhas seguidas).
 */
export const dynamic = "force-dynamic";

function tokenConfere(recebido: string | null): boolean {
  const esperado = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!esperado || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!process.env.ASAAS_WEBHOOK_TOKEN) {
    console.error("[asaas] ASAAS_WEBHOOK_TOKEN não configurado: aviso recusado.");
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  if (!tokenConfere(request.headers.get("asaas-access-token"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let evento: unknown;
  try {
    evento = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: "corpo inválido" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("asaas_processar_evento", {
    p_evento: evento,
  });

  if (error) {
    console.error("[asaas] aviso não gravado:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  if (data === "erro") {
    console.error("[asaas] aviso gravado com erro de processamento:", (evento as { id?: string })?.id);
  }

  // O sino: o aviso já foi processado; isto só conta para a equipe.
  await avisarNoSino(admin, String(data), evento as EventoAsaas).catch((e) =>
    console.error("[asaas] aviso do sino não gravado:", e),
  );

  return NextResponse.json({ ok: true, resultado: data });
}

type EventoAsaas = {
  id?: string;
  event?: string;
  payment?: { id?: string; value?: number };
  transfer?: { id?: string; value?: number; failReason?: string };
};

type Admin = ReturnType<typeof createAdminClient>;

/**
 * O que do Asaas vale aparecer no sino. Repetido não entra (a chave é o id do
 * evento, e o Asaas reenvia com o mesmo id).
 */
async function avisarNoSino(admin: Admin, resultado: string, evento: EventoAsaas) {
  const chave = evento.id ? `asaas:${evento.id}` : undefined;

  if (resultado === "erro") {
    await criarAviso(admin, {
      chave,
      tipo: "asaas",
      gravidade: "problema",
      titulo: `Aviso do Asaas não processado (${evento.event ?? "?"})`,
      texto: "Ficou gravado com o motivo na tabela asaas_evento. Conferir.",
    });
    return;
  }

  if (resultado.startsWith("transferencia_")) {
    if (resultado === "transferencia_situacao") return;
    const { data: lote } = await admin
      .from("repasse_lote")
      .select("id, nome_beneficiario, valor")
      .eq("asaas_transferencia_id", evento.transfer?.id ?? "")
      .maybeSingle<{ id: string; nome_beneficiario: string | null; valor: number }>();
    const quem = `${lote?.nome_beneficiario ?? "beneficiário"} · ${formatBRL(Number(lote?.valor ?? evento.transfer?.value ?? 0))}`;
    const falhou = resultado === "transferencia_falhou";
    await criarAviso(admin, {
      chave,
      tipo: "repasse",
      gravidade: falhou ? "problema" : "info",
      titulo: falhou ? `Pix de repasse falhou: ${quem}` : `Pix de repasse concluído: ${quem}`,
      texto: falhou ? (evento.transfer?.failReason ?? "Corrigir e tentar de novo em Repasses.") : undefined,
      link: falhou ? "/repasses?aba=problema" : "/repasses?aba=concluidos",
    });
    // O banco recusou depois de aceitar o pedido (chave que não existe, por
    // exemplo): se foi a chave, o dono também fica sabendo.
    if (falhou && lote && ehProblemaDeChave(evento.transfer?.failReason)) {
      const ids = await avisarDonoDoRepasse(admin, lote.id, "recusada");
      if (ids.length) after(() => despachar(admin, ids));
    }
    return;
  }

  if (!["baixa", "apagada", "alerta"].includes(resultado)) return;

  const { data: parcela } = await admin
    .from("parcela")
    .select("numero, negocio_id, cobranca_erro, negocio (imovel (identificacao))")
    .eq("asaas_cobranca_id", evento.payment?.id ?? "")
    .maybeSingle<{
      numero: number;
      negocio_id: string;
      cobranca_erro: string | null;
      negocio: { imovel: { identificacao: string } | null } | null;
    }>();

  const qual = parcela
    ? `${rotuloParcela(parcela.numero)} · ${parcela.negocio?.imovel?.identificacao ?? "unidade"}`
    : "parcela";
  const link = parcela ? `/trilhas/${parcela.negocio_id}` : undefined;

  if (resultado === "baixa") {
    await criarAviso(admin, {
      chave,
      tipo: "cobranca",
      titulo: `Pagamento recebido: ${qual}`,
      texto: evento.payment?.value ? formatBRL(evento.payment.value) : undefined,
      link,
    });
  } else {
    await criarAviso(admin, {
      chave,
      tipo: "cobranca",
      gravidade: resultado === "alerta" ? "problema" : "atencao",
      titulo: resultado === "alerta" ? `Estorno ou contestação no Asaas: ${qual}` : `Cobrança apagada no Asaas: ${qual}`,
      texto: parcela?.cobranca_erro ?? evento.event,
      link,
    });
  }
}
