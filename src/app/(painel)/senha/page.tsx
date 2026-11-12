import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getSessao } from "@/lib/sessao";
import { SENHA_MINIMA } from "@/lib/senha";
import FormTrocarSenha from "./form";

/**
 * Trocar a própria senha, para qualquer perfil. Quem esqueceu a atual não usa
 * esta tela: sai e pede o link em "Esqueci minha senha", no login.
 */
export default async function TrocarSenhaPage() {
  const sessao = await getSessao();
  if (!sessao) redirect("/login");

  return (
    <div className="max-w-xl">
      <PageHeader titulo="Trocar senha" />
      <FormTrocarSenha email={sessao.email} minimo={SENHA_MINIMA} />
    </div>
  );
}
