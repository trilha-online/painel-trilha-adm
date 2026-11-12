import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ehParceiro, getSessao } from "@/lib/sessao";
import { PageHeader } from "@/components/ui";
import ErroLeitura from "@/components/erro-leitura";
import FormAcessoParceiro from "@/components/form-acesso-parceiro";
import ReenviarConvite from "@/components/reenviar-convite";
import { linkDeConvite } from "@/lib/convite";

/**
 * O acesso de um parceiro.
 *
 * Atende a Trilha e a incorporadora pela mesma rota — quem enxerga o parceiro
 * é decidido pela policy, não por um `if` aqui. Antes esta tela redirecionava
 * o admin para `/incorporadoras`, o que fazia sentido quando "parceiros" só
 * existia do lado da incorporadora; desde que a Trilha ganhou a lista geral,
 * não faz mais.
 *
 * Sem `conta_id`, a tela CRIA o acesso em vez de dizer que ele não existe. É
 * por aqui que se aprova o corretor que chegou por proposta: ele nasce
 * pendente e sem login, e antes disto não havia como liberá-lo em lugar
 * nenhum do painel.
 */
type Registro = {
  nome: string;
  incorporadora_id: string | null;
  email: string;
  ativo: boolean;
  origem: string;
  conta_id: string | null;
  convite_token: string | null;
  convite_expira_em: string | null;
  convite_enviado_em: string | null;
  conta: { email: string | null } | null;
};

export default async function AcessoParceiroPage({
  params,
}: {
  params: Promise<{ parceiroId: string }>;
}) {
  const sessao = await getSessao();
  if (ehParceiro(sessao)) redirect("/empreendimentos");

  const { parceiroId } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("parceiro")
    .select(
      `nome, incorporadora_id, email, ativo, origem, conta_id,
       convite_token, convite_expira_em, convite_enviado_em,
       conta (email)`,
    )
    .eq("id", parceiroId)
    .maybeSingle<Registro>();

  if (error) return <ErroLeitura oQue="deste parceiro" erro={error} />;
  if (!data) notFound();

  const base = data.incorporadora_id ? "/parceiros" : "/parceiro-trilha";
  const secao = data.incorporadora_id ? "Parceiros" : "Parceiro Trilha";
  const criar = !data.conta_id;
  const veioDeProposta = data.origem === "proposta" && !data.ativo;
  const link = data.convite_token ? await linkDeConvite(data.convite_token) : null;

  return (
    <>
      <PageHeader
        titulo={criar ? "Criar acesso" : "Dados de acesso"}
        descricao={data.nome}
        voltar={{ href: base, label: secao }}
      />

      {veioDeProposta ? (
        <p className="mb-6 max-w-3xl rounded-md border border-aviso/20 bg-aviso-suave px-5 py-4 text-sm text-aviso">
          Este cadastro nasceu de uma proposta enviada pela página pública e está{" "}
          <strong>aguardando aprovação</strong>. Criar o acesso aqui libera a entrada dele na
          plataforma.
        </p>
      ) : null}

      {link ? (
        <ReenviarConvite
          parceiroId={parceiroId}
          link={link}
          enviadoEm={data.convite_enviado_em}
          expiraEm={data.convite_expira_em}
        />
      ) : null}

      {link ? (
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
          Se preferir não esperar o corretor usar o link, você pode criar o acesso à mão aqui
          embaixo e entregar a senha a ele.
        </p>
      ) : null}

      <FormAcessoParceiro
        id={parceiroId}
        modo={criar ? "criar" : "editar"}
        /* Ao criar, o e-mail sugerido é o do cadastro — foi o que ele digitou
           na proposta, e é por onde ele espera receber o acesso. */
        emailAtual={criar ? data.email : (data.conta?.email ?? "")}
        voltarPara={base}
      />
    </>
  );
}
