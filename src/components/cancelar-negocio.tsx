"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cancelarNegocio } from "@/app/actions/fechamento";
import { Alert, Button, Textarea } from "@/components/ui";

/**
 * Cancelar o negócio.
 *
 * Recolhido atrás de um clique e no fim da tela: é a ação mais pesada daqui, e
 * quem abre este fechamento no dia a dia vem trabalhar nas tarefas, não
 * cancelar.
 *
 * As duas escolhas de destino da unidade estão em botões separados, e não num
 * seletor com um padrão: "volta a vender" e "sai do estoque" são decisões
 * diferentes, e um padrão escolhido por preguiça devolveria ao simulador uma
 * unidade que a incorporadora acabou de retirar.
 */
export default function CancelarNegocio({
  negocioId,
  unidade,
}: {
  negocioId: string;
  unidade: string;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const cancelar = async (destino: "disponivel" | "indisponivel") => {
    setEnviando(true);
    setErro(null);

    const r = await cancelarNegocio(negocioId, motivo, destino);

    setEnviando(false);
    if (!r.ok) {
      setErro(r.erro);
      return;
    }
    setAberto(false);
    router.refresh();
  };

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="w-full rounded-md px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-erro-suave"
      >
        Cancelar este negócio
      </button>
    );
  }

  return (
    <section className="flex flex-col">
      <h2 className="text-sm font-semibold text-destructive">Cancelar o negócio</h2>

      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Nada é apagado: o histórico da <strong>{unidade}</strong> fica guardado como cancelado.
      </p>

      <label className="mt-4 flex flex-col gap-1.5">
        <span className="text-sm font-medium text-foreground">
          Por que está caindo?
        </span>
        <Textarea
          rows={3}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Crédito reprovado, comprador desistiu, incorporadora retirou a unidade…"
        />
        <span className="text-xs text-muted-foreground">
          O corretor vê este texto na proposta dele. Obrigatório.
        </span>
      </label>

      {erro ? (
        <div className="mt-4">
          <Alert>{erro}</Alert>
        </div>
      ) : null}

      <p className="mt-4 text-sm font-medium text-foreground">
        E a unidade, o que acontece com ela?
      </p>

      <div className="mt-2 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => cancelar("disponivel")}
          disabled={enviando}
          className="rounded-lg border px-3.5 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:border-destructive/40 hover:bg-erro-suave disabled:opacity-50"
        >
          Volta a ficar disponível
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
            O negócio caiu, mas a unidade continua à venda e volta para o estoque disponível.
          </span>
        </button>

        <button
          type="button"
          onClick={() => cancelar("indisponivel")}
          disabled={enviando}
          className="rounded-lg border px-3.5 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:border-destructive/40 hover:bg-erro-suave disabled:opacity-50"
        >
          Sai do estoque
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
            A unidade não é mais para vender. Sai do estoque disponível e do painel do corretor.
          </span>
        </button>
      </div>

      <div className="mt-4">
        <Button type="button" variant="ghost" onClick={() => setAberto(false)} disabled={enviando}>
          {enviando ? "Cancelando…" : "Voltar"}
        </Button>
      </div>
    </section>
  );
}
