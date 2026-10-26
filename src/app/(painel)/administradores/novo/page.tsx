import { redirect } from "next/navigation";
import { ehAdmin, getSessao } from "@/lib/sessao";
import { PageHeader } from "@/components/ui";
import FormAdmin from "@/components/form-admin";

export default async function NovoAdministradorPage() {
  if (!ehAdmin(await getSessao())) redirect("/");

  return (
    <>
      <PageHeader
        titulo="Cadastrar administrador"
        descricao="Cria o acesso na hora: um administrador é o próprio login, sem cadastro em separado."
        voltar={{ href: "/administradores", label: "Administradores" }}
      />
      <FormAdmin modo="criar" />
    </>
  );
}
