"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { EmpreendimentoSimulavel } from "@/lib/simulador";

/** Ignora acentos e maiúsculas: "jardim" acha "Jardím". */
const normalizar = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const MAX_RESULTADOS = 20;

/**
 * A escolha do empreendimento.
 *
 * O campo NUNCA vira um cartão estático depois de escolher: ele continua
 * sendo um campo de busca, com o nome escolhido escrito dentro. Foi o
 * primeiro desenho e estava errado — quem escolhia perdia de vista que
 * aquilo era pesquisável, e o "Trocar" jogava a escolha inteira fora em vez
 * de deixar digitar por cima.
 *
 * A lista inteira vem do servidor e o filtro acontece aqui: são poucos
 * empreendimentos e nenhuma tecla precisa ir ao banco. A escolha vai para a
 * URL, não para o estado — é ela que o corretor manda pronto para o cliente.
 */
export function BuscaEmpreendimento({
  empreendimentos,
  selecionado,
  base = "/proposta",
}: {
  empreendimentos: EmpreendimentoSimulavel[];
  selecionado?: EmpreendimentoSimulavel;
  /** Para onde a escolha leva. A "Nova negociação" do painel usa a mesma busca. */
  base?: string;
}) {
  const router = useRouter();
  const nomeEscolhido = selecionado?.nome ?? "";
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
    // Campo em branco mostra tudo: o usuário clicou para ver as opções, não
    // para adivinhar o que digitar.
    const lista =
      termo === "" || termo === normalizar(nomeEscolhido)
        ? empreendimentos
        : empreendimentos.filter(
            (e) =>
              normalizar(e.nome).includes(termo) ||
              normalizar(e.incorporadora).includes(termo),
          );
    return lista.slice(0, MAX_RESULTADOS);
  }, [texto, empreendimentos, nomeEscolhido]);

  const escolher = (e: EmpreendimentoSimulavel) => {
    setAberto(false);
    campo.current?.blur();
    iniciar(() => router.replace(`${base}?e=${e.id}`));
  };

  const limpar = () => {
    setTexto("");
    setAberto(true);
    campo.current?.focus();
    if (selecionado) iniciar(() => router.replace(base));
  };

  return (
    <div className="relative">
      <label
        htmlFor="busca-empreendimento"
        className="mb-2 block text-sm font-medium text-foreground"
      >
        Empreendimento
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
          id="busca-empreendimento"
          type="text"
          autoComplete="off"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setAberto(true);
          }}
          onFocus={(e) => {
            setAberto(true);
            e.target.select();
          }}
          // O atraso deixa o clique num item acontecer antes de fechar a lista.
          onBlur={() => setTimeout(() => { setAberto(false); setTexto(nomeEscolhido); }, 150)}
          placeholder="Nome do empreendimento"
          className="w-full h-10 rounded-md border border-input bg-card pr-10 pl-10 text-sm text-foreground shadow-xs placeholder:text-muted-foreground transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />

        {texto ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={limpar}
            aria-label="Limpar empreendimento"
            className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        ) : null}
      </div>

      {aberto ? (
        resultados.length > 0 ? (
          <ul className="absolute z-20 mt-1 flex max-h-72 w-full flex-col divide-y divide-border overflow-y-auto rounded-lg border bg-popover shadow-md">
            {resultados.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => escolher(e)}
                  className={`flex w-full flex-col items-start px-4 py-3 text-left transition-colors hover:bg-accent ${
                    selecionado?.id === e.id ? "bg-muted/50" : ""
                  }`}
                >
                  <span className="text-sm font-medium text-foreground">
                    {e.nome}
                  </span>
                  {e.incorporadora ? (
                    <span className="text-sm text-muted-foreground">{e.incorporadora}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="absolute z-20 mt-1 w-full rounded-lg border bg-popover px-4 py-3 text-sm text-muted-foreground shadow-md">
            Nenhum empreendimento com esse nome.
          </p>
        )
      ) : null}
    </div>
  );
}
