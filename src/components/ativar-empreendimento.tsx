"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { definirAtivoEmpreendimento } from "@/app/actions/empreendimentos";
import { Alert, Button } from "@/components/ui";

/**
 * Tirar o empreendimento do ar, ou devolvê-lo.
 *
 * Fica ACIMA do quadro de excluir de propósito: é o caminho reversível, e a
 * pessoa tem que encontrar este antes de encontrar aquele. Quase todo caso
 * real de "não vende mais" é este, não exclusão.
 *
 * Dois passos, porque o efeito é grande e imediato: o prédio inteiro some do
 * simulador, do painel do corretor e do painel do vendedor no mesmo instante.
 * Devolver ao ar é um clique só — é a ação reversível da reversível.
 */
export function AtivarEmpreendimento({
  id,
  nome,
  ativo,
  unidadesDisponiveis,
}: {
  id: string;
  nome: string;
  ativo: boolean;
  unidadesDisponiveis: number;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const mudar = (novo: boolean) =>
    iniciar(async () => {
      setErro(null);
      const resultado = await definirAtivoEmpreendimento(id, novo);
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
        <h2 className="text-base font-semibold text-foreground">Indisponível</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {nome} está fora do ar. Não aparece no simulador, nem no painel do corretor, nem no do
          vendedor — só aqui. As unidades, as condições e o histórico continuam guardados.
        </p>

        {erro ? (
          <div className="mt-4">
            <Alert>{erro}</Alert>
          </div>
        ) : null}

        <div className="mt-5">
          <Button type="button" disabled={pendente} onClick={() => mudar(true)}>
            {pendente ? "Devolvendo…" : "Devolver ao ar"}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border bg-card p-6 shadow-xs">
      <h2 className="text-base font-semibold text-foreground">Tirar do ar</h2>

      {confirmando ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            <strong className="text-foreground">{nome}</strong> sai do simulador, do painel do
            corretor e do painel do vendedor na hora
            {unidadesDisponiveis > 0 ? (
              <>
                , com {unidadesDisponiveis === 1 ? "a unidade disponível" : `as ${unidadesDisponiveis} unidades disponíveis`}{" "}
                dele
              </>
            ) : null}
            . Só a Trilha continua vendo.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Nada é apagado, e os negócios que já existem seguem normalmente. Dá para devolver ao ar
            aqui mesmo, quando quiser.
          </p>

          {erro ? (
            <div className="mt-4">
              <Alert>{erro}</Alert>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button type="button" disabled={pendente} onClick={() => mudar(false)}>
              {pendente ? "Tirando do ar…" : "Sim, tirar do ar"}
            </Button>
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
          <p className="mt-2 text-sm text-muted-foreground">
            Guarda o cadastro e tira o prédio da vitrine. É o caminho para parceria suspensa ou
            estoque que saiu da plataforma — reversível, sem perder nada.
          </p>

          {erro ? (
            <div className="mt-4">
              <Alert>{erro}</Alert>
            </div>
          ) : null}

          <Button type="button" variant="ghost" className="mt-4" onClick={() => setConfirmando(true)}>
            Tirar do ar
          </Button>
        </>
      )}
    </section>
  );
}
