import { Suspense } from "react";
import Link from "next/link";
import { getSessao } from "@/lib/sessao";
import { LinkEntrar } from "@/components/link-entrar";

const ESTILO =
  "rounded-md border border-primary-foreground/30 px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-foreground/10 print:hidden";

/**
 * O botão do topo das páginas de proposta. Deslogado: "Entre em sua conta",
 * que volta para a mesma página depois do login. Logado: atalho para o painel.
 *
 * O texto é longo de propósito. Era só "Entrar", e ao lado do nome da página
 * virava uma frase sem querer — "Simulador | Entrar" se lia como "entre no
 * simulador", que é justamente o que a página NÃO exige. Dizer a conta mata a
 * ambiguidade sem precisar de explicação em volta.
 */
export async function AcessoCorretor() {
  const sessao = await getSessao();

  if (sessao?.conta) {
    return (
      <Link href="/" className={ESTILO}>
        Ir para o painel
      </Link>
    );
  }

  return (
    <Suspense
      fallback={
        <Link href="/login" className={ESTILO}>
          Entre em sua conta
        </Link>
      }
    >
      <LinkEntrar className={ESTILO}>Entre em sua conta</LinkEntrar>
    </Suspense>
  );
}
