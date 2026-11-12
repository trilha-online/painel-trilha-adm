"use client";

import { forwardRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button as BotaoShadcn, buttonVariants } from "@/components/shadcn/button";
import { Input as InputShadcn } from "@/components/shadcn/input";
import { Textarea as TextareaShadcn } from "@/components/shadcn/textarea";
import { usePublicarMigalhas } from "@/components/migalhas";

/**
 * Os componentes básicos do painel.
 *
 * Desde a Sprint 4.2c, por dentro são os da shadcn/ui — mas os nomes e as
 * props continuam os mesmos de antes, para as ~40 telas ganharem o visual
 * novo sem precisar ser reescritas. Código novo pode usar estes ou os de
 * `@/components/shadcn/*` diretamente.
 *
 * Regra de cor (decisão da Elena, 22/set): TEXTO sempre em preto ou cinza.
 * O azul-marinho é fundo do botão principal; o roxo aparece só como ponto
 * (bolinha de status, ícone ativo, foco) — nunca como cor de texto.
 */

// ------------------------------------------------------------ formulários

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card p-6 shadow-xs">
      <header className="mb-5">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}
      </header>
      <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-6">{children}</div>
    </section>
  );
}

const spanClass: Record<number, string> = {
  1: "sm:col-span-1",
  2: "sm:col-span-2",
  3: "sm:col-span-3",
  4: "sm:col-span-4",
  6: "sm:col-span-6",
};

export function Field({
  label,
  error,
  span = 3,
  children,
  optional,
  hint,
}: {
  label: string;
  error?: string;
  span?: 1 | 2 | 3 | 4 | 6;
  children: React.ReactNode;
  optional?: boolean;
  hint?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", spanClass[span])}>
      <label className="text-sm font-medium text-foreground">
        {label}
        {optional ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">opcional</span> : null}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <InputShadcn ref={ref} className={cn("h-9 bg-card", className)} {...props} />;
  },
);

/**
 * Campo de senha com o "olhinho": um clique mostra o que foi digitado, outro
 * esconde de novo. Começa sempre escondido.
 *
 * É para quem digita a PRÓPRIA senha — login, primeiro acesso, redefinir e
 * trocar senha. Os campos em que a Trilha define a senha de OUTRA pessoa
 * (ficha de acesso de vendedor, corretor e administrador) continuam em texto
 * aberto de propósito: quem cadastra precisa ver e anotar o que digitou.
 *
 * O botão é `type="button"` para não enviar o formulário. Continua alcançável
 * pelo Tab, de propósito: quem usa teclado ou leitor de tela também precisa
 * conseguir conferir o que digitou.
 */
export const InputSenha = forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">
>(function InputSenha({ className, disabled, ...props }, ref) {
  const [visivel, setVisivel] = useState(false);
  const rotulo = visivel ? "Esconder senha" : "Mostrar senha";

  return (
    <div className="relative">
      <InputShadcn
        ref={ref}
        type={visivel ? "text" : "password"}
        disabled={disabled}
        className={cn("h-9 bg-card pr-10", className)}
        {...props}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => setVisivel((v) => !v)}
        aria-label={rotulo}
        aria-pressed={visivel}
        title={rotulo}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
      >
        {visivel ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
      </button>
    </div>
  );
});

/**
 * Lista suspensa nativa, com o visual dos campos da shadcn. A `<select>` do
 * navegador foi mantida de propósito: todo formulário do projeto a usa com
 * `register` do react-hook-form, e a lista da shadcn tem outra API.
 */
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          "h-9 w-full min-w-0 rounded-md border border-input bg-card px-3 py-1 text-sm text-foreground shadow-xs outline-none transition-[color,box-shadow]",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 3, ...props }, ref) {
  return <TextareaShadcn ref={ref} rows={rows} className={cn("min-h-0 bg-card", className)} {...props} />;
});

export const Checkbox = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { label: string }
>(function Checkbox({ label, className, ...props }, ref) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 py-2 text-sm text-foreground">
      <input
        ref={ref}
        type="checkbox"
        className={cn("size-4 rounded border-input accent-primary", className)}
        {...props}
      />
      {label}
    </label>
  );
});

// ------------------------------------------------------------ ações

/**
 * `primary` = a ação principal da tela (azul-marinho); `ghost` = a
 * secundária (contornado, fundo branco). Mesmos nomes de antes da 4.2c.
 */
export function Button({
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" }) {
  return (
    <BotaoShadcn
      variant={variant === "primary" ? "default" : "outline"}
      className={cn("h-9 px-4", className)}
      {...props}
    />
  );
}

export function Alert({
  children,
  tone = "erro",
}: {
  children: React.ReactNode;
  tone?: "erro" | "ok";
}) {
  return (
    <p
      role={tone === "erro" ? "alert" : "status"}
      className={cn(
        "rounded-lg border px-4 py-3 text-sm",
        tone === "erro"
          ? "border-destructive/20 bg-erro-suave text-destructive"
          : "border-sucesso/20 bg-sucesso-suave text-sucesso",
      )}
    >
      {children}
    </p>
  );
}

// ------------------------------------------------------------ página

type Acao = { href: string; label: string };

export function PageHeader({
  titulo,
  descricao,
  voltar,
  acao,
  acaoSecundaria,
}: {
  titulo: string;
  descricao?: string;
  voltar?: Acao;
  acao?: Acao;
  acaoSecundaria?: Acao;
}) {
  // A trilha do cabeçalho ("Negócios / Apto 302") sai daqui: título e voltar.
  usePublicarMigalhas(titulo, voltar);

  return (
    <div className="mb-8 flex flex-col gap-3">
      {/* No computador quem leva de volta é a trilha do cabeçalho. No celular
          ela mostra só a página atual, então o "voltar" continua aqui. */}
      {voltar ? (
        <Link
          href={voltar.href}
          className="-ml-1 inline-flex w-fit items-center gap-1 rounded-md px-1 text-sm text-muted-foreground transition-colors hover:text-foreground sm:hidden"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          {voltar.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{titulo}</h1>
          {descricao ? <p className="text-sm text-muted-foreground">{descricao}</p> : null}
        </div>
        {acao || acaoSecundaria ? (
          <div className="flex flex-wrap items-center gap-2">
            {acaoSecundaria ? (
              <Link href={acaoSecundaria.href} className={buttonVariants({ variant: "outline" })}>
                {acaoSecundaria.label}
              </Link>
            ) : null}
            {acao ? (
              <Link href={acao.href} className={buttonVariants({ variant: "default" })}>
                {acao.label}
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyState({
  titulo,
  texto,
  acao,
}: {
  titulo: string;
  texto: string;
  acao?: { href: string; label: string };
}) {
  return (
    <div className="rounded-xl border border-dashed bg-card px-6 py-16 text-center">
      <p className="text-base font-semibold text-foreground">{titulo}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">{texto}</p>
      {acao ? (
        <Link href={acao.href} className={cn(buttonVariants({ variant: "default" }), "mt-6")}>
          {acao.label}
        </Link>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------ status e números

/** A cor do status vai na BOLINHA; o texto fica neutro. */
const PONTO_STATUS: Record<string, string> = {
  disponivel: "bg-sucesso",
  reservado: "bg-aviso",
  em_negociacao: "bg-destaque",
  em_trilha: "bg-primary",
  indisponivel: "bg-muted-foreground/50",
};

export function StatusPill({ status, label }: { status: string; label: string }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full border bg-card px-2.5 text-xs font-medium whitespace-nowrap text-foreground">
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", PONTO_STATUS[status] ?? "bg-muted-foreground/50")} />
      {label}
    </span>
  );
}

const PONTO_TOM = {
  padrao: null,
  positivo: "bg-sucesso",
  atencao: "bg-aviso",
  destaque: "bg-destaque",
} as const;

/**
 * Cartão de número. Vira link quando há para onde ir — é assim que os
 * contadores levam para a lista já filtrada. O tom vira uma bolinha ao lado
 * do rótulo; o número fica sempre em preto.
 */
export function Stat({
  valor,
  label,
  href,
  tom = "padrao",
}: {
  valor: number | string;
  label: string;
  href?: string;
  tom?: "padrao" | "positivo" | "atencao" | "destaque";
}) {
  const ponto = PONTO_TOM[tom];
  const conteudo = (
    <>
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        {ponto ? <span aria-hidden="true" className={cn("size-2 rounded-full", ponto)} /> : null}
        {label}
      </span>
      <span className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">{valor}</span>
    </>
  );
  const base = "flex flex-col gap-1.5 rounded-xl border bg-card px-5 py-4 shadow-xs";

  return href ? (
    <Link href={href} className={cn(base, "transition-colors hover:border-foreground/20 hover:bg-accent/40")}>
      {conteudo}
    </Link>
  ) : (
    <div className={base}>{conteudo}</div>
  );
}
