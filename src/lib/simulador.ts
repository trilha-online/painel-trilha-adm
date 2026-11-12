/**
 * A única porta de leitura da página pública.
 *
 * O simulador não tem usuário logado, então não há identidade para o banco
 * recortar: quem chega é `anon`, que não tem permissão nenhuma. A saída
 * escolhida foi ler pelo servidor com a chave de administrador — e é por isso
 * que TODA leitura pública mora aqui, num arquivo só.
 *
 * A regra deste arquivo: cada função devolve uma forma FIXA, montada no
 * código. Nenhuma delas aceita "quais campos" ou "qual filtro" como
 * parâmetro. É isso que impede que a página pública vire uma consulta livre
 * ao banco.
 *
 * Nada aqui pode ser importado por componente de cliente.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { opcoesQueValem } from "@/lib/opcoes";
import { calcularCondicoes, type Condicao } from "@/lib/pagamento";
import type { UnidadeResumo } from "@/lib/unidade";

export type EmpreendimentoSimulavel = {
  id: string;
  nome: string;
  incorporadora: string;
};

type LinhaEmpreendimento = {
  id: string;
  nome: string;
  incorporadora_id: string;
  incorporadora: { nome: string; tipo: string; ativo: boolean } | null;
};

const ehAvulso = (tipo?: string | null) => tipo === "proprietario_pf";

/**
 * Os empreendimentos que dá para simular.
 *
 * Um empreendimento só entra na lista quando as duas coisas valem:
 *   1. tem ao menos uma unidade disponível COM valor — sem preço não há conta;
 *   2. tem condição de pagamento que se aplique a ele — própria, ou o padrão
 *      da incorporadora, pela mesma herança tudo-ou-nada do painel.
 *
 * Sem esse filtro o cliente escolheria um prédio e cairia numa tela vazia,
 * que é a pior forma de descobrir que não havia nada ali.
 */
export async function empreendimentosSimulaveis(): Promise<EmpreendimentoSimulavel[]> {
  return listarEmpreendimentos(false);
}

/**
 * Para a Nova negociação do admin: os simuláveis MAIS os imóveis avulsos
 * (proprietário PF), que não têm opção de pagamento cadastrada e só saem por
 * condição especial. Nunca usar na página pública.
 */
export async function empreendimentosNegociaveis(): Promise<EmpreendimentoSimulavel[]> {
  return listarEmpreendimentos(true);
}

async function listarEmpreendimentos(incluirAvulsos: boolean): Promise<EmpreendimentoSimulavel[]> {
  const supabase = createAdminClient();

  // Três consultas rasas em vez de uma com junções: as duas listas de apoio
  // são pequenas (opções são no máximo 4 por escopo) e o cruzamento em memória
  // é mais legível do que a mesma regra escrita em PostgREST.
  const [{ data: empreendimentos }, { data: unidades }, { data: opcoes }] = await Promise.all([
    supabase
      .from("empreendimento")
      .select("id, nome, incorporadora_id, incorporadora (nome, tipo, ativo)")
      .order("nome")
      .returns<LinhaEmpreendimento[]>(),

    supabase
      .from("imovel")
      .select("empreendimento_id")
      .eq("status", "disponivel")
      .not("valor", "is", null)
      .returns<{ empreendimento_id: string }[]>(),

    supabase
      .from("opcao_pagamento")
      .select("incorporadora_id, empreendimento_id")
      .returns<{ incorporadora_id: string; empreendimento_id: string | null }[]>(),
  ]);

  const comEstoque = new Set((unidades ?? []).map((u) => u.empreendimento_id));

  const comCondicaoPropria = new Set(
    (opcoes ?? []).filter((o) => o.empreendimento_id).map((o) => o.empreendimento_id as string),
  );

  const incorporadoraComPadrao = new Set(
    (opcoes ?? []).filter((o) => !o.empreendimento_id).map((o) => o.incorporadora_id),
  );

  return (empreendimentos ?? [])
    .filter((e) => {
      // Vendedor desativado some do ar inteiro: simulador, `/condicoes` e
      // nova negociação. Esta leitura usa a chave de servidor, que ignora RLS
      // — então o recorte do vendedor precisa estar escrito aqui, à mão. É o
      // preço de ler sem identidade, e a razão de toda leitura pública morar
      // neste arquivo só.
      if (!e.incorporadora?.ativo) return false;
      if (!comEstoque.has(e.id)) return false;
      // Imóvel avulso nunca vai ao público; no admin entra mesmo sem opções.
      if (ehAvulso(e.incorporadora?.tipo)) return incluirAvulsos;
      return comCondicaoPropria.has(e.id) || incorporadoraComPadrao.has(e.incorporadora_id);
    })
    .map((e) => ({
      id: e.id,
      nome: e.nome,
      incorporadora: ehAvulso(e.incorporadora?.tipo)
        ? `Proprietário PF · ${e.incorporadora?.nome ?? ""}`
        : (e.incorporadora?.nome ?? ""),
    }));
}

// ---------------------------------------------------------------- unidades

export type UnidadeSimulavel = UnidadeResumo & {
  id: string;
  identificacao: string;
};

const CAMPOS_UNIDADE =
  "id, identificacao, tipologia, metros_quadrados, num_quartos, num_suites, num_vagas";

/**
 * As unidades que o cliente pode simular naquele empreendimento.
 *
 * Só disponíveis e só com valor — a mesma regra que decidiu quais
 * empreendimentos entram na lista. A unidade reservada, em negociação ou já em
 * Trilha não existe para o público: além de não estar à venda, o desempenho de
 * vendas da incorporadora não é assunto de quem está simulando.
 */
export async function unidadesDoEmpreendimento(
  empreendimentoId: string,
): Promise<UnidadeSimulavel[]> {
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("imovel")
    .select(CAMPOS_UNIDADE)
    .eq("empreendimento_id", empreendimentoId)
    .eq("status", "disponivel")
    .not("valor", "is", null)
    .order("identificacao")
    .returns<UnidadeSimulavel[]>();

  return data ?? [];
}

// -------------------------------------------------------------- simulação

export type Simulacao = {
  empreendimentoId: string;
  empreendimento: string;
  incorporadoraId: string;
  incorporadora: string;
  unidade: UnidadeSimulavel;
  /** O valor da unidade no momento desta leitura. A proposta congela este número. */
  valorImovel: number;
  /** De onde saíram as condições — vai congelado junto, na proposta. */
  escopo: "incorporadora" | "empreendimento";
  /** Imóvel de proprietário PF: sem opções cadastradas, só condição especial. */
  avulso: boolean;
  condicoes: Condicao[];
};

type LinhaImovel = UnidadeSimulavel & {
  valor: number | null;
  empreendimento: {
    id: string;
    nome: string;
    incorporadora_id: string;
    incorporadora: {
      nome: string;
      percentual_comissao: number;
      tipo: string;
      ativo: boolean;
    } | null;
  } | null;
};

/**
 * As condições de pagamento de uma unidade, prontas para a tela.
 *
 * A conta NÃO é refeita aqui: chama `calcularCondicoes`, a mesma função da
 * ficha do imóvel no painel. Um simulador com fórmula própria seria a coisa
 * mais fácil de deixar desatualizada neste sistema — mudou a taxa em
 * `lib/trilha.ts`, muda aqui no mesmo instante.
 *
 * A comissão entra no cálculo mesmo sem aparecer na tela, e por um motivo:
 * é ela que diz se a condição fecha. Condição que não fecha some da lista —
 * o cliente não pode receber uma oferta que a incorporadora não honra.
 */
export async function simular(
  empreendimentoId: string,
  imovelId: string,
  /** Só o admin (Nova negociação) passa `true`. Na página pública, avulso não existe. */
  permitirAvulso = false,
): Promise<Simulacao | null> {
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("imovel")
    .select(
      `${CAMPOS_UNIDADE}, valor,
       empreendimento (id, nome, incorporadora_id, incorporadora (nome, percentual_comissao, tipo, ativo))`,
    )
    .eq("id", imovelId)
    .eq("empreendimento_id", empreendimentoId)
    .eq("status", "disponivel")
    .not("valor", "is", null)
    .maybeSingle<LinhaImovel>();

  const empreendimento = data?.empreendimento;
  if (!data || !empreendimento) return null;

  // A mesma trava da lista, de novo aqui: `/condicoes` e o ENVIO da proposta
  // chamam `simular` direto, sem passar pela lista. Sem esta linha, um link
  // antigo continuaria simulando — e aceitando proposta — do estoque de um
  // vendedor que já saiu do ar.
  if (!empreendimento.incorporadora?.ativo) return null;

  const avulso = ehAvulso(empreendimento.incorporadora?.tipo);
  if (avulso && !permitirAvulso) return null;

  const { opcoes, origem } = await opcoesQueValem(
    supabase,
    empreendimento.incorporadora_id,
    empreendimento.id,
  );

  const comissao = empreendimento.incorporadora?.percentual_comissao ?? 0;

  return {
    empreendimentoId: empreendimento.id,
    empreendimento: empreendimento.nome,
    incorporadoraId: empreendimento.incorporadora_id,
    incorporadora: empreendimento.incorporadora?.nome ?? "",
    valorImovel: data.valor!,
    // "nenhuma" só acontece quando não há opção alguma — e aí `condicoes` sai
    // vazia e ninguém chega a usar este campo.
    escopo: origem === "empreendimento" ? "empreendimento" : "incorporadora",
    avulso,
    unidade: {
      id: data.id,
      identificacao: data.identificacao,
      tipologia: data.tipologia,
      metros_quadrados: data.metros_quadrados,
      num_quartos: data.num_quartos,
      num_suites: data.num_suites,
      num_vagas: data.num_vagas,
    },
    condicoes: calcularCondicoes(data.valor, opcoes, comissao).filter((c) => c.comissaoCabe),
  };
}
