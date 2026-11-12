import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { ehAdmin, getSessao } from "@/lib/sessao";
import { maskCNPJ, maskCPF, maskPhone, stripMask } from "@/lib/br";
import { EmptyState, PageHeader } from "@/components/ui";
import ErroLeitura from "@/components/erro-leitura";
import { Busca } from "@/components/busca";

/**
 * Quem vende: incorporadoras e proprietários pessoa física.
 *
 * Uma lista só porque no banco é uma tabela só — `incorporadora`, com uma
 * coluna `tipo`. Eram dois itens de menu por acidente de cronologia: o
 * proprietário PF nasceu três sprints depois e ganhou tela própria em vez de
 * entrar na que já existia.
 *
 * As FICHAS continuam separadas (`/incorporadoras/[id]` e
 * `/proprietarios/[id]`), e é certo que continuem: uma empresa tem CNPJ,
 * empreendimentos e comissão; uma pessoa tem CPF, estado civil e cônjuge. O
 * que se unifica é a porta de entrada, não o cadastro.
 *
 * Lê pela CHAVE DE SERVIDOR porque o CPF do proprietário é coluna protegida
 * desde a 6.1. Só o admin chega aqui.
 */
export const dynamic = "force-dynamic";

type Linha = {
  id: string;
  tipo: string;
  ativo: boolean;
  nome: string;
  cnpj: string | null;
  email: string;
  telefone: string;
  resp_nome: string | null;
  resp_cpf: string | null;
  resp_email: string | null;
  resp_telefone: string | null;
  conta_id: string | null;
  empreendimento: { imovel: { count: number }[] }[];
};

const FILTROS = [
  { chave: "todos", label: "Todos" },
  { chave: "incorporadora", label: "Incorporadoras" },
  { chave: "proprietario_pf", label: "Pessoa física" },
] as const;

/** PostgREST separa condições do `or` por vírgula — então ela não pode passar. */
const limpar = (termo: string) => termo.replace(/[,()*]/g, " ").trim();

export default async function VendedoresPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tipo?: string }>;
}) {
  const sessao = await getSessao();
  if (!ehAdmin(sessao)) redirect("/");

  const { q, tipo } = await searchParams;
  const termo = limpar(q ?? "");
  const filtro = FILTROS.some((f) => f.chave === tipo) ? tipo! : "todos";

  let consulta = createAdminClient()
    .from("incorporadora")
    .select(
      `id, tipo, ativo, nome, cnpj, email, telefone,
       resp_nome, resp_cpf, resp_email, resp_telefone, conta_id,
       empreendimento (imovel (count))`,
    )
    .order("ativo", { ascending: false })
    .order("nome");

  if (filtro !== "todos") consulta = consulta.eq("tipo", filtro);

  if (termo) {
    const condicoes = [`nome.ilike.*${termo}*`, `resp_nome.ilike.*${termo}*`];
    const digitos = stripMask(termo);
    // O documento é guardado só com dígitos, então a máscara digitada cai fora.
    if (digitos) condicoes.push(`cnpj.ilike.*${digitos}*`, `resp_cpf.ilike.*${digitos}*`);
    consulta = consulta.or(condicoes.join(","));
  }

  const { data, error } = await consulta.returns<Linha[]>();
  if (error) return <ErroLeitura oQue="dos vendedores" erro={error} />;

  const vendedores = data ?? [];

  return (
    <>
      <PageHeader
        titulo="Vendedores"
        descricao="Incorporadoras parceiras e proprietários pessoa física."
        acao={{ href: "/incorporadoras/nova", label: "Cadastrar incorporadora" }}
        acaoSecundaria={{ href: "/proprietarios/novo", label: "Cadastrar pessoa física" }}
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Suspense fallback={null}>
          <Busca base="/vendedores" placeholder="Buscar por nome, responsável, CNPJ ou CPF" />
        </Suspense>

        <div className="flex flex-wrap gap-1.5">
          {FILTROS.map((f) => {
            const on = f.chave === filtro;
            const destino = new URLSearchParams();
            if (f.chave !== "todos") destino.set("tipo", f.chave);
            if (termo) destino.set("q", termo);
            const qs = destino.toString();

            return (
              <Link
                key={f.chave}
                href={qs ? `/vendedores?${qs}` : "/vendedores"}
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
      </div>

      {vendedores.length === 0 ? (
        <EmptyState
          titulo={termo ? "Nenhum vendedor encontrado" : "Nenhum vendedor cadastrado"}
          texto={
            termo
              ? `Nada corresponde a “${termo}”. Tente parte do nome, do responsável, do CNPJ ou do CPF.`
              : "Cadastre a primeira incorporadora parceira, ou um proprietário pessoa física."
          }
          acao={
            termo
              ? { href: "/vendedores", label: "Limpar busca" }
              : { href: "/incorporadoras/nova", label: "Cadastrar incorporadora" }
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border">
                {["Vendedor", "Tipo", "Documento", "Contato", "Unidades", ""].map((h, i) => (
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
              {vendedores.map((v) => {
                const pf = v.tipo === "proprietario_pf";
                const base = pf ? "/proprietarios" : "/incorporadoras";
                // No PF a pessoa É o vendedor: os dados dela moram em `resp_*`.
                const nome = pf ? (v.resp_nome ?? v.nome) : v.nome;
                const documento = pf ? maskCPF(v.resp_cpf ?? "") : maskCNPJ(v.cnpj ?? "");
                const email = pf ? (v.resp_email ?? v.email) : v.email;
                const telefone = pf ? (v.resp_telefone ?? v.telefone) : v.telefone;
                const unidades = v.empreendimento.reduce(
                  (total, e) => total + (e.imovel[0]?.count ?? 0),
                  0,
                );

                return (
                  <tr
                    key={v.id}
                    className="border-b border-border transition-colors last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`${base}/${v.id}`}
                        className="text-sm font-semibold text-foreground underline-offset-4 hover:underline hover:text-foreground"
                      >
                        {nome}
                      </Link>
                      <span className="block text-sm text-muted-foreground">
                        {v.ativo
                          ? v.conta_id
                            ? "acesso criado"
                            : "sem acesso"
                          : "desativado · fora do simulador"}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                      {pf ? "Pessoa física" : "Incorporadora"}
                    </td>

                    <td className="px-4 py-3 text-sm tabular-nums text-muted-foreground">
                      {documento || "—"}
                    </td>

                    <td className="px-4 py-3 text-sm">
                      {email}
                      <span className="block text-sm tabular-nums text-muted-foreground">
                        {maskPhone(telefone ?? "")}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-sm tabular-nums">
                      <Link
                        href={`/empreendimentos?incorporadora=${v.id}`}
                        className="text-foreground underline-offset-4 hover:underline hover:text-foreground"
                      >
                        {unidades}
                      </Link>
                    </td>

                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`${base}/${v.id}/editar`}
                        className="text-sm font-semibold text-foreground underline-offset-4 hover:underline hover:text-foreground"
                      >
                        Editar
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
