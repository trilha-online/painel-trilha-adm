"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { UnidadeSimulavel } from "@/lib/simulador";
import { caracteristicas } from "@/lib/unidade";

const normalizar = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const MAX_RESULTADOS = 30;

/**
 * A escolha da unidade, dentro do empreendimento já selecionado.
 *
 * Mesmo desenho da busca de empreendimento, e pelo mesmo motivo: o campo
 * continua editável depois da escolha, com a unidade escrita dentro. Trocar
 * de unidade é digitar outra — não existe voltar, porque não se saiu de lugar
 * nenhum.
 *
 * Sem empreendimento escolhido o campo aparece desativado em vez de sumir:
 * assim a pessoa vê desde o começo que são dois passos, e qual falta.
 */
export function BuscaUnidade({
  empreendimentoId,
  unidades,
  selecionada,
  base = "/proposta",
}: {
  empreendimentoId?: string;
  unidades: UnidadeSimulavel[];
  selecionada?: UnidadeSimulavel;
  /** Para onde a escolha leva. A "Nova negociação" do painel usa a mesma busca. */
  base?: string;
}) {
  const router = useRouter();
  const nomeEscolhido = selecionada?.identificacao ?? "";
  const [texto, setTexto] = useState(nomeEscolhido);
  const [aberto, setAberto] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  // Escolher recarrega a página no servidor. Sem sinal nenhum, o toque parece
  // não ter funcionado — e quem está usando isto está na frente de um cliente.
  const [buscando, iniciar] = useTransition();

  // Quando a escolha muda no servidor, o campo acompanha. Ajustar o estado
  // durante a renderização, e não num efeito, é o padrão que o próprio React
  // recomenda para "estado derivado de prop": um efeito aqui renderizaria a
  // tela duas vezes a cada troca de unidade.
  const [ultimoNome, setUltimoNome] = useState(nomeEscolhido);
  if (nomeEscolhido !== ultimoNome) {
    setUltimoNome(nomeEscolhido);
    setTexto(nomeEscolhido);
  }

  const resultados = useMemo(() => {
    const termo = normalizar(texto.trim());
    const lista =
      termo === "" || termo === normalizar(nomeEscolhido)
        ? unidades
        : unidades.filter(
            (u) =>
              normalizar(u.identificacao).includes(termo) ||
              normalizar(u.tipologia ?? "").includes(termo),
          );
    return lista.slice(0, MAX_RESULTADOS);
  }, [texto, unidades, nomeEscolhido]);

  const desativado = !empreendimentoId;

  const escolher = (u: UnidadeSimulavel) => {
    setAberto(false);
    campo.current?.blur();
    iniciar(() => router.replace(`${base}?e=${empreendimentoId}&u=${u.id}`));
  };

  const limpar = () => {
    setTexto("");
    setAberto(true);
    campo.current?.focus();
    if (selecionada) iniciar(() => router.replace(`${base}?e=${empreendimentoId}`));
  };

  return (
    <div className="relative">
      <label
        htmlFor="busca-unidade"
        className={`mb-2 block text-sm font-medium ${
          desativado ? "text-muted-foreground/70" : "text-foreground"
        }`}
      >
        Unidade
      </label>

      <div className="relative">
        {buscando ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 animate-spin text-foreground"
            aria-label="Buscando"
          >
            <path d="M12 3a9 9 0 1 0 9 9" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-muted-foreground/70"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        )}

        <input
          ref={campo}
          id="busca-unidade"
          type="text"
          autoComplete="off"
          disabled={desativado}
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setAberto(true);
          }}
          onFocus={(e) => {
            setAberto(true);
            e.target.select();
          }}
          onBlur={() => setTimeout(() => { setAberto(false); setTexto(nomeEscolhido); }, 150)}
          placeholder={desativado ? "Escolha o empreendimento" : "Ex.: 302"}
          className="w-full h-10 rounded-md border border-input bg-card pr-10 pl-10 text-sm text-foreground shadow-xs placeholder:text-muted-foreground transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:hover:border-border"
        />

        {texto && !desativado ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={limpar}
            aria-label="Limpar unidade"
            className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        ) : null}
      </div>

      {!desativado && unidades.length > 0 ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {unidades.length} unidade{unidades.length === 1 ? "" : "s"} disponíve
          {unidades.length === 1 ? "l" : "is"} neste empreendimento
        </p>
      ) : null}

      {aberto && !desativado ? (
        resultados.length > 0 ? (
          <ul className="absolute z-20 mt-1 flex max-h-72 w-full flex-col divide-y divide-border overflow-y-auto rounded-lg border bg-popover shadow-md">
            {resultados.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => escolher(u)}
                  className={`flex w-full flex-col items-start px-4 py-3 text-left transition-colors hover:bg-accent ${
                    selecionada?.id === u.id ? "bg-muted/50" : ""
                  }`}
                >
                  <span className="text-sm font-medium text-foreground">
                    {u.identificacao}
                  </span>
                  {caracteristicas(u) ? (
                    <span className="text-sm text-muted-foreground">{caracteristicas(u)}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="absolute z-20 mt-1 w-full rounded-lg border bg-popover px-4 py-3 text-sm text-muted-foreground shadow-md">
            Nenhuma unidade com esse texto.
          </p>
        )
      ) : null}
    </div>
  );
}
