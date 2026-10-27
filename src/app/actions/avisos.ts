"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ehAdmin, getSessao } from "@/lib/sessao";
import { enviarMensagem } from "@/lib/avisos";

/**
 * O sino e a tela de Avisos.
 *
 * O sino é de todo mundo desde out/2026: cada um vê os avisos que são dele
 * (incorporadora, PF, corretor), e a Trilha os dela. Quem vê o quê é regra do
 * BANCO (`avisos-3-sino-por-pessoa.sql`): a leitura é pela sessão e só volta
 * o que a pessoa pode ler. A Trilha lê todos, então o sino dela filtra os sem
 * destinatário. A tela de Avisos e o reenvio continuam só da Trilha.
 *
 * ESCRITA pela chave de servidor, depois da conferência — ninguém escreve
 * nessas tabelas pela sessão.
 */

export type AvisoDoSino = {
  id: string;
  titulo: string;
  texto: string | null;
  gravidade: "info" | "atencao" | "problema";
  link: string | null;
  created_at: string;
  lido: boolean;
};

export type ResumoSino = { naoLidos: number; recentes: AvisoDoSino[] };

/** Até onde o sino olha. Aviso mais antigo que isso não conta como novo. */
const JANELA = 100;

/**
 * Os avisos que o sino desta pessoa mostra. Pela SESSÃO: para quem não é da
 * Trilha, o banco só devolve os dele. Para a Trilha, que lê tudo, o filtro
 * deixa só os avisos da Trilha.
 */
async function avisosDoSino(supabase: Awaited<ReturnType<typeof createClient>>, daTrilha: boolean) {
  let consulta = supabase
    .from("aviso")
    .select("id, titulo, texto, gravidade, link, created_at")
    .order("created_at", { ascending: false })
    .limit(JANELA);
  if (daTrilha) consulta = consulta.is("incorporadora_id", null).is("parceiro_id", null);
  const { data } = await consulta.returns<Omit<AvisoDoSino, "lido">[]>();
  return data ?? [];
}

export async function resumoDoSino(): Promise<ResumoSino | null> {
  const sessao = await getSessao();
  if (!sessao?.conta || !sessao.conta.ativo) return null;

  const supabase = await createClient();
  const lista = await avisosDoSino(supabase, ehAdmin(sessao));
  if (lista.length === 0) return { naoLidos: 0, recentes: [] };

  const { data: lidos } = await supabase
    .from("aviso_lido")
    .select("aviso_id")
    .eq("conta_id", sessao!.usuarioId)
    .in(
      "aviso_id",
      lista.map((a) => a.id),
    );

  const jaLidos = new Set((lidos ?? []).map((l: { aviso_id: string }) => l.aviso_id));
  const comLeitura = lista.map((a) => ({ ...a, lido: jaLidos.has(a.id) }));

  return {
    naoLidos: comLeitura.filter((a) => !a.lido).length,
    recentes: comLeitura.slice(0, 8),
  };
}

/** Sem ids: marca como lido tudo o que o sino mostra. */
export async function marcarAvisosLidos(ids?: string[]): Promise<void> {
  const sessao = await getSessao();
  if (!sessao?.conta || !sessao.conta.ativo) return;

  // Só marca o que a pessoa enxerga: a lista vem pela sessão, e os ids
  // recebidos são cruzados com ela.
  const visiveis = (await avisosDoSino(await createClient(), ehAdmin(sessao))).map((a) => a.id);
  const alvo = ids ? ids.filter((id) => visiveis.includes(id)) : visiveis;
  if (alvo.length === 0) return;

  const admin = createAdminClient();
  await admin
    .from("aviso_lido")
    .upsert(
      alvo.map((aviso_id) => ({ aviso_id, conta_id: sessao!.usuarioId })),
      { onConflict: "aviso_id,conta_id", ignoreDuplicates: true },
    );

  revalidatePath("/avisos");
}

export type ResultadoReenvio = { ok: true; mensagem: string } | { ok: false; erro: string };

/** Botão "reenviar" de uma mensagem que falhou. */
export async function reenviarMensagem(id: string): Promise<ResultadoReenvio> {
  if (!ehAdmin(await getSessao())) return { ok: false, erro: "Só a Trilha reenvia mensagens." };

  const r = await enviarMensagem(createAdminClient(), id, { manual: true });
  revalidatePath("/avisos");
  return r.ok ? { ok: true, mensagem: "Mensagem enviada." } : { ok: false, erro: r.erro ?? "Não saiu." };
}
