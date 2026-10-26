import { redirect } from "next/navigation";
import { contaDesativada, ehParceiroTrilha, ehProprietarioPF, getSessao } from "@/lib/sessao";

export default async function Home() {
  const sessao = await getSessao();

  // Antes de decidir a porta: quem está desligado não tem porta nenhuma.
  if (contaDesativada(sessao)) redirect("/acesso-desativado");

  // O admin cai nas PROPOSTAS: é a única fila do sistema onde alguém está
  // parado esperando por ele. Até a 6.4 ele caía na importação, que fazia
  // sentido quando o sistema era cadastro de estoque — hoje a importação se usa
  // uma vez por parceria nova e virou botão em Empreendimentos.
  // O Parceiro Trilha não tem estoque "dele" no painel — cai nas propostas.
  if (sessao?.conta?.tipo === "trilha_admin") redirect("/propostas");
  if (ehProprietarioPF(sessao)) redirect(`/proprietarios/${sessao!.incorporadoraId}`);
  redirect(ehParceiroTrilha(sessao) ? "/propostas" : "/empreendimentos");
}
