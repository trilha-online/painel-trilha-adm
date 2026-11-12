import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { ehParceiroTrilha, ehProprietarioPF, getSessao, podeEditar } from "@/lib/sessao";
import { redirect } from "next/navigation";
import { EmptyState, PageHeader, Stat } from "@/components/ui";
import { FiltroIncorporadora } from "@/components/filtro-incorporadora";
import { Busca } from "@/components/busca";

type Linha = {
  id: string;
  nome: string;
  ativo: boolean;
  endereco: string | null;
  incorporadora_id: string;
  incorporadora: { nome: string } | null;
  imovel: { count: number }[];
};

/**
 * A SEGUNDA LISTA, em forma de filtro.
 *
 * Só a Trilha vê empreendimento indisponível — para todo o resto ele nem
 * existe, e a policy do banco cuida disso. Então os chips aparecem só para o
 * admin, e a lista abre em "No ar": o trabalho do dia é com o que está
 * vendendo, não com o que foi guardado.
 */
const FILTROS = [
  { chave: "ativos", label: "No ar" },
  { chave: "indisponiveis", label: "Indisponíveis" },
  { chave: "todos", label: "Todos" },
] as const;

/** PostgREST separa condições do `or` por vírgula — então ela não pode passar. */
const limpar = (termo: string) => termo.replace(/[,()*]/g, " ").trim();

export default async function EmpreendimentosPage({
  searchParams,
}: {
  searchParams: Promise<{ incorporadora?: string; q?: string; situacao?: string }>;
}) {
  const { incorporadora, q, situacao } = await searchParams;
  const termo = limpar(q ?? "");
  const sessao = await getSessao();
  // Várias telas mandam o corretor para cá. O Parceiro Trilha não tem uma
  // incorporadora para listar aqui; o estoque dele é o simulador.
  if (ehParceiroTrilha(sessao)) redirect("/propostas");
  if (ehProprietarioPF(sessao)) redirect(`/proprietarios/${sessao!.incorporadoraId}`);
  const admin = sessao?.conta?.tipo === "trilha_admin";
  const edita = podeEditar(sessao);
  // Para quem não é admin o filtro não existe: o banco já só devolve os que
  // estão no ar, e um chip que não muda nada é pior do que chip nenhum.
  const filtro = admin && FILTROS.some((f) => f.chave === situacao) ? situacao! : "ativos";

  const supabase = await createClient();

  const { data: incorporadoras } = await supabase
    .from("incorporadora")
    .select("id, nome")
    // Proprietário PF tem menu próprio.
    .eq("tipo", "incorporadora")
    .order("nome")
    .returns<{ id: string; nome: string }[]>();

  let consulta = supabase
    .from("empreendimento")
    .select("id, nome, ativo, endereco, incorporadora_id, incorporadora!inner(nome), imovel(count)")
    // Os imóveis avulsos (proprietário PF) aparecem no menu próprio.
    .eq("incorporadora.tipo", "incorporadora")
    .order("nome");

  if (incorporadora) consulta = consulta.eq("incorporadora_id", incorporadora);
  if (filtro === "ativos") consulta = consulta.eq("ativo", true);
  if (filtro === "indisponiveis") consulta = consulta.eq("ativo", false);

  if (termo) {
    // Nome do empreendimento ou endereço.
    consulta = consulta.or(`nome.ilike.*${termo}*,endereco.ilike.*${termo}*`);
  }

  const { data } = await consulta.returns<Linha[]>();

  // Resumo do topo. Ele acompanha o filtro por incorporadora, mas ignora a
  // busca por texto de propósito: "total de imóveis" tem que continuar sendo
  // o total, e não o número de linhas que a busca deixou na tela.
  let escopo = supabase
    .from("empreendimento")
    .select("id, incorporadora!inner(tipo)")
    .eq("incorporadora.tipo", "incorporadora");
  if (incorporadora) escopo = escopo.eq("incorporadora_id", incorporadora);
  if (filtro === "ativos") escopo = escopo.eq("ativo", true);
  if (filtro === "indisponiveis") escopo = escopo.eq("ativo", false);
  const { data: doEscopo } = await escopo.returns<{ id: string }[]>();
  const idsEscopo = (doEscopo ?? []).map((e) => e.id);

  const contarImoveis = async (status?: string) => {
    if (idsEscopo.length === 0) return 0;
    let q = supabase
      .from("imovel")
      .select("id", { count: "exact", head: true })
      .in("empreendimento_id", idsEscopo);
    if (status) q = q.eq("status", status);
    const { count } = await q;
    return count ?? 0;
  };

  const [totalImoveis, totalDisponiveis, totalNegociacao, totalEmTrilha] = await Promise.all([
    contarImoveis(),
    contarImoveis("disponivel"),
    contarImoveis("em_negociacao"),
    contarImoveis("em_trilha"),
  ]);

  const semIncorporadora = admin && (incorporadoras?.length ?? 0) === 0;
  const filtrando = Boolean(incorporadora);
  const buscando = Boolean(termo);
  const nomeFiltrado = incorporadoras?.find((i) => i.id === incorporadora)?.nome;

  return (
    <>
      <PageHeader
        titulo="Empreendimentos"
        descricao={
          filtrando
            ? `Empreendimentos de ${nomeFiltrado ?? "—"}.`
            : "Os prédios e condomínios onde ficam os imóveis."
        }
        acao={
          semIncorporadora || !edita
            ? undefined
            : { href: "/empreendimentos/novo", label: "Novo empreendimento" }
        }
        // A importação saiu do menu na 6.4 e vive aqui: é a outra forma de um
        // empreendimento entrar no sistema, só que a partir de um arquivo. Leva
        // para a página, não abre um modal — ela tem histórico das anteriores.
        acaoSecundaria={
          admin && !semIncorporadora
            ? { href: "/importacao", label: "Importar estoque" }
            : undefined
        }
      />

      {idsEscopo.length > 0 ? (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat valor={idsEscopo.length} label="Empreendimentos" />
          <Stat valor={totalImoveis} label="Imóveis cadastrados" />
          <Stat valor={totalDisponiveis} label="Disponíveis" tom="positivo" />
          <Stat valor={totalNegociacao} label="Em negociação" tom="atencao" />
          <Stat valor={totalEmTrilha} label="Em Trilha" tom="destaque" />
        </div>
      ) : null}

      <div className="mb-5 flex flex-wrap items-center gap-4">
        <Suspense fallback={null}>
          <Busca base="/empreendimentos" placeholder="Buscar por nome ou endereço" />
        </Suspense>

        {admin && (incorporadoras?.length ?? 0) > 0 ? (
          <Suspense fallback={null}>
            <FiltroIncorporadora incorporadoras={incorporadoras ?? []} base="/empreendimentos" />
          </Suspense>
        ) : null}

        {admin ? (
          <div className="flex flex-wrap gap-1.5">
            {FILTROS.map((f) => {
              const on = f.chave === filtro;
              const destino = new URLSearchParams();
              if (f.chave !== "ativos") destino.set("situacao", f.chave);
              if (incorporadora) destino.set("incorporadora", incorporadora);
              if (termo) destino.set("q", termo);
              const qs = destino.toString();

              return (
                <Link
                  key={f.chave}
                  href={qs ? `/empreendimentos?${qs}` : "/empreendimentos"}
                  aria-current={on ? "page" : undefined}
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    on
                      ? "border-foreground/20 bg-muted font-medium text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f.label}
                </Link>
              );
            })}
          </div>
        ) : null}

        {buscando ? (
          <span className="text-sm text-muted-foreground">
            {data?.length ?? 0} resultado{(data?.length ?? 0) === 1 ? "" : "s"} para “{termo}”
          </span>
        ) : null}

        {filtrando || buscando || filtro !== "ativos" ? (
          <Link
            href="/empreendimentos"
            className="text-sm font-semibold text-foreground underline-offset-4 hover:underline hover:text-foreground"
          >
            Limpar
          </Link>
        ) : null}
      </div>

      {semIncorporadora ? (
        <EmptyState
          titulo="Cadastre uma incorporadora primeiro"
          texto="Cadastre uma incorporadora primeiro."
          acao={{ href: "/incorporadoras/nova", label: "Cadastrar incorporadora" }}
        />
      ) : !data || data.length === 0 ? (
        <EmptyState
          titulo={
            buscando
              ? "Nenhum empreendimento encontrado"
              : filtro === "indisponiveis"
                ? "Nenhum empreendimento fora do ar"
                : filtrando
                  ? "Nenhum empreendimento desta incorporadora"
                  : "Nenhum empreendimento cadastrado"
          }
          texto={
            buscando
              ? `Nada corresponde a “${termo}”. Tente parte do nome ou do endereço.`
              : filtro === "indisponiveis"
                ? "Tudo que está cadastrado está no ar. Empreendimento tirado do ar aparece aqui, guardado e pronto para voltar."
                : "Cadastre o prédio ou condomínio antes de incluir as unidades."
          }
          acao={edita ? { href: "/empreendimentos/novo", label: "Cadastrar empreendimento" } : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
          <table className="w-full min-w-[680px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border">
                {[
                  "Empreendimento",
                  ...(admin ? ["Incorporadora"] : []),
                  "Endereço",
                  "Imóveis",
                  "",
                ].map((h, i) => (
                  <th
                    key={`${h}-${i}`}
                    className="bg-muted/50 px-4 py-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((linha) => (
                <tr key={linha.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <Link
                      href={`/empreendimentos/${linha.id}`}
                      className="text-sm font-semibold text-foreground underline-offset-4 hover:underline hover:text-foreground"
                    >
                      {linha.nome}
                    </Link>
                    {linha.ativo ? null : (
                      <span className="block text-sm text-muted-foreground">
                        indisponível · fora do simulador
                      </span>
                    )}
                  </td>
                  {admin ? (
                    <td className="px-4 py-3 text-sm">
                      <Link
                        href={`/incorporadoras/${linha.incorporadora_id}`}
                        className="text-foreground underline-offset-4 hover:underline hover:text-foreground"
                      >
                        {linha.incorporadora?.nome ?? "—"}
                      </Link>
                    </td>
                  ) : null}
                  <td className="px-4 py-3 text-sm text-muted-foreground">{linha.endereco || "—"}</td>
                  <td className="px-4 py-3 text-sm tabular-nums">
                    {linha.imovel?.[0]?.count ?? 0}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/empreendimentos/${linha.id}`}
                      className="text-sm font-semibold text-foreground underline-offset-4 hover:underline hover:text-foreground"
                    >
                      Abrir
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
