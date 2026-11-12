"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { definirPrimeiroAcesso } from "@/app/actions/convite";
import { Alert, Button, Field, InputSenha } from "@/components/ui";

/**
 * Definir a senha e entrar.
 *
 * A confirmação continua mesmo com o "esqueci minha senha" e o olhinho: errar
 * a digitação aqui queimaria o convite e mandaria o corretor, logo no primeiro
 * contato, para o caminho da senha esquecida.
 */
export default function FormPrimeiroAcesso({ token }: { token: string }) {
  const router = useRouter();
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);

    if (senha.length < 8) {
      setErro("A senha precisa ter ao menos 8 caracteres.");
      return;
    }
    if (senha !== confirmacao) {
      setErro("As duas senhas não são iguais.");
      return;
    }

    setEnviando(true);
    const r = await definirPrimeiroAcesso(token, senha);
    setEnviando(false);

    if (!r.ok) {
      setErro(r.erro);
      return;
    }

    // A action já deixou a sessão pronta nos cookies.
    router.replace("/");
    router.refresh();
  };

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      {/* Field, e não <label> em volta do campo: o olhinho é um botão, e
          botão dentro de <label> é HTML inválido e confunde leitor de tela. */}
      <Field label="Crie uma senha" span={6} hint="Mínimo de 8 caracteres.">
        <InputSenha
          autoComplete="new-password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
        />
      </Field>

      <Field label="Repita a senha" span={6}>
        <InputSenha
          autoComplete="new-password"
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
        />
      </Field>

      {erro ? <Alert>{erro}</Alert> : null}

      <Button type="submit" disabled={enviando}>
        {enviando ? "Criando o seu acesso…" : "Entrar na plataforma"}
      </Button>
    </form>
  );
}
