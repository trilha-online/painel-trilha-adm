import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ehAdmin, getSessao } from "@/lib/sessao";
import { maskPhone } from "@/lib/br";
import { EmptyState, PageHeader } from "@/components/ui";
import ErroLeitura from "@/components/erro-leitura";

/**
 * Quem administra a Trilha.
 *
 * Lê pela SESSÃO, não pela chave de servidor: a policy `conta_leitura` já diz
 * que o admin lê todas as contas, e deixar a regra do banco valer é o jeito de
 * ela ser testada todo dia em vez de só na auditoria.
 *
 * Não existe "sem acesso" nesta lista, diferente de Vendedores e Parceiros: um
 * admin é a própria linha da `conta`, então ou ele tem login ou não existe.
 */
export const dynamic = "force-dynamic";

type Linha = {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  ativo: boolean;
  protegido: boolean;
  created_at: string;
};

const dataBR = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

export default async function AdministradoresPage() {
  const sessao = await getSessao();
  if (!ehAdmin(sessao)) redirect("/");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conta")
    .select("id, nome, email, telefone, ativo, protegido, created_at")
    .eq("tipo", "trilha_admin")
    .order("protegido", { ascending: false })
    .order("ativo", { ascending: false })
    .order("created_at")
    .returns<Linha[]>();

  if (error) return <ErroLeitura oQue="dos administradores" erro={error} />;

  const admins = data ?? [];
  const ativos = admins.filter((a) => a.ativo).length;

  return (
    <>
      <PageHeader
        titulo="Administradores"
        descricao="Quem entra no painel da Trilha com poder total."
        acao={{ href: "/administradores/novo", label: "Cadastrar administrador" }}
      />

      {admins.length === 0 ? (
        <EmptyState
          titulo="Nenhum administrador"
          texto="Isso não deveria acontecer — você está vendo esta tela, então existe pelo menos um."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border">
                  {["Administrador", "Acesso", "Telefone", "Desde", ""].map((h, i) => (
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
                {admins.map((a) => {
                  const souEu = a.id === sessao!.usuarioId;

                  return (
                    <tr
                      key={a.id}
                      className="border-b border-border transition-colors last:border-0 hover:bg-muted/40"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/administradores/${a.id}`}
                          className="text-sm font-semibold text-foreground underline-offset-4 hover:underline hover:text-foreground"
                        >
                          {a.nome}
                        </Link>
                        {souEu ? (
                          <span className="ml-2 text-sm text-muted-foreground">(você)</span>
                        ) : null}
                        {a.protegido ? (
                          <span className="block text-sm text-muted-foreground">
                            conta principal · não pode ser desativada
                          </span>
                        ) : null}
                      </td>

                      <td className="px-4 py-3 text-sm">
                        <span className="inline-flex h-6 items-center gap-1.5 rounded-full border bg-card px-2.5 text-xs font-medium whitespace-nowrap text-foreground">
                          <span
                            aria-hidden="true"
                            className={`size-1.5 rounded-full ${
                              a.ativo ? "bg-sucesso" : "bg-muted-foreground/50"
                            }`}
                          />
                          {a.ativo ? "Ativo" : "Desativado"}
                        </span>
                        <span className="mt-1 block text-sm text-muted-foreground">
                          {a.email ?? "—"}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-sm tabular-nums text-muted-foreground whitespace-nowrap">
                        {a.telefone ? maskPhone(a.telefone) : "—"}
                      </td>

                      <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                        {dataBR(a.created_at)}
                      </td>

                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/administradores/${a.id}`}
                          className="text-sm font-semibold text-foreground underline-offset-4 hover:underline hover:text-foreground"
                        >
                          Abrir
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            {ativos === 1
              ? "Só você tem acesso hoje. Enquanto for o único, o sistema não deixa este acesso ser desativado."
              : `${ativos} acessos ativos. Todo administrador vê e mexe em tudo: repasses, parcelas, cancelamentos e os dados pessoais de compradores, corretores e vendedores.`}
          </p>
        </>
      )}
    </>
  );
}
