"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { definirSenhaNova } from "@/app/actions/senha";
import { Alert, Button, Field, InputSenha } from "@/components/ui";

/**
 * A senha nova, com confirmação. O campo escondido de e-mail não aparece na
 * tela: é o que permite ao gerenciador de senhas do navegador guardar a senha
 * nova junto com o login certo.
 */
export default function FormRedefinirSenha({
  token,
  email,
  minimo,
}: {
  token: string;
  email: string;
  minimo: number;
}) {
  const router = useRouter();
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);

    if (senha.length < minimo) {
      setErro(`A senha precisa ter ao menos ${minimo} caracteres.`);
      return;
    }
    if (senha !== confirmacao) {
      setErro("As duas senhas não são iguais.");
      return;
    }

    setEnviando(true);
    const r = await definirSenhaNova(token, senha);

    if (!r.ok) {
      setEnviando(false);
      setErro(r.erro);
      return;
    }

    // Com a sessão pronta, vai direto para o painel; sem ela (raro), para o
    // login, onde a senha nova já vale.
    router.replace(r.entrou ? "/" : "/login");
    router.refresh();
  };

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />

      <Field label="Senha nova" span={6} hint={`Mínimo de ${minimo} caracteres.`}>
        <InputSenha autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
      </Field>

      <Field label="Repita a senha nova" span={6}>
        <InputSenha
          autoComplete="new-password"
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
        />
      </Field>

      {erro ? <Alert>{erro}</Alert> : null}

      <Button type="submit" disabled={enviando} className="h-10">
        {enviando ? "Salvando…" : "Salvar e entrar"}
      </Button>
    </form>
  );
}
