"use client";

import { buttonVariants } from "@/components/shadcn/button";
import { useState } from "react";

/**
 * O caminho do simulador até o cliente.
 *
 * O corretor simula aqui e manda para o cliente uma página só dele —
 * `/condicoes`, com a mesma unidade e os mesmos números, sem os campos de
 * busca. O link é montado no clique, e não na renderização, porque a origem
 * (`localhost`, o domínio da Vercel, um domínio próprio depois) só existe no
 * navegador — no servidor essa mesma linha daria `undefined`.
 *
 * WhatsApp primeiro porque é onde o atendimento acontece; copiar o link é a
 * saída para todo o resto (e-mail, outro app, colar num CRM).
 */
export default function Compartilhar({
  empreendimentoId,
  unidadeId,
  unidade,
  empreendimento,
}: {
  empreendimentoId: string;
  unidadeId: string;
  unidade: string;
  empreendimento: string;
}) {
  const [copiado, setCopiado] = useState(false);

  const link = () =>
    `${window.location.origin}/condicoes?e=${encodeURIComponent(empreendimentoId)}&u=${encodeURIComponent(unidadeId)}`;

  const whatsapp = () => {
    const texto = `Condições de pagamento — ${unidade} · ${empreendimento}\n${link()}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(link());
      setCopiado(true);
      // Volta ao normal sozinho: um botão que fica "Copiado!" para sempre
      // deixa de dizer o que faz.
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Navegador sem permissão de área de transferência (ou fora de HTTPS).
      // Melhor abrir o link do que insistir: dali o corretor copia da barra.
      window.open(link(), "_blank", "noopener");
    }
  };

  return (
    <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-5">
      <span className="text-sm text-muted-foreground">Enviar ao cliente:</span>

      <button
        type="button"
        onClick={whatsapp}
        className={buttonVariants({ variant: "default", size: "sm" })}
      >
        WhatsApp
      </button>

      <button
        type="button"
        onClick={copiar}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        {copiado ? "Link copiado!" : "Copiar link"}
      </button>

      <p className="w-full text-xs text-muted-foreground/70">
        O cliente vê só esta unidade.
      </p>
    </div>
  );
}
