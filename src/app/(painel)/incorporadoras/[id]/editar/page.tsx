import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessao } from "@/lib/sessao";
import { maskCNPJ, maskCPF, maskPhone } from "@/lib/br";
import { PageHeader } from "@/components/ui";
import FormIncorporadora from "@/components/form-incorporadora";
import { AtivarVendedor } from "@/components/ativar-vendedor";
import type { IncorporadoraFormValues } from "@/lib/schemas";

type Registro = {
  nome: string;
  ativo: boolean;
  cnpj: string;
  email: string;
  telefone: string;
  endereco: string | null;
  resp_nome: string;
  resp_cpf: string;
  resp_rg: string | null;
  resp_profissao: string | null;
  resp_cargo: string | null;
  resp_estado_civil: string | null;
  resp_email: string;
  resp_telefone: string;
  resp_endereco: string | null;
  banco: string | null;
  agencia: string | null;
  conta_numero: string | null;
  chave_pix: string | null;
  chave_pix_tipo: string | null;
};


/**
 * "Não existe" e "não consigo ler" são coisas diferentes, e confundir as duas
 * já custou rodadas de conserto no lugar errado nesta base. Erro do banco vira
 * mensagem na tela com código e motivo; ausência de linha vira 404.
 */
function ErroDeLeitura({ erro }: { erro: { code?: string; message?: string } }) {
  return (
    <div className="rounded-lg border border-destructive/20 bg-erro-suave px-5 py-4">
      <p className="text-sm font-semibold text-destructive">
        Não consegui carregar os dados desta incorporadora.
      </p>
      <p className="mt-1 text-sm text-destructive">
        {erro.code ?? "sem código"}: {erro.message ?? "sem mensagem"}
      </p>
      <p className="mt-2 text-sm text-destructive">
        Recarregue a página. Se continuar, envie este código para a Trilha.
      </p>
    </div>
  );
}

export default async function EditarIncorporadoraPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const sessao = await getSessao();
  // Lê colunas protegidas (CPF, bancários) pelo servidor: só o admin chega aqui.
  if (sessao?.conta?.tipo !== "trilha_admin") redirect("/empreendimentos");

  const { id } = await params;

  const { data, error } = await createAdminClient()
    .from("incorporadora")
    .select(
      `nome, ativo, cnpj, email, telefone, endereco,
       resp_nome, resp_cpf, resp_rg, resp_profissao, resp_cargo, resp_estado_civil,
       resp_email, resp_telefone, resp_endereco,
       banco, agencia, conta_numero, chave_pix, chave_pix_tipo`,
    )
    .eq("id", id)
    .maybeSingle<Registro>();

  if (error) return <ErroDeLeitura erro={error} />;
  if (!data) notFound();

  const inicial: IncorporadoraFormValues = {
    empresa: {
      nome: data.nome,
      cnpj: maskCNPJ(data.cnpj),
      email: data.email,
      telefone: maskPhone(data.telefone),
      endereco: data.endereco ?? "",
    },
    banco: {
      banco: data.banco ?? "",
      agencia: data.agencia ?? "",
      conta_numero: data.conta_numero ?? "",
      chave_pix: data.chave_pix ?? "",
      chave_pix_tipo: (data.chave_pix_tipo ?? "") as IncorporadoraFormValues["banco"]["chave_pix_tipo"],
    },
    responsavel: {
      nome: data.resp_nome,
      cpf: maskCPF(data.resp_cpf),
      rg: data.resp_rg ?? "",
      profissao: data.resp_profissao ?? "",
      cargo: data.resp_cargo ?? "",
      estado_civil: data.resp_estado_civil ?? "",
      email: data.resp_email,
      telefone: maskPhone(data.resp_telefone),
      endereco: data.resp_endereco ?? "",
    },
    acesso: { email: "", senha: "" },
  };


  // Quantas unidades disponíveis saem do ar ao desativar. A pessoa precisa
  // ver esse número antes de confirmar.
  const { count: unidades } = await createAdminClient()
    .from("imovel")
    .select("id, empreendimento!inner(incorporadora_id)", { count: "exact", head: true })
    .eq("status", "disponivel")
    .eq("empreendimento.incorporadora_id", id);

  return (
    <>
      <PageHeader
        titulo="Editar incorporadora"
        descricao={data.nome}
        voltar={{ href: `/incorporadoras/${id}`, label: "Voltar para a ficha" }}
      />
      <div className="flex flex-col gap-8">
        <FormIncorporadora modo="editar" id={id} inicial={inicial} />

        <AtivarVendedor
          id={id}
          nome={data.nome}
          ativo={data.ativo}
          unidades={unidades ?? 0}
          pessoaFisica={false}
        />
      </div>
    </>
  );
}
