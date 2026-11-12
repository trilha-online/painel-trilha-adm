"use client";

import { useState } from "react";
import Link from "next/link";
import { pedirSenhaNova } from "@/app/actions/senha";
import { buttonVariants } from "@/components/shadcn/button";
import { Alert, Button, Field, Input } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Pedir o link. Depois de enviar, a tela diz SEMPRE a mesma coisa, exista ou
 * não um acesso com o e-mail — é o que impede a tela de servir para descobrir
 * quem está cadastrado. Por isso o texto é condicional ("se houver…").
 */
export default function FormEsqueciSenha({ minutos }: { minutos: number }) {
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    const r = await pedirSenhaNova(email);
    setEnviando(false);
    if (!r.ok) {
      setErro(r.erro);
      return;
    }
    setEnviado(true);
  };

  if (enviado) {
    return (
      <div className="flex flex-col">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Confira o seu WhatsApp</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Se houver um acesso com <strong className="font-semibold text-foreground">{email.trim()}</strong>, o link
          para criar a senha nova chega em instantes no WhatsApp cadastrado. Ele vale por {minutos} minutos.
        </p>
        <p className="mt-4 rounded-lg bg-muted px-4 py-3 text-sm leading-relaxed text-foreground">
          Não chegou em alguns minutos? Confira se o e-mail está certo e peça de novo, ou fale com a equipe da
          Trilha.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Link href="/login" className={cn(buttonVariants({ variant: "default" }), "h-10 w-full")}>
            Voltar para o login
          </Link>
          <Button
            type="button"
            variant="ghost"
            className="h-10 w-full"
            onClick={() => {
              setEnviado(false);
              setErro(null);
            }}
          >
            Usar outro e-mail
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Esqueci minha senha</h1>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        Digite o e-mail do seu acesso. Mandamos um link para o WhatsApp do seu cadastro, e por ele você cria
        uma senha nova.
      </p>

      <form onSubmit={enviar} className="mt-8 flex flex-col gap-5" noValidate>
        <Field label="E-mail" span={6}>
          <Input
            type="email"
            autoComplete="email"
            placeholder="voce@exemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!erro}
          />
        </Field>

        {erro ? <Alert>{erro}</Alert> : null}

        <Button type="submit" disabled={enviando || !email.trim()} className="mt-1 h-10 w-full">
          {enviando ? "Enviando…" : "Enviar link"}
        </Button>

        <Link
          href="/login"
          className="self-center text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          Voltar para o login
        </Link>
      </form>
    </div>
  );
}
