"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { empreendimentoSchema } from "@/lib/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { ehAdmin, getSessao, podeEditar } from "@/lib/sessao";

export type Resultado = { id: string; erro: null } | { id: null; erro: string };

/**
 * Junta a explicação amigável com o motivo técnico do banco.
 */
const detalhar = (mensagem: string, erro: { code?: string; message?: string } | null) =>
  erro?.message ? `${mensagem} (${erro.code ?? "sem código"}: ${erro.message})` : mensagem;


export async function criarEmpreendimento(bruto: unknown): Promise<Resultado> {
  const sessao = await getSessao();
  if (!sessao?.conta) {
    return { id: null, erro: "Sessão expirada. Entre de novo." };
  }

  const parsed = empreendimentoSchema.safeParse(bruto);
  if (!parsed.success) {
    return { id: null, erro: "Confira os campos destacados e tente de novo." };
  }

  const { incorporadora_id, nome, endereco } = parsed.data;

  // Incorporadora só cadastra empreendimento para si mesma — a regra também
  // existe no banco, isto aqui é para dar uma mensagem melhor.
  if (!ehAdmin(sessao) && incorporadora_id !== sessao.incorporadoraId) {
    return { id: null, erro: "Você só pode cadastrar empreendimentos da sua incorporadora." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("empreendimento")
    .insert({ incorporadora_id, nome, endereco: endereco || null })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    return { id: null, erro: detalhar("Não foi possível salvar o empreendimento.", error) };
  }

  revalidatePath("/empreendimentos");
  return { id: data.id, erro: null };
}

export async function atualizarEmpreendimento(id: string, bruto: unknown): Promise<Resultado> {
  const sessao = await getSessao();
  if (!sessao?.conta) {
    return { id: null, erro: "Sessão expirada. Entre de novo." };
  }

  const parsed = empreendimentoSchema.safeParse(bruto);
  if (!parsed.success) {
    return { id: null, erro: "Confira os campos destacados e tente de novo." };
  }

  const { incorporadora_id, nome, endereco } = parsed.data;

  if (!ehAdmin(sessao) && incorporadora_id !== sessao.incorporadoraId) {
    return { id: null, erro: "Você só pode editar empreendimentos da sua incorporadora." };
  }

  const supabase = await createClient();
  // `.select()` porque UPDATE barrado por RLS devolve ZERO linha e NENHUM
  // erro: sem conferir o retorno, a tela diria "salvo" para uma escrita que
  // não aconteceu.
  const { data, error } = await supabase
    .from("empreendimento")
    .update({ incorporadora_id, nome, endereco: endereco || null })
    .eq("id", id)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    return { id: null, erro: detalhar("Não foi possível salvar as alterações.", error) };
  }

  if (!data) {
    return {
      id: null,
      erro: "Nada foi salvo: este empreendimento não existe mais, ou não é de uma incorporadora que você administra.",
    };
  }

  revalidatePath("/empreendimentos");
  return { id, erro: null };
}

// -------------------------------------------------------------- excluir

/**
 * Apagar um empreendimento.
 *
 * O banco já define o que isso significa, e as regras estão certas:
 *
 * - as UNIDADES e as CONDIÇÕES de pagamento dele vão junto (`on delete
 *   cascade`) — por isso a tela avisa quantas unidades somem antes de
 *   perguntar;
 * - mas `proposta` e `negocio` apontam para empreendimento e para imóvel com
 *   `on delete restrict`. Ou seja: empreendimento que já teve proposta NÃO é
 *   apagável, e não há nada que a tela possa fazer para mudar isso.
 *
 * Essa é a garantia que torna este botão seguro de existir: ele só funciona
 * no caso que ele deveria resolver — cadastro feito errado, que nunca chegou
 * a produzir nada.
 *
 * A conferência de "dá para apagar" NÃO é feita antes: entre a pergunta e o
 * apagar cabe uma proposta chegando. Quem decide é o banco, e a consulta que
 * explica o porquê só roda quando ele recusa.
 */
export async function excluirEmpreendimento(id: string): Promise<Resultado> {
  const sessao = await getSessao();
  if (!sessao?.conta) return { id: null, erro: "Sessão expirada. Entre de novo." };
  if (!podeEditar(sessao)) {
    return { id: null, erro: "Você não tem permissão para excluir empreendimentos." };
  }

  const supabase = await createClient();

  // `.select()` não é enfeite: DELETE barrado por RLS devolve ZERO linha e
  // NENHUM erro. Sem conferir o que voltou, a tela diria "excluído" para uma
  // operação que não aconteceu.
  const { data, error } = await supabase
    .from("empreendimento")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    if (error.code === "23503") {
      return { id: null, erro: await porQueNaoDaParaExcluir(id) };
    }
    if (error.code === "42501") {
      return { id: null, erro: "Você não tem permissão para excluir este empreendimento." };
    }
    return { id: null, erro: detalhar("Não foi possível excluir o empreendimento.", error) };
  }

  if (!data) {
    return {
      id: null,
      erro: "Este empreendimento não existe mais, ou não é de uma incorporadora que você administra.",
    };
  }

  revalidatePath("/empreendimentos");
  revalidatePath("/imoveis");
  return { id, erro: null };
}

/**
 * A frase que explica a recusa do banco.
 *
 * O erro cru do Postgres diz o nome da constraint e o nome da tabela, o que
 * não ajuda ninguém. Aqui a gente conta o que de fato existe preso ao
 * empreendimento, porque é isso que diz à pessoa o que fazer a seguir.
 */
async function porQueNaoDaParaExcluir(id: string): Promise<string> {
  const supabase = await createClient();

  const [propostas, negocios] = await Promise.all([
    supabase
      .from("proposta")
      .select("id", { count: "exact", head: true })
      .eq("empreendimento_id", id),
    supabase
      .from("negocio")
      .select("id", { count: "exact", head: true })
      .eq("empreendimento_id", id),
  ]);

  const partes: string[] = [];
  if (propostas.count) {
    partes.push(propostas.count === 1 ? "1 proposta" : `${propostas.count} propostas`);
  }
  if (negocios.count) {
    partes.push(negocios.count === 1 ? "1 negócio" : `${negocios.count} negócios`);
  }

  if (partes.length === 0) {
    // A contagem pode voltar vazia por RLS. Não invente certeza que não há.
    return "Este empreendimento tem histórico preso a ele e não pode ser excluído. Marque as unidades como indisponíveis para tirá-las do ar.";
  }

  return `Não dá para excluir: este empreendimento já tem ${partes.join(" e ")}. Apagar levaria o histórico junto. Para tirá-lo do ar, marque as unidades como indisponíveis.`;
}

// --------------------------------------------- disponível / indisponível

/**
 * Tirar um empreendimento do ar, ou devolvê-lo.
 *
 * É o caminho REVERSÍVEL, e é o que resolve quase todos os casos reais:
 * parceria suspensa, prédio que saiu da plataforma, estoque que a
 * incorporadora resolveu vender por outro caminho. Excluir continua
 * existindo, mas só faz sentido para cadastro que nunca deveria ter nascido.
 *
 * Indisponível some do simulador, do painel do corretor e do painel do
 * próprio vendedor — quem decide isso é a Trilha, e só a Trilha enxerga.
 * Nada é apagado: as unidades, as condições e o histórico ficam onde estão.
 *
 * Escreve pela chave de servidor porque a policy do vendedor agora exige o
 * empreendimento ATIVO: pela sessão, religar um empreendimento desligado
 * seria barrado pela própria regra que o desligou. E porque isto é ato de
 * admin por definição.
 */
export async function definirAtivoEmpreendimento(id: string, ativo: boolean): Promise<Resultado> {
  const sessao = await getSessao();
  if (!sessao?.conta) return { id: null, erro: "Sessão expirada. Entre de novo." };
  if (!ehAdmin(sessao)) {
    return {
      id: null,
      erro: "Só um administrador da Trilha pode tirar um empreendimento do ar ou devolvê-lo.",
    };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return {
      id: null,
      erro: "A chave de administrador do Supabase não está configurada no .env.local.",
    };
  }

  const { data, error } = await admin
    .from("empreendimento")
    .update({ ativo })
    .eq("id", id)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || !data) {
    return {
      id: null,
      erro: detalhar(
        ativo
          ? "Não foi possível devolver o empreendimento ao ar."
          : "Não foi possível tirar o empreendimento do ar.",
        error,
      ),
    };
  }

  revalidatePath("/empreendimentos");
  revalidatePath(`/empreendimentos/${id}`);
  revalidatePath("/imoveis");
  return { id, erro: null };
}
