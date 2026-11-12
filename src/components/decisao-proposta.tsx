"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { aceitarProposta, recusarProposta } from "@/app/actions/decisoes";
import { Alert, Button, Textarea } from "@/components/ui";

/**
 * Aceitar ou recusar.
 *
 * Os dois botões abrem o mesmo passo intermediário, e isso é de propósito:
 * aceitar trava a unidade e derruba as propostas concorrentes: é a ação mais
 * pesada desta tela e não pode acontecer num clique perdido. O passo do meio
 * também é onde cabe o motivo — que no caso da recusa é o que o corretor vai
 * ler para entender o que aconteceu.
 */
export default function DecisaoProposta({ id, unidade }: { id: string; unidade: string }) {
  const router = useRouter();
  const [modo, setModo] = useState<"aceitar" | "recusar" | null>(null);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const confirmar = async () => {
    if (!modo) return;
    setEnviando(true);
    setErro(null);

    const r = modo === "aceitar" ? await aceitarProposta(id, motivo) : await recusarProposta(id, motivo);

    setEnviando(false);
    if (!r.ok) {
      setErro(r.erro);
      return;
    }
    setModo(null);
    setMotivo("");
    router.refresh();
  };

  if (!modo) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-6 shadow-xs">
        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={() => setModo("aceitar")}>
            Aceitar proposta
          </Button>
          <Button type="button" variant="ghost" onClick={() => setModo("recusar")}>
            Recusar
          </Button>
        </div>
        {erro ? <Alert>{erro}</Alert> : null}
      </div>
    );
  }

  const aceitando = modo === "aceitar";

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-6 shadow-xs">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          {aceitando ? "Aceitar esta proposta?" : "Recusar esta proposta?"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {aceitando ? (
            <>
              A unidade <strong className="text-foreground">{unidade}</strong> sai do estoque
              disponível e entra em negociação. As outras propostas abertas desta unidade são
              invalidadas na mesma hora, e ela sai do estoque disponível.
            </>
          ) : (
            <>
              A unidade continua à venda e as outras propostas seguem valendo. Só esta é recusada.
            </>
          )}
        </p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-foreground">
          Motivo
          <span className="font-body ml-1.5 text-xs font-normal normal-case text-muted-foreground">
            {aceitando ? "opcional" : "o corretor vai ler"}
          </span>
        </span>
        <Textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </label>

      {erro ? <Alert>{erro}</Alert> : null}

      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={confirmar} disabled={enviando}>
          {enviando ? "Aguarde…" : aceitando ? "Confirmar e aceitar" : "Confirmar recusa"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setModo(null)} disabled={enviando}>
          Voltar
        </Button>
      </div>
    </div>
  );
}
