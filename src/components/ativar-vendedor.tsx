"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { definirAtivoVendedor } from "@/app/actions/incorporadoras";
import { Alert, Button } from "@/components/ui";

/**
 * Desativar ou reativar um vendedor, em dois passos na própria tela.
 *
 * Dois passos porque o efeito é grande e imediato: além de o acesso parar, o
 * estoque inteiro dela some do simulador — quem estiver com a página aberta
 * deixa de conseguir simular naquele momento. Isso precisa estar escrito
 * antes de a pessoa confirmar, não depois.
 *
 * Reativar é um clique só: é a ação reversível.
 */
export function AtivarVendedor({
  id,
  nome,
  ativo,
  unidades,
  pessoaFisica,
}: {
  id: string;
  nome: string;
  ativo: boolean;
  /** Quantas unidades disponíveis saem do ar. Zero some da frase. */
  unidades: number;
  pessoaFisica: boolean;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const termo = pessoaFisica ? "proprietário" : "vendedor";

  const mudar = (novo: boolean) =>
    iniciar(async () => {
      setErro(null);
      const resultado = await definirAtivoVendedor(id, novo);
      if (resultado.erro) {
        setErro(resultado.erro);
        setConfirmando(false);
        return;
      }
      setConfirmando(false);
      router.refresh();
    });

  if (!ativo) {
    return (
      <section className="rounded-xl border bg-card p-6 shadow-xs">
        <h2 className="text-base font-semibold text-foreground">Cadastro desativado</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {nome} não entra no painel e o estoque dela não aparece no simulador. Nada foi apagado:
          as trilhas em andamento, as propostas e o histórico continuam.
        </p>

        {erro ? (
          <div className="mt-4">
            <Alert>{erro}</Alert>
          </div>
        ) : null}

        <div className="mt-5">
          <Button type="button" disabled={pendente} onClick={() => mudar(true)}>
            {pendente ? "Reativando…" : "Reativar cadastro"}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-destructive/20 bg-erro-suave p-6">
      <h2 className="text-base font-semibold text-destructive">Desativar {termo}</h2>

      {confirmando ? (
        <>
          <p className="mt-2 text-sm text-destructive">
            <strong>{nome}</strong> perde o acesso ao painel na hora
            {unidades > 0 ? (
              <>
                , e {unidades === 1 ? "a unidade disponível dela sai" : `as ${unidades} unidades disponíveis dela saem`}{" "}
                do simulador e do painel dos corretores
              </>
            ) : null}
            .
          </p>
          <p className="mt-2 text-sm text-destructive">
            Os corretores dela <strong>continuam ativos</strong> — cada um se desativa na ficha
            dele. Nada é apagado, e dá para reativar depois nesta mesma tela.
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
              {pendente ? "Desativando…" : `Sim, desativar`}
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
            Tira o acesso e o estoque do ar, sem apagar nada. É o caminho para parceria encerrada
            ou suspensa — e dá para reativar depois.
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
            Desativar {termo}
          </button>
        </>
      )}
    </section>
  );
}
