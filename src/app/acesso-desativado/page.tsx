import { redirect } from "next/navigation";
import { TelaDeEntrada } from "@/components/publico";
import { contaDesativada, getSessao } from "@/lib/sessao";
import { signOut } from "@/app/actions/auth";

/**
 * Onde cai quem tem login mas está com o acesso desligado.
 *
 * Precisa ser FORA do grupo `(painel)`: se morasse dentro, o layout do painel
 * — que é justamente quem manda a pessoa para cá — faria um redirecionamento
 * em círculo.
 *
 * O texto não explica o motivo nem diz quem desativou: isso é assunto entre
 * sócios, não mensagem de sistema.
 */
export default async function AcessoDesativadoPage() {
  const sessao = await getSessao();

  // Quem chegou aqui por engano (ou foi reativado com a aba aberta) volta ao
  // painel em vez de ficar olhando um aviso que não vale mais.
  if (!contaDesativada(sessao)) redirect("/");

  return (
    <TelaDeEntrada>
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Seu acesso está desativado
        </h1>
        <p className="text-sm text-muted-foreground">
          O login de <strong className="font-medium text-foreground">{sessao!.email}</strong>{" "}
          existe, mas está desligado. Fale com outro administrador da Trilha para reativá-lo.
        </p>
      </div>

      <form action={signOut} className="mt-8">
        <button
          type="submit"
          className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
        >
          Sair
        </button>
      </form>
    </TelaDeEntrada>
  );
}
