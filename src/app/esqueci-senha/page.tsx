import type { Metadata } from "next";
import { TelaDeEntrada } from "@/components/publico";
import { MINUTOS_DO_LINK } from "@/lib/senha";
import FormEsqueciSenha from "./form";

/**
 * "Esqueci minha senha". Pública: quem chega aqui não consegue entrar.
 * O link chega no WhatsApp do cadastro (decisão da Elena, 12/nov).
 */
export const metadata: Metadata = {
  title: "Esqueci minha senha · Trilha",
  robots: { index: false, follow: false },
};

export default function EsqueciSenhaPage() {
  return (
    <TelaDeEntrada>
      <FormEsqueciSenha minutos={MINUTOS_DO_LINK} />
    </TelaDeEntrada>
  );
}
