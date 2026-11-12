import { ChevronLeft } from "lucide-react";
import { AvisoPublico, MolduraPublica } from "@/components/publico";
import { AcessoCorretor } from "@/components/acesso-corretor";
import type { Metadata } from "next";
import Link from "next/link";
import { simular } from "@/lib/simulador";
import { createClient } from "@/lib/supabase/server";
import { getSessao } from "@/lib/sessao";
import CardPagamento from "@/components/card-pagamento";
import { caracteristicas } from "@/lib/unidade";
import FormProposta, { type CorretorConhecido } from "./form";

/**
 * Enviar proposta — o segundo degrau de `/proposta`.
 *
 * A tela chega sempre de um card da escolha de unidade, com a condição já escolhida —
 * por isso ela mostra esse card de novo, fixo ao lado do formulário. O corretor
 * está preenchendo dados do cliente dele; ter os números sumindo da vista
 * enquanto digita é o jeito mais fácil de mandar a condição errada.
 *
 * A `ordem` da condição é a ÚNICA coisa que viaja pela URL. Os valores são
 * recalculados no servidor, aqui e de novo no envio: link editado à mão não
 * vira proposta com número inventado.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Enviar proposta · Trilha",
  description: "Envie a proposta de negócio desta unidade.",
  robots: { index: false, follow: false },
};

export default async function PropostaPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; u?: string; c?: string }>;
}) {
  const { e, u, c } = await searchParams;
  const ordem = Number(c);

  const simulacao = e && u && Number.isFinite(ordem) ? await simular(e, u) : null;
  const condicao = simulacao?.condicoes.find((x) => x.ordem === ordem) ?? null;

  if (!simulacao || !condicao) {
    return (
      <Moldura>
        <AvisoPublico>
          Não encontrei esta condição. A unidade pode ter saído do estoque ou as condições podem ter
          mudado desde que você abriu a página.
        </AvisoPublico>
        <p className="mt-4">
          <Link
            href="/proposta"
            className="font-semibold text-foreground underline-offset-4 hover:underline"
          >
            Escolher outra unidade
          </Link>
        </p>
      </Moldura>
    );
  }

  // Quem já é parceiro e entrou pelo atalho do painel não digita os próprios
  // dados de novo — eles aparecem preenchidos e travados, para ele conferir de
  // quem está saindo a proposta.
  const sessao = await getSessao();
  let corretor: CorretorConhecido | null = null;

  if (sessao?.conta?.tipo === "parceiro") {
    const supabase = await createClient();
    const { data } = await supabase
      .from("parceiro")
      .select("nome, documento, creci, email, telefone")
      .eq("conta_id", sessao.usuarioId)
      .maybeSingle<CorretorConhecido>();
    corretor = data ?? null;
  }

  const { unidade, empreendimento, incorporadora } = simulacao;

  return (
    <Moldura>
      <header className="mb-6 flex flex-col gap-1">
        <Link
          href={`/proposta?e=${simulacao.empreendimentoId}&u=${unidade.id}`}
          className="-ml-1 mb-2 inline-flex w-fit items-center gap-1 rounded-md px-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Voltar às condições
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Enviar proposta
        </h1>
        <p className="text-sm text-muted-foreground">
          {unidade.identificacao} · {empreendimento}
          {[caracteristicas(unidade), incorporadora].filter(Boolean).length
            ? ` · ${[caracteristicas(unidade), incorporadora].filter(Boolean).join(" · ")}`
            : ""}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
        <div className="lg:sticky lg:top-6">
          <CardPagamento condicao={condicao} modo="publico" />
        </div>

        <FormProposta
          empreendimentoId={simulacao.empreendimentoId}
          imovelId={unidade.id}
          ordem={condicao.ordem}
          corretor={corretor}
          incorporadora={incorporadora ?? ""}
        />
      </div>
    </Moldura>
  );
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <MolduraPublica
      acao={<AcessoCorretor />}
      largura="6xl"
      rodape="Enviar uma proposta não reserva a unidade. Sua proposta será analisada pela nossa equipe e você será avisado assim que tivermos atualizações."
    >
      {children}
    </MolduraPublica>
  );
}
