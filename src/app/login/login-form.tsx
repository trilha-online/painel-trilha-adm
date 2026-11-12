"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { loginSchema } from "@/lib/schemas";
import { signIn } from "@/app/actions/auth";
import { Alert, Button, Field, Input, InputSenha } from "@/components/ui";

type Values = z.infer<typeof loginSchema>;

export default function LoginForm({ voltar }: { voltar?: string }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(loginSchema) });

  const onSubmit = (values: Values) => {
    setServerError(null);
    startTransition(async () => {
      const result = await signIn(values.email, values.password);
      if (result.error) {
        setServerError(result.error);
        return;
      }
      router.replace(voltar ?? "/incorporadoras");
      router.refresh();
    });
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-5"
      noValidate
    >
      <Field label="E-mail" error={errors.email?.message} span={6}>
        <Input
          type="email"
          autoComplete="email"
          placeholder="voce@trilha.online"
          aria-invalid={!!errors.email}
          {...register("email")}
        />
      </Field>

      <div className="flex flex-col gap-2">
        <Field label="Senha" error={errors.password?.message} span={6}>
          <InputSenha
            autoComplete="current-password"
            placeholder="••••••••"
            aria-invalid={!!errors.password}
            {...register("password")}
          />
        </Field>
        <Link
          href="/esqueci-senha"
          className="self-end text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          Esqueci minha senha
        </Link>
      </div>

      {serverError ? <Alert>{serverError}</Alert> : null}

      <Button type="submit" disabled={pending} className="mt-1 h-10 w-full">
        {pending ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}
