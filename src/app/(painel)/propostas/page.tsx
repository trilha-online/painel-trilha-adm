import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ehAdmin, ehParceiro, getSessao } from "@/lib/sessao";
import { formatBRL } from "@/lib/br";
import { EmptyState, PageHeader } from "@/components/ui";
import ErroLeitura from "@/components/erro-leitura";
import { SituacaoProposta } from "@/components/situacao-proposta";

/**
 * A fila de propostas da Trilha.
 *
 * A tela é uma fila de trabalho, não um relatório. Três blocos, na ordem em
 * que pedem atenção:
 *
 *   Esperando decisão — enviada e em análise. É o trabalho de hoje.
 *   Aceitas           — viraram negócio e estão em fechamento. A linha leva
 *                       direto para lá.
 *   Encerradas        — recusada, invalidada e cancelada. Nascem RECOLHIDAS:
 *                       não pedem nada de ninguém e, num histórico de verdade,
 *                       seriam a maior parte da tela.
 *
 * Antes eram dois blocos, e o segundo juntava a proposta aceita — um negócio
 * vivo — com as três que morreram. Uma lista única ordenada por data é ainda
 * pior: enterra a proposta de ontem que ninguém olhou embaixo das dez de hoje
 * que já foram resolvidas.
 *
 * Quem decide é a Trilha — formato de pagamento e qualificação do comprador.
 * Por isso esta tela é só dela. A incorporadora tem a sua, com outro recorte.
 */
export const dynamic = "force-dynamic";

type Linha = {
  id: string;
  codigo: string;
  status: string;
  created_at: string;
  prazo_meses: number;
  valor_parcela: number;
  valor_base: number;
  imovel: { identificacao: string } | null;
  empreendimento: { nome: string } | null;
  incorporadora: { nome: string } | null;
  parceiro: { nome: string; ativo: boolean; origem: string } | null;
};

const ABERTAS = ["enviada", "em_analise"];
/** Acabaram sem virar negócio. Nenhuma delas espera alguém. */
const ENCERRADAS = ["recusada", "invalidada", "cancelada"];

export default async function PropostasPage() {
  const sessao = await getSessao();
  const admin = ehAdmin(sessao);
  const corretor = ehParceiro(sessao);

  // A incorporadora não entra aqui: ela vê proposta pela view própria, sem os
  // dados do comprador — tela ainda por fazer.
  if (!admin && !corretor) redirect("/empreendimentos");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("proposta")
    .select(
      `id, codigo, status, created_at, prazo_meses, valor_parcela, valor_base,
       imovel (identificacao),
       empreendimento (nome),
       incorporadora (nome),
       parceiro!parceiro_id (nome, ativo, origem)`,
    )
    .order("created_at", { ascending: false })
    .returns<Linha[]>();

  if (error) return <ErroLeitura oQue="das propostas" erro={error} />;

  const propostas = data ?? [];
  const abertas = propostas.filter((p) => ABERTAS.includes(p.status));
  const aceitas = propostas.filter((p) => p.status === "aceita");
  const encerradas = propostas.filter((p) => ENCERRADAS.includes(p.status));

  // O negócio de cada proposta aceita, para a linha levar direto ao
  // fechamento. Uma consulta só para todas: uma por linha seriam N idas ao
  // banco para montar uma tabela. Quem não pode enxergar o negócio não recebe
  // a linha, e aí o link simplesmente não aparece — a policy decide, não a tela.
  const { data: negocios } = aceitas.length
    ? await supabase
        .from("negocio")
        .select("id, proposta_id")
        .in(
          "proposta_id",
          aceitas.map((p) => p.id),
        )
        .returns<{ id: string; proposta_id: string }[]>()
    : { data: [] as { id: string; proposta_id: string }[] };

  const negocioDa = new Map((negocios ?? []).map((n) => [n.proposta_id, n.id]));

  return (
    <>
      <PageHeader
        titulo={corretor ? "Minhas propostas" : "Propostas"}
        descricao={
          corretor
            ? "As propostas que você enviou e em que pé está cada uma."
            : "Pedidos de negócio enviados pelos corretores."
        }
      />

      {propostas.length === 0 ? (
        <EmptyState
          titulo="Nenhuma proposta ainda"
          texto={
            corretor
              ? "Abra Nova proposta, escolha a unidade e a condição, e envie. Ela aparece aqui com a situação."
              : "As propostas chegam quando um corretor escolhe uma condição e envia os dados do comprador."
          }
        />
      ) : (
        <div className="flex flex-col gap-10">
          <Bloco
            titulo={corretor ? "Em análise" : "Esperando decisão"}
            vazio={
              corretor
                ? "Nenhuma proposta em análise agora."
                : "Nenhuma proposta aguardando. Fila limpa."
            }
            propostas={abertas}
            mostrarIncorporadora={admin}
          />
          {aceitas.length > 0 ? (
            <Bloco
              titulo="Aceitas"
              vazio=""
              propostas={aceitas}
              mostrarIncorporadora={admin}
              negocioDa={negocioDa}
            />
          ) : null}

          {encerradas.length > 0 ? (
            <Encerradas propostas={encerradas} mostrarIncorporadora={admin} />
          ) : null}
        </div>
      )}
    </>
  );
}

function Bloco({
  titulo,
  vazio,
  propostas,
  mostrarIncorporadora,
  negocioDa,
}: {
  titulo: string;
  vazio: string;
  propostas: Linha[];
  /** O corretor pertence a uma incorporadora só: a coluna não diz nada a ele. */
  mostrarIncorporadora: boolean;
  /** Só nas aceitas: o negócio que nasceu de cada proposta. */
  negocioDa?: Map<string, string>;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
        {titulo}
        <span className="ml-2 normal-case tracking-normal text-muted-foreground/70">
          {propostas.length}
        </span>
      </h2>

      {propostas.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-5 py-6 text-sm text-muted-foreground">
          {vazio}
        </p>
      ) : (
        <Tabela
          propostas={propostas}
          mostrarIncorporadora={mostrarIncorporadora}
          negocioDa={negocioDa}
        />
      )}
    </section>
  );
}

/**
 * As encerradas, recolhidas.
 *
 * Apagar não é opção: é aqui que se descobre por que aquela unidade não foi
 * vendida, e a diferença entre recusada e invalidada é informação para o
 * corretor. Mas elas não pedem nada de ninguém, então nascem fechadas.
 * `details` dá isso sem filtro, sem estado e sem virar componente de cliente.
 */
function Encerradas({
  propostas,
  mostrarIncorporadora,
}: {
  propostas: Linha[];
  mostrarIncorporadora: boolean;
}) {
  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-muted-foreground underline-offset-4 hover:underline hover:text-foreground">
        Encerradas
        <span className="ml-2 font-normal text-muted-foreground/70">{propostas.length}</span>
      </summary>

      <p className="mt-2 mb-3 text-sm text-muted-foreground">
        Recusadas pela Trilha, invalidadas porque a unidade fechou com outra proposta, ou canceladas
        junto com o negócio.
      </p>

      <Tabela propostas={propostas} mostrarIncorporadora={mostrarIncorporadora} />
    </details>
  );
}

function Tabela({
  propostas,
  mostrarIncorporadora,
  negocioDa,
}: {
  propostas: Linha[];
  mostrarIncorporadora: boolean;
  negocioDa?: Map<string, string>;
}) {
  const colunas = mostrarIncorporadora
    ? ["Código", "Unidade", "Incorporadora", "Corretor", "Condição", "Situação"]
    : ["Código", "Unidade", "Condição", "Situação"];

  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
      <table className="w-full min-w-[720px] border-collapse text-left">
        <thead>
          <tr className="border-b border-border">
            {colunas.map((h) => (
              <th
                key={h}
                className="bg-muted/50 px-4 py-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {propostas.map((p) => (
            <tr key={p.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/40">
              <td className="px-4 py-3">
                <Link
                  href={`/propostas/${p.id}`}
                  className="text-sm font-semibold tabular-nums text-foreground underline-offset-4 hover:underline hover:text-foreground"
                >
                  {p.codigo}
                </Link>
                <span className="block text-sm text-muted-foreground">
                  {new Date(p.created_at).toLocaleDateString("pt-BR")}
                </span>
              </td>

              <td className="px-4 py-3 text-sm">
                {p.imovel?.identificacao ?? "—"}
                <span className="block text-sm text-muted-foreground">
                  {p.empreendimento?.nome ?? "—"}
                </span>
              </td>

              {mostrarIncorporadora ? (
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {p.incorporadora?.nome ?? "—"}
                </td>
              ) : null}

              {mostrarIncorporadora ? (
                <td className="px-4 py-3 text-sm">
                  {p.parceiro?.nome ?? "Venda direta"}
                {/* O corretor que nasceu desta proposta ainda não tem
                    acesso. Dizer isso aqui é o que faz a fila de aprovação
                    ser vista por quem pode resolvê-la. */}
                  {p.parceiro && p.parceiro.origem === "proposta" && !p.parceiro.ativo ? (
                    <span className="block text-sm font-semibold text-aviso">
                      cadastro pendente
                    </span>
                  ) : null}
                </td>
              ) : null}

              <td className="px-4 py-3 text-sm tabular-nums">
                {p.prazo_meses}× {formatBRL(p.valor_parcela)}
                <span className="block text-sm text-muted-foreground">
                  imóvel {formatBRL(p.valor_base)}
                </span>
              </td>

              <td className="px-4 py-3">
                <SituacaoProposta status={p.status} />
                {negocioDa?.get(p.id) ? (
                  <Link
                    href={`/negocios/${negocioDa.get(p.id)}`}
                    className="mt-1 block text-sm text-muted-foreground underline-offset-4 hover:underline hover:text-foreground"
                  >
                    ver o fechamento
                  </Link>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
