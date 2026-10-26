import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ehAdmin, getSessao } from "@/lib/sessao";
import { PageHeader } from "@/components/ui";
import ErroLeitura from "@/components/erro-leitura";
import FormAdmin from "@/components/form-admin";
import { AcessoAdmin, AtivarAdmin } from "@/components/acesso-admin";

export const dynamic = "force-dynamic";

type Admin = {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  ativo: boolean;
  /** Conta principal da Trilha: não se desativa nem se apaga. */
  protegido: boolean;
};

export default async function AdministradorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const sessao = await getSessao();
  if (!ehAdmin(sessao)) redirect("/");

  const { id } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conta")
    .select("id, nome, email, telefone, ativo, protegido")
    .eq("id", id)
    .eq("tipo", "trilha_admin")
    .maybeSingle<Admin>();

  // "Não existe" e "não consigo ler" são coisas diferentes: olhar o erro antes
  // de mostrar 404 é convenção do projeto.
  if (error) return <ErroLeitura oQue="deste administrador" erro={error} />;
  if (!data) notFound();

  const souEu = data.id === sessao!.usuarioId;

  return (
    <>
      <PageHeader
        titulo={data.nome}
        descricao={
          data.protegido
            ? "Conta principal da Trilha."
            : souEu
              ? "Seu acesso."
              : "Administrador da Trilha."
        }
        voltar={{ href: "/administradores", label: "Administradores" }}
      />

      <div className="flex flex-col gap-8">
        <FormAdmin
          modo="editar"
          id={data.id}
          valores={{ nome: data.nome, telefone: data.telefone ?? "" }}
        />

        <AcessoAdmin id={data.id} emailAtual={data.email ?? ""} />

        <AtivarAdmin
          id={data.id}
          nome={data.nome}
          ativo={data.ativo}
          souEu={souEu}
          protegido={data.protegido}
        />
      </div>
    </>
  );
}
