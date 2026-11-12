"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { imovelSchema } from "@/lib/schemas";
import { parseDecimal } from "@/lib/br";
import { getSessao, podeEditar } from "@/lib/sessao";

export type Resultado = { id: string; erro: null } | { id: null; erro: string };

const inteiro = (v?: string) => (v && v !== "" ? Number(v) : null);

/**
 * Junta a explicação amigável com o motivo técnico do banco.
 */
const detalhar = (mensagem: string, erro: { code?: string; message?: string } | null) =>
  erro?.message ? `${mensagem} (${erro.code ?? "sem código"}: ${erro.message})` : mensagem;


/** Converte os campos do formulário para o formato da tabela. */
function montarCampos(v: import("@/lib/schemas").ImovelFormValues) {
  return {
    empreendimento_id: v.empreendimento_id,
    identificacao: v.identificacao,
    tipologia: v.tipologia || null,
    observacao: v.observacao || null,
    numero_matricula: v.numero_matricula || null,
    tipo: v.tipo,
    status: v.status,
    valor: v.valor ? parseDecimal(v.valor) : null,
    metros_quadrados: v.metros_quadrados ? parseDecimal(v.metros_quadrados) : null,
    area_total: v.area_total ? parseDecimal(v.area_total) : null,
    area_garden: v.area_garden ? parseDecimal(v.area_garden) : null,
    posicao_solar: v.posicao_solar || null,
    num_quartos: inteiro(v.num_quartos),
    num_suites: inteiro(v.num_suites),
    num_banheiros: inteiro(v.num_banheiros),
    num_vagas: inteiro(v.num_vagas),
    matricula_vaga: v.matricula_vaga || null,
    sacada: v.sacada,
    churrasqueira: v.churrasqueira,
  };
}

export async function criarImovel(bruto: unknown): Promise<Resultado> {
  const sessao = await getSessao();
  if (!sessao?.conta) {
    return { id: null, erro: "Sessão expirada. Entre de novo." };
  }

  const parsed = imovelSchema.safeParse(bruto);
  if (!parsed.success) {
    return { id: null, erro: "Confira os campos destacados e tente de novo." };
  }

  const v = parsed.data;
  const supabase = await createClient();

  // As regras de acesso no banco já impedem gravar num empreendimento de
  // outra incorporadora — o insert simplesmente falha.
  const { data, error } = await supabase
    .from("imovel")
    .insert(montarCampos(v))
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    if (error?.code === "23505") {
      return {
        id: null,
        erro: `Já existe um imóvel com a identificação "${v.identificacao}" nesse empreendimento.`,
      };
    }
    if (error?.code === "42501") {
      return { id: null, erro: "Você não tem permissão para cadastrar nesse empreendimento." };
    }
    return { id: null, erro: detalhar("Não foi possível salvar o imóvel.", error) };
  }

  revalidatePath("/empreendimentos");
  return { id: data.id, erro: null };
}

export async function atualizarImovel(id: string, bruto: unknown): Promise<Resultado> {
  const sessao = await getSessao();
  if (!sessao?.conta) {
    return { id: null, erro: "Sessão expirada. Entre de novo." };
  }

  const parsed = imovelSchema.safeParse(bruto);
  if (!parsed.success) {
    return { id: null, erro: "Confira os campos destacados e tente de novo." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("imovel").update(montarCampos(parsed.data)).eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return {
        id: null,
        erro: `Já existe outro imóvel com a identificação "${parsed.data.identificacao}" nesse empreendimento.`,
      };
    }
    if (error.code === "42501") {
      return { id: null, erro: "Você não tem permissão para editar esse imóvel." };
    }
    return { id: null, erro: detalhar("Não foi possível salvar as alterações.", error) };
  }

  revalidatePath("/empreendimentos");
  return { id, erro: null };
}

// -------------------------------------------------------------- excluir

/**
 * Apagar uma unidade.
 *
 * Mesma lógica do empreendimento: `proposta.imovel_id` e `negocio.imovel_id`
 * são `on delete restrict`, então unidade que já recebeu proposta não some —
 * o banco recusa, e não há tela que contorne isso.
 *
 * Para tirar do ar uma unidade que TEM histórico, o caminho continua sendo
 * marcá-la como indisponível: ela sai do simulador e do painel do corretor
 * sem apagar nada. Excluir é só para cadastro feito errado.
 */
export async function excluirImovel(id: string): Promise<Resultado> {
  const sessao = await getSessao();
  if (!sessao?.conta) return { id: null, erro: "Sessão expirada. Entre de novo." };
  if (!podeEditar(sessao)) {
    return { id: null, erro: "Você não tem permissão para excluir unidades." };
  }

  const supabase = await createClient();

  // `.select()` porque DELETE barrado por RLS devolve zero linha sem erro.
  const { data, error } = await supabase
    .from("imovel")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    if (error.code === "23503") {
      const [propostas, negocios] = await Promise.all([
        supabase.from("proposta").select("id", { count: "exact", head: true }).eq("imovel_id", id),
        supabase.from("negocio").select("id", { count: "exact", head: true }).eq("imovel_id", id),
      ]);

      const partes: string[] = [];
      if (propostas.count) {
        partes.push(propostas.count === 1 ? "1 proposta" : `${propostas.count} propostas`);
      }
      if (negocios.count) {
        partes.push(negocios.count === 1 ? "1 negócio" : `${negocios.count} negócios`);
      }

      return {
        id: null,
        erro:
          partes.length > 0
            ? `Não dá para excluir: esta unidade já tem ${partes.join(" e ")}. Para tirá-la do ar, mude o status para indisponível.`
            : "Esta unidade tem histórico preso a ela e não pode ser excluída. Para tirá-la do ar, mude o status para indisponível.",
      };
    }
    if (error.code === "42501") {
      return { id: null, erro: "Você não tem permissão para excluir esta unidade." };
    }
    return { id: null, erro: detalhar("Não foi possível excluir a unidade.", error) };
  }

  if (!data) {
    return {
      id: null,
      erro: "Esta unidade não existe mais, ou não é de um empreendimento que você administra.",
    };
  }

  revalidatePath("/empreendimentos");
  revalidatePath("/imoveis");
  return { id, erro: null };
}
