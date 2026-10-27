/**
 * Enviar um lote de repasse ao Asaas — a regra, sem a porta.
 *
 * Fora de `app/actions` de propósito (lá, toda função exportada vira endpoint
 * público). Quem chama confere antes: a rotina, o segredo do cron; o botão, a
 * sessão de admin.
 *
 * A REGRA DE OURO: PAGAR DUAS VEZES É PIOR DO QUE ATRASAR.
 *
 *   1. TRAVA. O lote só sai de "preparado"/"falhou" para "enviando" numa
 *      escrita condicional. Se outra execução chegou antes, esta desiste.
 *   2. CHAVE. Lida AGORA do cadastro. Sem chave, ou em formato que não dá
 *      para reconhecer: "falhou", sem nem chamar o Asaas.
 *   3. PEDIDO. O Asaas respondeu:
 *        sim        → "enviado" (esperando a aprovação por SMS)
 *        recusou    → "falhou" com o motivo (4xx: certeza de que não criou)
 *        sem certeza (rede caiu, 5xx) → "verificar": uma PESSOA confere no
 *                     Asaas se a transferência existe antes de nova tentativa.
 *      Nada sai de "verificar" sozinho.
 */

import type { createAdminClient } from "@/lib/supabase/admin";
import { ErroAsaas, criarTransferencia, tipoDaChave, type AmbienteAsaas } from "@/lib/asaas";
import { avisarDonoDoRepasse, ehProblemaDeChave } from "@/lib/chave-pix";

type Admin = ReturnType<typeof createAdminClient>;

export type ResultadoEnvio =
  | { ok: true; transferenciaId: string; valor: number; nome: string }
  | { ok: false; situacao: "falhou" | "verificar" | "indisponivel"; erro: string; nome?: string; valor?: number };

type Lote = {
  id: string;
  status: string;
  valor: number;
  tentativas: number;
  historico: unknown[];
  asaas_transferencia_id: string | null;
  erro: string | null;
  data_ref: string;
};

const mesAno = (iso: string) => {
  const [a, m] = iso.split("-");
  return `${m}/${a}`;
};

export async function enviarLote(admin: Admin, loteId: string, ambiente: AmbienteAsaas): Promise<ResultadoEnvio> {
  const { data: lote } = await admin
    .from("repasse_lote")
    .select("id, status, valor, tentativas, historico, asaas_transferencia_id, erro, data_ref")
    .eq("id", loteId)
    .maybeSingle<Lote>();

  if (!lote) return { ok: false, situacao: "indisponivel", erro: "Lote não encontrado." };

  // ----------------------------------------------------------------- 1. trava
  const historico = [
    ...(Array.isArray(lote.historico) ? lote.historico : []),
    ...(lote.tentativas > 0
      ? [{ tentativa: lote.tentativas, transferencia: lote.asaas_transferencia_id, erro: lote.erro, em: new Date().toISOString() }]
      : []),
  ];

  const { data: travado } = await admin
    .from("repasse_lote")
    .update({
      status: "enviando",
      tentativas: lote.tentativas + 1,
      historico,
      asaas_transferencia_id: null,
      erro: null,
    })
    .eq("id", loteId)
    .in("status", ["preparado", "falhou"])
    .select("id")
    .maybeSingle<{ id: string }>();

  if (!travado) {
    return {
      ok: false,
      situacao: "indisponivel",
      erro: "Este lote não está disponível para envio (já foi enviado, está sendo enviado ou aguarda verificação).",
    };
  }

  const falhar = async (situacao: "falhou" | "verificar", erro: string, nome?: string) => {
    await admin.from("repasse_lote").update({ status: situacao, erro }).eq("id", loteId);
    await admin
      .from("repasse")
      .update({ status: "falhou", erro: situacao === "verificar" ? "verificar no Asaas" : "ver o lote" })
      .eq("lote_id", loteId);
    return { ok: false as const, situacao, erro, nome, valor: Number(lote.valor) };
  };

  // ----------------------------------------------------------------- 2. chave
  const { data: chaves, error: erroChave } = await admin.rpc("chave_pix_do_lote", { p_lote: loteId });
  const k = (chaves as { nome: string | null; chave: string | null; tipo: string | null }[] | null)?.[0];

  if (erroChave || !k) return falhar("falhou", "Não encontrei o beneficiário deste lote.");

  const nome = k.nome ?? "beneficiário";
  // Problema de chave é o único que o dono resolve: ele também é avisado
  // (WhatsApp na fila; sai na varredura das 10h).
  if (!k.chave) {
    const r = await falhar("falhou", `${nome} não tem chave Pix cadastrada. Cadastre e tente de novo.`, nome);
    await avisarDonoDoRepasse(admin, loteId, "sem_chave");
    return r;
  }

  const tipo = tipoDaChave(k.chave, k.tipo);
  if (!tipo) {
    const r = await falhar("falhou", `A chave Pix de ${nome} ("${k.chave}") está num formato que não reconheço. Corrija no cadastro.`, nome);
    await avisarDonoDoRepasse(admin, loteId, "formato");
    return r;
  }

  const { count } = await admin
    .from("repasse")
    .select("id", { count: "exact", head: true })
    .eq("lote_id", loteId);

  // ---------------------------------------------------------------- 3. pedido
  try {
    const t = await criarTransferencia(ambiente, {
      valor: Number(lote.valor),
      chave: k.chave,
      tipo,
      descricao: `Trilha · repasse ${mesAno(lote.data_ref)} · ${count ?? 1} parcela(s)`,
      referencia: loteId,
    });

    const agora = new Date().toISOString();
    const { error } = await admin
      .from("repasse_lote")
      .update({
        status: "enviado",
        asaas_transferencia_id: t.id,
        asaas_status: t.status,
        nome_beneficiario: nome,
        chave_pix: k.chave,
        chave_pix_tipo: tipo,
        enviado_em: agora,
      })
      .eq("id", loteId);

    if (error) {
      // A transferência EXISTE no Asaas e não ficou registrada aqui: o lote
      // fica "enviando" — nunca será reenviado sozinho.
      console.error("[repasse] transferência criada mas não registrada:", loteId, t.id, error);
      return { ok: false, situacao: "verificar", erro: `Transferência ${t.id} criada no Asaas, mas não registrada no painel. Avise o suporte.`, nome };
    }

    await admin
      .from("repasse")
      .update({ status: "enviado", enviado_em: agora, chave_pix: k.chave, chave_pix_tipo: tipo, erro: null })
      .eq("lote_id", loteId);

    return { ok: true, transferenciaId: t.id, valor: Number(lote.valor), nome };
  } catch (e) {
    if (e instanceof ErroAsaas && e.status !== undefined && e.status >= 400 && e.status < 500) {
      const r = await falhar("falhou", e.message, nome);
      // Saldo, limite e afins são da Trilha: o dono não é incomodado.
      if (ehProblemaDeChave(e.message)) await avisarDonoDoRepasse(admin, loteId, "recusada");
      return r;
    }
    console.error("[repasse] resposta incerta do Asaas:", loteId, e);
    return falhar(
      "verificar",
      "Não tive resposta clara do Asaas. Confira no Asaas se esta transferência existe antes de tentar de novo.",
      nome,
    );
  }
}
