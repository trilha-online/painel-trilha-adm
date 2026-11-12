"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button } from "@/components/ui";

/**
 * Excluir empreendimento ou unidade, em dois passos na própria tela.
 *
 * Sem `confirm()` do navegador, pela convenção do projeto: ele não diz o que
 * vai acontecer e some sozinho num toque errado no celular. A segunda tela
 * conta as duas coisas que importam antes de perguntar — o que some junto, e
 * qual é a alternativa reversível.
 *
 * O aviso de arrasto (as N unidades que vão junto) é o motivo de este
 * componente existir em vez de um botão solto: apagar um empreendimento leva
 * as unidades dele, e ninguém deveria descobrir isso depois.
 *
 * Quem decide se pode apagar é o BANCO (`on delete restrict` em proposta e
 * negócio). Este botão não tenta adivinhar: ele tenta, e mostra a frase que
 * a action montou quando a resposta é não.
 */
export function ExcluirRegistro({
  titulo,
  nome,
  arrasta,
  alternativa,
  rotulo,
  acao,
  voltarPara,
}: {
  /** O cabeçalho do quadro: "Excluir empreendimento". */
  titulo: string;
  /** O que está sendo excluído, para a pessoa reler antes de confirmar. */
  nome: string;
  /** O que some junto, já escrito ("as 23 unidades deste empreendimento"). */
  arrasta?: string;
  /** O caminho reversível, oferecido antes de a pessoa escolher o definitivo. */
  alternativa: string;
  /** O texto do botão: "Excluir empreendimento". */
  rotulo: string;
  acao: () => Promise<{ id: string | null; erro: string | null }>;
  voltarPara: string;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const excluir = () =>
    iniciar(async () => {
      setErro(null);
      const resultado = await acao();
      if (resultado.erro) {
        setErro(resultado.erro);
        setConfirmando(false);
        return;
      }
      router.push(voltarPara);
      router.refresh();
    });

  return (
    <section className="rounded-xl border border-destructive/20 bg-erro-suave p-6">
      <h2 className="text-base font-semibold text-destructive">{titulo}</h2>

      {confirmando ? (
        <>
          <p className="mt-2 text-sm text-destructive">
            Excluir <strong>{nome}</strong>
            {arrasta ? (
              <>
                {" "}
                apaga também <strong>{arrasta}</strong>
              </>
            ) : null}
            . Isso não tem volta.
          </p>
          <p className="mt-2 text-sm text-destructive">{alternativa}</p>

          {erro ? (
            <div className="mt-4">
              <Alert>{erro}</Alert>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={excluir}
              disabled={pendente}
              className="inline-flex items-center justify-center rounded-md bg-destructive px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
            >
              {pendente ? "Excluindo…" : "Sim, excluir"}
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
            {arrasta ? `Apaga o cadastro e ${arrasta}. ` : "Apaga o cadastro. "}
            {alternativa}
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
            {rotulo}
          </button>
        </>
      )}
    </section>
  );
}
