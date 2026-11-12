"use client";

import { useState } from "react";
import { trocarSenha } from "@/app/actions/senha";
import { Alert, Button, Field, InputSenha, Section } from "@/components/ui";

/**
 * Senha atual + nova + confirmação. Ao salvar, as outras sessões abertas com
 * este acesso são encerradas (outro computador, celular); esta continua.
 */
export default function FormTrocarSenha({ email, minimo }: { email: string; minimo: number }) {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    setFeito(false);

    if (nova.length < minimo) {
      setErro(`A senha nova precisa ter ao menos ${minimo} caracteres.`);
      return;
    }
    if (nova !== confirmacao) {
      setErro("As duas senhas novas não são iguais.");
      return;
    }

    setEnviando(true);
    const r = await trocarSenha(atual, nova);
    setEnviando(false);

    if (!r.ok) {
      setErro(r.erro);
      return;
    }

    setAtual("");
    setNova("");
    setConfirmacao("");
    setFeito(true);
  };

  return (
    <form onSubmit={enviar} className="flex flex-col gap-5">
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />

      <Section title="Senha do seu acesso" hint={`Acesso: ${email}`}>
        <Field label="Senha atual" span={6}>
          <InputSenha autoComplete="current-password" value={atual} onChange={(e) => setAtual(e.target.value)} />
        </Field>
        <Field label="Senha nova" span={6} hint={`Mínimo de ${minimo} caracteres.`}>
          <InputSenha autoComplete="new-password" value={nova} onChange={(e) => setNova(e.target.value)} />
        </Field>
        <Field label="Repita a senha nova" span={6}>
          <InputSenha
            autoComplete="new-password"
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
          />
        </Field>
      </Section>

      {erro ? <Alert>{erro}</Alert> : null}
      {feito ? (
        <Alert tone="ok">
          Senha trocada. Se este acesso estava aberto em outro computador ou celular, lá ele vai pedir a senha
          nova.
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          Esqueceu a senha atual? Saia e use &quot;Esqueci minha senha&quot; na tela de login.
        </p>
        <Button type="submit" disabled={enviando || !atual || !nova || !confirmacao}>
          {enviando ? "Trocando…" : "Trocar senha"}
        </Button>
      </div>
    </form>
  );
}
