import type { createAdminClient } from "@/lib/supabase/admin";
import { enviarWhatsApp } from "@/lib/notificacoes";

/**
 * A central de avisos.
 *
 * Duas saídas, as duas gravadas no banco antes de qualquer coisa:
 *
 *   MENSAGEM  WhatsApp para fora (corretor, comprador, vendedor). Nasce na
 *             tabela `mensagem` como `pendente` e só depois sai. Se a uazapi
 *             falhar, a falha fica registrada, vira aviso no sino e é tentada
 *             de novo pela rotina — ou pelo botão em Avisos.
 *
 *   AVISO     o sino do painel da Trilha.
 *
 * A `chave` de cada mensagem é o que impede duplicidade: aceitar uma proposta
 * duas vezes (clique duplo, tela antiga) gera a mesma chave, e a segunda vez
 * é ignorada pelo banco.
 *
 * Este arquivo NÃO é "use server" de propósito: nada aqui confere quem chama.
 * Quem usa (actions, rotas) confere antes e passa a chave de servidor.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type Papel = "comprador" | "corretor" | "vendedor" | "trilha";

export type NovaMensagem = {
  chave: string;
  destino: string;
  destinatario: string;
  papel: Papel;
  assunto: string;
  texto: string;
  propostaId?: string | null;
  negocioId?: string | null;
};

export type NovoAviso = {
  /** Opcional: quando vem, o mesmo aviso não entra duas vezes no sino. */
  chave?: string;
  tipo: string;
  gravidade?: "info" | "atencao" | "problema";
  titulo: string;
  texto?: string;
  link?: string;
  /**
   * Destinatário. Sem nenhum dos dois, o aviso é da Trilha. Com um deles, vai
   * para o sino daquela incorporadora (ou PF) ou daquele corretor — e só ele
   * lê (`avisos-3-sino-por-pessoa.sql`).
   */
  incorporadoraId?: string | null;
  parceiroId?: string | null;
};

/** Tentativas automáticas (a primeira na hora + as da rotina). */
export const MAX_TENTATIVAS = 3;

/** Só os dígitos: a parte da chave que identifica o destino. */
export const digitosDe = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

// ------------------------------------------------------------------- aviso

export async function criarAviso(admin: Admin, aviso: NovoAviso): Promise<void> {
  const linha = {
    chave: aviso.chave ?? null,
    tipo: aviso.tipo,
    gravidade: aviso.gravidade ?? "info",
    titulo: aviso.titulo.slice(0, 300),
    texto: aviso.texto?.slice(0, 4000) ?? null,
    link: aviso.link ?? null,
    // Só quando há destinatário: assim o aviso da Trilha não depende das
    // colunas novas existirem (código publicado antes do SQL continua avisando).
    ...(aviso.incorporadoraId ? { incorporadora_id: aviso.incorporadoraId } : {}),
    ...(aviso.parceiroId ? { parceiro_id: aviso.parceiroId } : {}),
  };

  const { error } = aviso.chave
    ? await admin.from("aviso").upsert(linha, { onConflict: "chave", ignoreDuplicates: true })
    : await admin.from("aviso").insert(linha);

  // O aviso é o recado sobre um problema; ele mesmo falhar não pode virar outro.
  if (error) console.error("[avisos] aviso não gravado:", error.message, aviso.titulo);
}

// ---------------------------------------------------------------- mensagens

/**
 * Grava as mensagens na fila. Devolve os ids das que nasceram AGORA — as
 * que já existiam (mesma chave) ficam de fora e não saem de novo.
 */
export async function enfileirar(admin: Admin, mensagens: NovaMensagem[]): Promise<string[]> {
  const validas = mensagens.filter((m) => m.destino && m.texto);
  if (validas.length === 0) return [];

  const { data, error } = await admin
    .from("mensagem")
    .upsert(
      validas.map((m) => ({
        chave: m.chave,
        destino: m.destino,
        destinatario: m.destinatario,
        papel: m.papel,
        assunto: m.assunto,
        texto: m.texto,
        proposta_id: m.propostaId ?? null,
        negocio_id: m.negocioId ?? null,
      })),
      { onConflict: "chave", ignoreDuplicates: true },
    )
    .select("id");

  if (error) {
    console.error("[avisos] fila não gravou:", error.message);
    return [];
  }
  return (data ?? []).map((d: { id: string }) => d.id);
}

type LinhaMensagem = {
  id: string;
  destino: string;
  destinatario: string | null;
  assunto: string;
  texto: string;
  status: string;
  tentativas: number;
  proposta_id: string | null;
  negocio_id: string | null;
};

export type ResultadoEnvio = { id: string; ok: boolean; erro?: string };

/** Erros em que repetir não adianta: falta configuração ou o número é ruim. */
const ehDefinitivo = (erro: string) => /inválido|não configurad/i.test(erro);

/**
 * Manda UMA mensagem da fila.
 *
 * A trava é o update condicional: só quem consegue mudar o status para
 * `enviando` manda. Duas rotinas (ou a rotina e o botão) ao mesmo tempo não
 * mandam a mesma mensagem duas vezes.
 */
export async function enviarMensagem(admin: Admin, id: string, opcoes: { manual?: boolean } = {}): Promise<ResultadoEnvio> {
  const { data: m } = await admin
    .from("mensagem")
    .select("id, destino, destinatario, assunto, texto, status, tentativas, proposta_id, negocio_id")
    .eq("id", id)
    .maybeSingle<LinhaMensagem>();

  if (!m) return { id, ok: false, erro: "mensagem não encontrada" };
  if (m.status === "enviada") return { id, ok: true };
  if (m.status === "enviando") return { id, ok: false, erro: "já está sendo enviada" };
  if (!opcoes.manual && m.tentativas >= MAX_TENTATIVAS) return { id, ok: false, erro: "tentativas esgotadas" };

  const { data: travada } = await admin
    .from("mensagem")
    .update({ status: "enviando", tentativas: m.tentativas + 1 })
    .eq("id", id)
    .eq("status", m.status)
    .eq("tentativas", m.tentativas)
    .select("id")
    .maybeSingle();

  if (!travada) return { id, ok: false, erro: "outra rotina pegou esta mensagem" };

  const r = await enviarWhatsApp(m.destino, m.texto);

  if (r.ok) {
    await admin
      .from("mensagem")
      .update({ status: "enviada", enviada_em: new Date().toISOString(), erro: null, definitivo: false })
      .eq("id", id);
    return { id, ok: true };
  }

  const definitivo = ehDefinitivo(r.erro);
  await admin.from("mensagem").update({ status: "falhou", erro: r.erro.slice(0, 1000), definitivo }).eq("id", id);

  // Um aviso por mensagem, na primeira falha. As tentativas seguintes não
  // repetem o aviso (a chave é a mesma).
  const vaiTentarDeNovo = !definitivo && m.tentativas + 1 < MAX_TENTATIVAS;
  await criarAviso(admin, {
    chave: `mensagem-falhou:${id}`,
    tipo: "mensagem_falhou",
    gravidade: "problema",
    titulo: `WhatsApp não saiu: ${m.assunto} → ${m.destinatario ?? m.destino}`,
    texto: `${r.erro}${vaiTentarDeNovo ? "\nO sistema tenta de novo na próxima rotina; dá para reenviar agora em Avisos → Mensagens." : "\nConfira o telefone no cadastro e reenvie em Avisos → Mensagens."}`,
    link: "/avisos?aba=mensagens",
  });

  return { id, ok: false, erro: r.erro };
}

/** Manda várias em paralelo — o caso de um evento com três ou quatro pontas. */
export async function despachar(admin: Admin, ids: string[]): Promise<ResultadoEnvio[]> {
  return Promise.all(ids.map((id) => enviarMensagem(admin, id)));
}

/**
 * A varredura da rotina: o que ficou pendente ou falhou e ainda tem
 * tentativa. Uma de cada vez, até o prazo.
 *
 * `enviando` há mais de 15 minutos é envio interrompido no meio (a função
 * caiu). Volta para a fila: uma mensagem repetida incomoda menos do que
 * uma que nunca chega.
 */
export async function varrerFila(admin: Admin, ate: number) {
  const quinzeMinAtras = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: presas } = await admin
    .from("mensagem")
    .update({ status: "falhou", erro: "envio interrompido; nova tentativa" })
    .eq("status", "enviando")
    .lt("updated_at", quinzeMinAtras)
    .select("id");

  const { data: fila } = await admin
    .from("mensagem")
    .select("id")
    .or("status.eq.pendente,and(status.eq.falhou,definitivo.eq.false)")
    .lt("tentativas", MAX_TENTATIVAS)
    .order("created_at")
    .limit(50);

  const resumo = { destravadas: presas?.length ?? 0, enviadas: 0, falhas: 0, interrompidaPorTempo: false };

  for (const { id } of (fila ?? []) as { id: string }[]) {
    // Cada envio leva até 10s; só começa um novo se ele cabe no prazo.
    if (Date.now() + 11_000 > ate) {
      resumo.interrompidaPorTempo = true;
      break;
    }
    const r = await enviarMensagem(admin, id);
    if (r.ok) resumo.enviadas += 1;
    else resumo.falhas += 1;
  }

  return resumo;
}
