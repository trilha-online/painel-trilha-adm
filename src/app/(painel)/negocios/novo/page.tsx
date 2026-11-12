import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ehAdmin, getSessao } from "@/lib/sessao";
import {
  empreendimentosNegociaveis,
  simular,
  unidadesDoEmpreendimento,
  type UnidadeSimulavel,
} from "@/lib/simulador";
import { caracteristicas } from "@/lib/unidade";
import { Alert, PageHeader } from "@/components/ui";
import { BuscaEmpreendimento } from "@/app/proposta/busca-empreendimento";
import { BuscaUnidade } from "@/app/proposta/busca-unidade";
import FormNovaNegociacao from "@/components/form-nova-negociacao";

/**
 * A Trilha abre uma negociação por dentro do painel (Sprint 4.5).
 *
 * Mesmos passos do simulador — empreendimento, unidade, condição — mais o que
 * no simulador vem de quem envia: o corretor (ou venda direta) e o comprador.
 * A escolha da unidade vai para a URL, como no simulador; dá para chegar aqui
 * já com ela, pelo botão da ficha do imóvel.
 */
export const dynamic = "force-dynamic";

export default async function NovaNegociacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; u?: string }>;
}) {
  const sessao = await getSessao();
  if (!ehAdmin(sessao)) notFound();

  const { e, u } = await searchParams;
  const base = "/negocios/novo";

  const empreendimentos = await empreendimentosNegociaveis();
  const selecionado = e ? empreendimentos.find((x) => x.id === e) : undefined;
  const unidades: UnidadeSimulavel[] = selecionado ? await unidadesDoEmpreendimento(selecionado.id) : [];
  const simulacao = selecionado && u ? await simular(selecionado.id, u, true) : null;

  let parceiros: { id: string; nome: string; ativo: boolean; trilha: boolean }[] = [];
  let comissaoPadrao = 6;
  if (simulacao) {
    const supabase = await createClient();
    const [{ data }, { data: inc }] = await Promise.all([
      // Os da incorporadora da unidade + os Parceiros Trilha (sem incorporadora).
      supabase
        .from("parceiro")
        .select("id, nome, ativo, incorporadora_id")
        .or(`incorporadora_id.eq.${simulacao.incorporadoraId},incorporadora_id.is.null`)
        .order("nome")
        .returns<{ id: string; nome: string; ativo: boolean; incorporadora_id: string | null }[]>(),
      supabase
        .from("incorporadora")
        .select("percentual_comissao")
        .eq("id", simulacao.incorporadoraId)
        .maybeSingle<{ percentual_comissao: number }>(),
    ]);
    parceiros = (data ?? []).map((p) => ({
      id: p.id,
      nome: p.nome,
      ativo: p.ativo,
      trilha: p.incorporadora_id === null,
    }));
    comissaoPadrao = Number(inc?.percentual_comissao ?? 6);
  }

  return (
    <>
      <PageHeader titulo="Nova negociação" voltar={{ href: "/negocios", label: "Setups de negócios" }} />

      <div className="flex flex-col gap-6">
        <section className="rounded-xl border bg-card p-6 shadow-xs">
          <h2 className="mb-4 text-base font-semibold text-foreground">Unidade</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <BuscaEmpreendimento empreendimentos={empreendimentos} selecionado={selecionado} base={base} />
            <BuscaUnidade
              empreendimentoId={selecionado?.id}
              unidades={unidades}
              selecionada={simulacao?.unidade}
              base={base}
            />
          </div>
          {simulacao ? (
            <p className="mt-4 text-sm text-muted-foreground">
              {[caracteristicas(simulacao.unidade), simulacao.incorporadora].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </section>

        {selecionado && u && !simulacao ? (
          <Alert>Esta unidade não está disponível para negociação.</Alert>
        ) : null}

        {/* Sem opções cadastradas, a negociação ainda sai por condição especial. */}
        {simulacao ? (
          <FormNovaNegociacao
            empreendimentoId={simulacao.empreendimentoId}
            imovelId={simulacao.unidade.id}
            condicoes={simulacao.condicoes}
            parceiros={parceiros}
            valorTabela={simulacao.valorImovel}
            comissaoPadrao={comissaoPadrao}
            proprietarioPF={simulacao.avulso}
          />
        ) : null}
      </div>
    </>
  );
}
