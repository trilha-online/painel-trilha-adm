"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { propostaSchema, type PropostaFormValues } from "@/lib/schemas";
import { enviarProposta } from "@/app/actions/propostas";
import { LinkEntrar } from "@/components/link-entrar";
import { Alert, Button, Field, Input, Section, Textarea } from "@/components/ui";

export type CorretorConhecido = {
  nome: string;
  documento: string | null;
  creci: string | null;
  email: string;
  telefone: string;
};

/**
 * O formulário da proposta.
 *
 * Dois blocos: quem vende e quem compra. Quando o corretor já está logado, o
 * primeiro bloco vem preenchido e travado — ele confere de quem está saindo a
 * proposta em vez de digitar de novo o que o sistema já sabe.
 *
 * Dados bancários do corretor NÃO estão aqui. Eles só fazem sentido quando há
 * comissão a pagar; pedir no primeiro contato é atrito sem função.
 */
export default function FormProposta({
  empreendimentoId,
  imovelId,
  ordem,
  corretor,
  incorporadora,
}: {
  empreendimentoId: string;
  imovelId: string;
  ordem: number;
  corretor: CorretorConhecido | null;
  /** Nome da incorporadora da unidade, para a pergunta do vínculo. */
  incorporadora: string;
}) {
  const [codigo, setCodigo] = useState<string | null>(null);
  // Só pergunta para quem não está logado; o logado já tem isso no cadastro.
  const [vinculo, setVinculo] = useState<"incorporadora" | "trilha" | null>(null);
  const [erroVinculo, setErroVinculo] = useState<string | null>(null);
  const [erro, setErro] = useState<{ texto: string; precisaLogin: boolean } | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PropostaFormValues>({
    resolver: zodResolver(propostaSchema),
    defaultValues: {
      corretor: {
        nome: corretor?.nome ?? "",
        documento: corretor?.documento ?? "",
        creci: corretor?.creci ?? "",
        email: corretor?.email ?? "",
        telefone: corretor?.telefone ?? "",
      },
      comprador: { nome: "", cpf: "", email: "", telefone: "" },
      observacao: "",
    },
  });

  if (codigo) return <Confirmacao codigo={codigo} />;

  const onSubmit = async (v: PropostaFormValues) => {
    setErro(null);
    if (!corretor && !vinculo) {
      setErroVinculo("Escolha o seu vínculo.");
      return;
    }
    const r = await enviarProposta({
      empreendimentoId,
      imovelId,
      ordem,
      corretor: v.corretor,
      vinculo: vinculo ?? undefined,
      comprador: v.comprador,
      observacao: v.observacao,
    });

    if (r.ok) {
      setCodigo(r.codigo);
      return;
    }
    setErro({ texto: r.erro, precisaLogin: Boolean(r.precisaLogin) });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
      <Section
        title="Você"
        hint={
          corretor
            ? "Estes são os seus dados de cadastro. A proposta sai em seu nome."
            : "Se você ainda não tem cadastro na Trilha, ele é criado a partir daqui e você recebe no WhatsApp o link para criar sua senha."
        }
      >
        <Field label="Nome" span={6} error={errors.corretor?.nome?.message}>
          <Input
            {...register("corretor.nome")}
            readOnly={Boolean(corretor)}
            className={corretor ? "bg-muted/50 text-foreground" : ""}
            placeholder="Nome do corretor ou da imobiliária"
            aria-invalid={Boolean(errors.corretor?.nome)}
          />
        </Field>

        <Field label="CPF ou CNPJ" span={3} optional error={errors.corretor?.documento?.message}>
          <Input
            {...register("corretor.documento")}
            readOnly={Boolean(corretor)}
            className={corretor ? "bg-muted/50 text-foreground" : ""}
            aria-invalid={Boolean(errors.corretor?.documento)}
          />
        </Field>

        <Field label="CRECI" span={3} optional error={errors.corretor?.creci?.message}>
          <Input
            {...register("corretor.creci")}
            readOnly={Boolean(corretor)}
            className={corretor ? "bg-muted/50 text-foreground" : ""}
          />
        </Field>

        <Field label="E-mail" span={3} error={errors.corretor?.email?.message}>
          <Input
            type="email"
            {...register("corretor.email")}
            readOnly={Boolean(corretor)}
            className={corretor ? "bg-muted/50 text-foreground" : ""}
            aria-invalid={Boolean(errors.corretor?.email)}
          />
        </Field>

        <Field label="Telefone" span={3} error={errors.corretor?.telefone?.message}>
          <Input
            {...register("corretor.telefone")}
            readOnly={Boolean(corretor)}
            className={corretor ? "bg-muted/50 text-foreground" : ""}
            aria-invalid={Boolean(errors.corretor?.telefone)}
          />
        </Field>

        {corretor ? null : (
          <Field label="Qual é o seu vínculo?" span={6} error={erroVinculo ?? undefined}>
            <div role="radiogroup" aria-label="Qual é o seu vínculo?" className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  {
                    valor: "incorporadora",
                    titulo: incorporadora ? `Corretor da ${incorporadora}` : "Corretor da incorporadora",
                    texto: "Você é parceiro da incorporadora desta unidade.",
                  },
                  {
                    valor: "trilha",
                    titulo: "Parceiro Trilha",
                    texto: "Corretor independente, sem vínculo com uma incorporadora.",
                  },
                ] as const
              ).map((o) => {
                const marcado = vinculo === o.valor;
                return (
                  <button
                    key={o.valor}
                    type="button"
                    role="radio"
                    aria-checked={marcado}
                    onClick={() => {
                      setVinculo(o.valor);
                      setErroVinculo(null);
                    }}
                    className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                      marcado ? "border-destaque bg-muted/50" : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
                        marcado ? "border-destaque" : "border-muted-foreground/40"
                      }`}
                    >
                      {marcado ? <span className="size-2 rounded-full bg-destaque" /> : null}
                    </span>
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-foreground">{o.titulo}</span>
                      <span className="text-xs text-muted-foreground">{o.texto}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Field>
        )}
      </Section>

      <Section title="O comprador">
        <Field label="Nome completo" span={6} error={errors.comprador?.nome?.message}>
          <Input {...register("comprador.nome")} aria-invalid={Boolean(errors.comprador?.nome)} />
        </Field>

        <Field label="CPF" span={3} error={errors.comprador?.cpf?.message}>
          <Input {...register("comprador.cpf")} aria-invalid={Boolean(errors.comprador?.cpf)} />
        </Field>

        <Field label="Telefone" span={3} error={errors.comprador?.telefone?.message}>
          <Input
            {...register("comprador.telefone")}
            aria-invalid={Boolean(errors.comprador?.telefone)}
          />
        </Field>

        <Field label="E-mail" span={6} error={errors.comprador?.email?.message}>
          <Input
            type="email"
            {...register("comprador.email")}
            aria-invalid={Boolean(errors.comprador?.email)}
          />
        </Field>

        <Field
          label="Observação"
          span={6}
          optional
        >
          <Textarea rows={3} {...register("observacao")} />
        </Field>
      </Section>

      {erro ? (
        <Alert>
          {erro.texto}
          {erro.precisaLogin ? (
            <>
              {" "}
              <LinkEntrar className="font-semibold underline-offset-4 hover:underline">
                Fazer login
              </LinkEntrar>
              .
            </>
          ) : null}
        </Alert>
      ) : null}

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Enviando…" : "Enviar proposta"}
        </Button>
        <span className="text-sm text-muted-foreground">Enviar não reserva a unidade.</span>
      </div>
    </form>
  );
}

/**
 * Depois de enviada.
 *
 * O código vem grande porque é o que o corretor vai citar quando perguntar do
 * andamento. E a tela diz o que acontece agora — quem espera sem saber o que
 * esperar liga no dia seguinte.
 */
function Confirmacao({ codigo }: { codigo: string }) {
  return (
    <section className="rounded-xl border border-sucesso/20 bg-sucesso-suave p-8">
      <h2 className="text-xl font-semibold tracking-tight text-foreground">Proposta enviada</h2>

      <p className="mt-4 text-3xl font-semibold tracking-tight text-foreground tabular-nums">
        {codigo}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Anote este código. É por ele que a gente encontra a sua proposta.
      </p>

      <div className="mt-6 flex flex-col gap-2 border-t border-sucesso/20 pt-5 text-sm text-foreground">
        <p>A equipe da Trilha analisa o formato de pagamento e a qualificação do comprador.</p>
        <p>Enquanto isso a unidade segue disponível — outra proposta ainda pode chegar antes.</p>
        {/* Não prometer e-mail enquanto o envio não existir: o sistema ainda
            não notifica ninguém de nada. Quando o disparo entrar, esta linha
            volta a falar em aviso automático. */}
        <p>A equipe da Trilha entra em contato com você pelo telefone ou e-mail informado.</p>
      </div>

      <p className="mt-6">
        <Link
          href="/proposta"
          className="font-semibold text-foreground underline-offset-4 hover:underline"
        >
          Enviar outra proposta
        </Link>
      </p>
    </section>
  );
}
