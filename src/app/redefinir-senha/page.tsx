import type { Metadata } from "next";
import Link from "next/link";
import { TelaDeEntrada } from "@/components/publico";
import { buttonVariants } from "@/components/shadcn/button";
import { createAdminClient } from "@/lib/supabase/admin";
import { RECADO_PEDIDO, SENHA_MINIMA, lerPedido } from "@/lib/senha";
import { cn } from "@/lib/utils";
import FormRedefinirSenha from "./form";

/**
 * Criar a senha nova pelo link do WhatsApp.
 *
 * O token na URL é a credencial. `referrer: no-referrer` impede que ele vaze
 * no cabeçalho `Referer` para qualquer endereço que esta página carregue ou
 * para onde a pessoa clique a partir dela.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Senha nova · Trilha",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function RedefinirSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const lido = t ? await lerPedido(createAdminClient(), t) : ({ ok: false, motivo: "invalido" } as const);

  return (
    <TelaDeEntrada>
      {!lido.ok ? (
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Link indisponível</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">{RECADO_PEDIDO[lido.motivo]}</p>
          <div className="mt-6 flex flex-col gap-2">
            {lido.motivo === "usado" ? (
              <>
                <Link href="/login" className={cn(buttonVariants({ variant: "default" }), "h-10 w-full")}>
                  Ir para o login
                </Link>
                <Link href="/esqueci-senha" className={cn(buttonVariants({ variant: "outline" }), "h-10 w-full")}>
                  Pedir outro link
                </Link>
              </>
            ) : (
              <>
                <Link href="/esqueci-senha" className={cn(buttonVariants({ variant: "default" }), "h-10 w-full")}>
                  Pedir outro link
                </Link>
                <Link href="/login" className={cn(buttonVariants({ variant: "outline" }), "h-10 w-full")}>
                  Ir para o login
                </Link>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Crie uma senha nova</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {lido.pedido.nome ? `Olá, ${lido.pedido.nome.trim().split(/\s+/)[0]}. ` : ""}
            Depois de salvar, você já entra no painel.
          </p>

          <p className="mt-5 rounded-lg bg-muted px-4 py-3 text-sm text-foreground">
            Seu e-mail de acesso: <strong className="font-semibold">{lido.pedido.email}</strong>
          </p>

          <div className="mt-6">
            <FormRedefinirSenha token={t!} email={lido.pedido.email} minimo={SENHA_MINIMA} />
          </div>
        </div>
      )}
    </TelaDeEntrada>
  );
}
