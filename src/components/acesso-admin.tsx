"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { acessoSchema, type AcessoFormValues } from "@/lib/schemas";
import { atualizarAcessoAdmin, definirAtivoAdmin } from "@/app/actions/admins";
import { Alert, Button, Field, Input, Section } from "@/components/ui";

/** Troca de e-mail e senha de um administrador. */
export function AcessoAdmin({ id, emailAtual }: { id: string; emailAtual: string }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [pendente, iniciar] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AcessoFormValues>({
    resolver: zodResolver(acessoSchema),
    mode: "onBlur",
    defaultValues: { email: emailAtual, senha: "" },
  });

  const enviar = (valores: AcessoFormValues) => {
    setErro(null);
    setSalvo(false);
    iniciar(async () => {
      const resultado = await atualizarAcessoAdmin(id, valores);
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      setSalvo(true);
      reset({ email: valores.email, senha: "" });
      router.refresh();
    });
  };

  return (
    <form onSubmit={handleSubmit(enviar)} className="flex flex-col gap-6" noValidate>
      <Section
        title="Acesso"
        hint="É com esses dados que ela entra no painel. A senha atual não pode ser consultada — só substituída."
      >
        <Field label="E-mail de acesso" error={errors.email?.message} span={3}>
          <Input type="email" aria-invalid={!!errors.email} {...register("email")} />
        </Field>

        <Field
          label="Nova senha"
          error={errors.senha?.message}
          span={3}
          optional
          hint="Deixe em branco para manter a senha atual. Mínimo de 8 caracteres."
        >
          <Input
            type="text"
            autoComplete="off"
            placeholder="••••••••"
            aria-invalid={!!errors.senha}
            {...register("senha")}
          />
        </Field>
      </Section>

      {erro ? <Alert>{erro}</Alert> : null}
      {salvo ? (
        <Alert tone="ok">
          Acesso atualizado. Se você definiu uma senha nova, entregue a ela — a senha não poderá
          ser consultada depois.
        </Alert>
      ) : null}

      <div>
        <Button type="submit" disabled={pendente}>
          {pendente ? "Salvando…" : "Salvar acesso"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Desativar ou reativar o acesso, em dois passos na própria tela.
 *
 * Dois passos porque é irreversível do ponto de vista de quem está do outro
 * lado: a pessoa é desconectada e, se for ela mesma mexendo, perde a tela onde
 * desfaria. Sem `confirm()` do navegador, pela convenção do projeto.
 *
 * Reativar é um clique só: é a ação reversível.
 */
export function AtivarAdmin({
  id,
  nome,
  ativo,
  souEu,
  protegido,
}: {
  id: string;
  nome: string;
  ativo: boolean;
  souEu: boolean;
  protegido: boolean;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const mudar = (novo: boolean) =>
    iniciar(async () => {
      setErro(null);
      const resultado = await definirAtivoAdmin(id, novo);
      if (resultado.erro) {
        setErro(resultado.erro);
        setConfirmando(false);
        return;
      }
      setConfirmando(false);
      router.refresh();
    });

  // A conta principal não oferece a ação. A trava de verdade é o gatilho
  // `conta_protegida` no banco — isto aqui é só não mostrar um botão que
  // existiria para falhar.
  if (protegido) {
    return (
      <section className="rounded-xl border bg-card p-6 shadow-xs">
        <h2 className="text-base font-semibold text-foreground">Conta principal</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Este é o acesso principal da Trilha. Ele não pode ser desativado, apagado nem deixar de
          ser administrador — por ninguém, nem por você. Nome, e-mail e senha continuam editáveis
          acima.
        </p>
      </section>
    );
  }

  if (!ativo) {
    return (
      <section className="rounded-xl border bg-card p-6 shadow-xs">
        <h2 className="text-base font-semibold text-foreground">Acesso desativado</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {nome} não entra no painel. O histórico do que ela fez continua no nome dela.
        </p>

        {erro ? (
          <div className="mt-4">
            <Alert>{erro}</Alert>
          </div>
        ) : null}

        <div className="mt-5">
          <Button type="button" disabled={pendente} onClick={() => mudar(true)}>
            {pendente ? "Reativando…" : "Reativar acesso"}
          </Button>
        </div>
      </section>
    );
  }

  if (souEu) {
    return (
      <section className="rounded-xl border bg-card p-6 shadow-xs">
        <h2 className="text-base font-semibold text-foreground">Desativar acesso</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Este é o seu próprio acesso. Para desativá-lo, peça a outro administrador — quem se
          desativa perde justamente a tela onde desfaria isso.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-destructive/20 bg-erro-suave p-6">
      <h2 className="text-base font-semibold text-destructive">Desativar acesso</h2>

      {confirmando ? (
        <>
          <p className="mt-2 text-sm text-destructive">
            <strong>{nome}</strong> perde o acesso ao painel na hora — inclusive se estiver com a
            tela aberta neste momento.
          </p>
          <p className="mt-2 text-sm text-destructive">
            O cadastro fica guardado e o histórico continua no nome dela. Dá para reativar depois,
            nesta mesma tela.
          </p>

          {erro ? (
            <div className="mt-4">
              <Alert>{erro}</Alert>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => mudar(false)}
              disabled={pendente}
              className="inline-flex items-center justify-center rounded-md bg-destructive px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
            >
              {pendente ? "Desativando…" : `Sim, desativar ${nome.split(" ")[0]}`}
            </button>
            <Button
              type="button"
              variant="ghost"
              disabled={pendente}
              onClick={() => setConfirmando(false)}
            >
              Cancelar
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-destructive">
            Tira o acesso sem apagar nada. O histórico do que {nome.split(" ")[0]} fez continua no
            nome dela, e dá para reativar depois.
          </p>

          {erro ? (
            <div className="mt-4">
              <Alert>{erro}</Alert>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => setConfirmando(true)}
            className="mt-4 inline-flex items-center justify-center rounded-md border border-destructive/30 bg-card px-5 py-2.5 text-sm font-semibold text-destructive transition-colors hover:bg-erro-suave"
          >
            Desativar acesso
          </button>
        </>
      )}
    </section>
  );
}
