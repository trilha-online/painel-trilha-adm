import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { ehAdmin, getSessao } from "@/lib/sessao";
import { maskCPF, maskPhone } from "@/lib/br";
import { PageHeader } from "@/components/ui";
import FormProprietario, { PROPRIETARIO_VAZIO } from "@/components/form-proprietario";
import { lerProprietario, paraFormulario } from "@/lib/proprietario";
import { AtivarVendedor } from "@/components/ativar-vendedor";

export default async function EditarProprietarioPage({ params }: { params: Promise<{ id: string }> }) {
  const sessao = await getSessao();
  if (!ehAdmin(sessao)) redirect("/");

  const { id } = await params;
  const data = await lerProprietario(createAdminClient(), id);
  if (!data) notFound();

  // Quantas unidades disponíveis saem do ar ao desativar. O PF guarda os
  // imóveis dele em "locais", que no banco são empreendimentos como os outros.
  const [{ data: cadastro }, { count: unidades }] = await Promise.all([
    createAdminClient()
      .from("incorporadora")
      .select("ativo")
      .eq("id", id)
      .maybeSingle<{ ativo: boolean }>(),
    createAdminClient()
      .from("imovel")
      .select("id, empreendimento!inner(incorporadora_id)", { count: "exact", head: true })
      .eq("status", "disponivel")
      .eq("empreendimento.incorporadora_id", id),
  ]);

  return (
    <>
      <PageHeader titulo="Editar dados" descricao={data.resp_nome} voltar={{ href: `/proprietarios/${id}`, label: data.resp_nome }} />
      <div className="flex flex-col gap-8">
        <FormProprietario modo="editar" id={id} inicial={{ ...PROPRIETARIO_VAZIO, ...paraFormulario(data, maskCPF, maskPhone) }} />

        <AtivarVendedor
          id={id}
          nome={data.resp_nome}
          ativo={cadastro?.ativo ?? true}
          unidades={unidades ?? 0}
          pessoaFisica
        />
      </div>
    </>
  );
}
