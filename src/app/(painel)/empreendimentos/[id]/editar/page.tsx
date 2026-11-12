import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessao, podeEditar } from "@/lib/sessao";
import { PageHeader } from "@/components/ui";
import FormEmpreendimento from "@/components/form-empreendimento";
import { ExcluirRegistro } from "@/components/excluir-registro";
import { AtivarEmpreendimento } from "@/components/ativar-empreendimento";
import { excluirEmpreendimento } from "@/app/actions/empreendimentos";

type Registro = {
  id: string;
  nome: string;
  endereco: string | null;
  incorporadora_id: string;
  ativo: boolean;
};

export default async function EditarEmpreendimentoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sessao = await getSessao();
  if (!podeEditar(sessao)) redirect("/empreendimentos");
  const admin = sessao?.conta?.tipo === "trilha_admin";

  const supabase = await createClient();

  const { data } = await supabase
    .from("empreendimento")
    .select("id, nome, endereco, incorporadora_id, ativo")
    .eq("id", id)
    .maybeSingle<Registro>();

  if (!data) notFound();

  // Quantas unidades somem junto. A pessoa precisa ver esse número ANTES de
  // confirmar: o `on delete cascade` do banco não avisa ninguém.
  const [{ count: unidades }, { count: disponiveis }] = await Promise.all([
    supabase.from("imovel").select("id", { count: "exact", head: true }).eq("empreendimento_id", id),
    supabase
      .from("imovel")
      .select("id", { count: "exact", head: true })
      .eq("empreendimento_id", id)
      .eq("status", "disponivel"),
  ]);

  const { data: incorporadoras } = await supabase
    .from("incorporadora")
    .select("id, nome")
    // Proprietário PF tem menu próprio.
    .eq("tipo", "incorporadora")
    .order("nome")
    .returns<{ id: string; nome: string }[]>();

  return (
    <>
      <PageHeader
        titulo="Editar empreendimento"
        descricao={data.nome}
        voltar={{ href: "/empreendimentos", label: "Empreendimentos" }}
      />
      <div className="flex flex-col gap-8">
        <FormEmpreendimento
          modo="editar"
          id={id}
          incorporadoras={incorporadoras ?? []}
          admin={admin}
          inicial={{
            incorporadora_id: data.incorporadora_id,
            nome: data.nome,
            endereco: data.endereco ?? "",
          }}
        />

        <AtivarEmpreendimento
          id={id}
          nome={data.nome}
          ativo={data.ativo}
          unidadesDisponiveis={disponiveis ?? 0}
        />

        <ExcluirRegistro
          titulo="Excluir empreendimento"
          nome={data.nome}
          arrasta={
            unidades
              ? unidades === 1
                ? "a unidade cadastrada nele"
                : `as ${unidades} unidades cadastradas nele`
              : undefined
          }
          alternativa="Excluir é para cadastro que não deveria existir — importação que não vai ser usada, prédio cadastrado errado. Se o prédio existe mas saiu da plataforma, use Tirar do ar, logo acima: some da vitrine e nada se perde."
          rotulo="Excluir empreendimento"
          acao={excluirEmpreendimento.bind(null, id)}
          voltarPara="/empreendimentos"
        />
      </div>
    </>
  );
}
