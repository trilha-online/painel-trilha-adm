"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  adminEdicaoSchema,
  adminSchema,
  type AdminEdicaoValues,
  type AdminFormValues,
} from "@/lib/schemas";
import { maskPhone } from "@/lib/br";
import { atualizarAdmin, criarAdmin } from "@/app/actions/admins";
import { Alert, Button, Field, Input, Section } from "@/components/ui";

/**
 * Cadastrar ou editar um administrador.
 *
 * Na criação, o acesso vem no mesmo formulário: um admin NÃO tem cadastro
 * separado do login — é uma linha da `conta`. Na edição o acesso sai daqui e
 * vai para o quadro próprio, como no parceiro: trocar nome é rotina, trocar
 * senha de outra pessoa não.
 */
export default function FormAdmin({
  modo,
  id,
  valores,
}: {
  modo: "criar" | "editar";
  id?: string;
  valores?: AdminEdicaoValues;
}) {
  const criando = modo === "criar";
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [pendente, iniciar] = useTransition();

  // O mesmo formulário atende os dois modos, então o tipo é um só e o schema
  // muda. O `as unknown as Resolver` é a convenção do projeto para isso — o
  // schema de edição valida uma forma menor que a do tipo.
  const form = useForm<AdminFormValues>({
    resolver: zodResolver(
      criando ? adminSchema : adminEdicaoSchema,
    ) as unknown as Resolver<AdminFormValues>,
    mode: "onBlur",
    defaultValues: {
      nome: valores?.nome ?? "",
      telefone: valores?.telefone ? maskPhone(valores.telefone) : "",
      acesso: { email: "", senha: "" },
    },
  });

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = form;

  const enviar = (dados: AdminFormValues) => {
    setErro(null);
    setSalvo(false);
    iniciar(async () => {
      const resultado = criando
        ? await criarAdmin(dados)
        : await atualizarAdmin(id!, { nome: dados.nome, telefone: dados.telefone });

      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      if (criando) {
        router.push(`/administradores/${resultado.id}`);
        router.refresh();
        return;
      }
      setSalvo(true);
      router.refresh();
    });
  };

  return (
    <form onSubmit={handleSubmit(enviar)} className="flex flex-col gap-6" noValidate>
      <Section
        title="Quem é"
        hint="O nome aparece no histórico: é ele que fica registrado em quem concluiu cada tarefa e decidiu cada proposta."
      >
        <Field label="Nome" error={errors.nome?.message} span={3}>
          <Input aria-invalid={!!errors.nome} {...register("nome")} />
        </Field>

        <Field
          label="Telefone"
          error={errors.telefone?.message}
          span={3}
          optional
          hint="Por enquanto nada usa: os alertas das rotinas vão para o telefone configurado no financeiro."
        >
          <Input
            inputMode="tel"
            aria-invalid={!!errors.telefone}
            {...register("telefone")}
            onChange={(e) => setValue("telefone", maskPhone(e.target.value))}
          />
        </Field>
      </Section>

      {criando ? (
        <Section
          title="Acesso"
          hint="É com esse e-mail e essa senha que a pessoa entra. Anote a senha e entregue a ela — depois de criada, não pode ser consultada, só substituída."
        >
          <Field label="E-mail de acesso" error={errors.acesso?.email?.message} span={3}>
            <Input
              type="email"
              autoComplete="off"
              aria-invalid={!!errors.acesso?.email}
              {...register("acesso.email")}
            />
          </Field>

          <Field
            label="Senha"
            error={errors.acesso?.senha?.message}
            span={3}
            hint="Mínimo de 8 caracteres."
          >
            <Input
              type="text"
              autoComplete="off"
              placeholder="••••••••"
              aria-invalid={!!errors.acesso?.senha}
              {...register("acesso.senha")}
            />
          </Field>
        </Section>
      ) : null}

      {criando ? (
        <div className="rounded-lg border border-aviso/20 bg-aviso-suave px-5 py-4 text-sm text-aviso">
          <strong className="font-semibold">Administrador vê e mexe em tudo.</strong>{" "}
          Repasses por Pix, marcar parcela como paga, cancelar negócio, CPF e dados bancários de
          incorporadoras, corretores e compradores. Não existe administrador com poder reduzido.
        </div>
      ) : null}

      {erro ? <Alert>{erro}</Alert> : null}
      {salvo ? <Alert tone="ok">Dados salvos.</Alert> : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pendente}>
          {pendente ? "Salvando…" : criando ? "Cadastrar administrador" : "Salvar"}
        </Button>
        <Link
          href={criando ? "/administradores" : `/administradores/${id}`}
          className="px-2 text-sm font-semibold text-muted-foreground underline-offset-4 hover:underline hover:text-foreground"
        >
          Cancelar
        </Link>
      </div>
    </form>
  );
}
