import { notFound, redirect } from "next/navigation";
import { getSessao, podeEditar } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import FormImovel from "@/components/form-imovel";
import { ExcluirRegistro } from "@/components/excluir-registro";
import { excluirImovel } from "@/app/actions/imoveis";
import type { ImovelFormValues } from "@/lib/schemas";

type Registro = {
  id: string;
  empreendimento_id: string;
  identificacao: string;
  tipologia: string | null;
  observacao: string | null;
  numero_matricula: string | null;
  tipo: ImovelFormValues["tipo"];
  status: ImovelFormValues["status"];
  valor: number | null;
  metros_quadrados: number | null;
  area_total: number | null;
  area_garden: number | null;
  posicao_solar: string | null;
  num_quartos: number | null;
  num_suites: number | null;
  num_banheiros: number | null;
  num_vagas: number | null;
  matricula_vaga: string | null;
  sacada: boolean;
  churrasqueira: boolean;
  empreendimento: { nome: string } | null;
};

/** Números viram texto com vírgula decimal, que é como o formulário aceita. */
const decimalParaTexto = (v: number | null) =>
  v === null || v === undefined ? "" : String(v).replace(".", ",");

const inteiroParaTexto = (v: number | null) => (v === null || v === undefined ? "" : String(v));

export default async function EditarImovelPage({
  params,
}: {
  params: Promise<{ id: string; imovelId: string }>;
}) {
  const sessao = await getSessao();
  if (!podeEditar(sessao)) redirect("/empreendimentos");

  const { id, imovelId } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from("imovel")
    .select(
      `id, empreendimento_id, identificacao, tipologia, observacao, numero_matricula,
       tipo, status, valor, metros_quadrados, area_total, area_garden, posicao_solar,
       num_quartos, num_suites, num_banheiros, num_vagas, matricula_vaga,
       sacada, churrasqueira, empreendimento (nome)`,
    )
    .eq("id", imovelId)
    .eq("empreendimento_id", id)
    .maybeSingle<Registro>();

  if (!data) notFound();

  return (
    <>
      <PageHeader
        titulo={`Editar ${data.identificacao}`}
        descricao={data.empreendimento?.nome}
        voltar={{ href: `/empreendimentos/${id}`, label: data.empreendimento?.nome ?? "Voltar" }}
      />
      <div className="flex flex-col gap-8">
        <FormImovel
          modo="editar"
          id={imovelId}
          empreendimentoId={id}
          voltarPara={`/empreendimentos/${id}/imoveis/${imovelId}`}
          inicial={{
            empreendimento_id: data.empreendimento_id,
            identificacao: data.identificacao,
            tipologia: data.tipologia ?? "",
            observacao: data.observacao ?? "",
            numero_matricula: data.numero_matricula ?? "",
            tipo: data.tipo,
            status: data.status,
            valor: decimalParaTexto(data.valor),
            metros_quadrados: decimalParaTexto(data.metros_quadrados),
            area_total: decimalParaTexto(data.area_total),
            area_garden: decimalParaTexto(data.area_garden),
            posicao_solar: data.posicao_solar ?? "",
            num_quartos: inteiroParaTexto(data.num_quartos),
            num_suites: inteiroParaTexto(data.num_suites),
            num_banheiros: inteiroParaTexto(data.num_banheiros),
            num_vagas: inteiroParaTexto(data.num_vagas),
            matricula_vaga: data.matricula_vaga ?? "",
            sacada: data.sacada,
            churrasqueira: data.churrasqueira,
          }}
        />

        <ExcluirRegistro
          titulo="Excluir unidade"
          nome={data.identificacao}
          alternativa="Se a unidade existe mas saiu do ar, mude o status para indisponível em vez de excluir: ela some do simulador e do painel do corretor, e o cadastro fica."
          rotulo="Excluir unidade"
          acao={excluirImovel.bind(null, imovelId)}
          voltarPara={`/empreendimentos/${id}`}
        />
      </div>
    </>
  );
}
