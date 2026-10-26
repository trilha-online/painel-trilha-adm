import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { contaDesativada, getSessao } from "@/lib/sessao";
import { NavLateral } from "@/components/nav-lateral";
import { Migalhas } from "@/components/migalhas";
import { SinoAvisos } from "@/components/sino-avisos";
import { Separator } from "@/components/shadcn/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/shadcn/sidebar";

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const sessao = await getSessao();

  // Acesso desligado sai do painel aqui, num lugar só, em vez de em cada tela.
  // A tela de destino mora fora deste grupo, senão o desvio seria circular.
  if (contaDesativada(sessao)) redirect("/acesso-desativado");

  const admin = sessao?.conta?.tipo === "trilha_admin";
  const parceiro = sessao?.conta?.tipo === "parceiro";
  const parceiroTrilha = parceiro && Boolean(sessao?.parceiroTrilha);
  const proprietarioPF = sessao?.conta?.tipo === "incorporadora" && Boolean(sessao?.proprietarioPF);

  // O MENU EM DOIS GRUPOS. Não é enfeite: o do admin chegou a nove itens
  // misturando o trabalho do dia com os cadastros, e procurar em metade do
  // menu é mais rápido do que procurar no menu inteiro. Em cima, o ciclo de
  // vida na ordem em que acontece — a proposta vira negócio, o negócio vira
  // trilha. Embaixo, o que se cadastra uma vez e se consulta depois.
  //
  // "Vendedores" junta incorporadora e proprietário pessoa física porque no
  // banco eles são a MESMA tabela, com uma coluna `tipo`. "Parceiros" junta o
  // corretor de incorporadora e o Parceiro Trilha pela mesma razão: é um
  // `parceiro` com ou sem `incorporadora_id`. Dois itens separados davam a
  // duas visões da mesma lista a aparência de duas entidades.
  //
  // A importação saiu do menu e virou botão em Empreendimentos: ela é o
  // caminho por onde o estoque entra, mas se usa uma vez por parceria nova, e
  // ocupava a primeira linha de quem passa o dia em proposta e fechamento.
  //
  // O parceiro imobiliário não tem "Cadastros" — ele não cadastra nada. O
  // grupo dele se chama Estoque, que é o que ele de fato consulta.
  const grupos = admin
    ? [
        {
          titulo: "Operação",
          itens: [
            { href: "/propostas", label: "Propostas", icone: "proposta" as const },
            { href: "/negocios", label: "Setups de negócios", icone: "chave" as const },
            { href: "/trilhas", label: "Trilhas", icone: "jornada" as const },
            { href: "/repasses", label: "Repasses", icone: "pagamento" as const },
          ],
        },
        {
          titulo: "Cadastros",
          itens: [
            { href: "/vendedores", label: "Vendedores", icone: "empresa" as const },
            { href: "/empreendimentos", label: "Empreendimentos", icone: "predio" as const },
            { href: "/parceiros", label: "Parceiros", icone: "parceiros" as const },
          ],
        },
      ]
    : proprietarioPF
      ? [
          {
            titulo: "Operação",
            itens: [
              { href: "/negocios", label: "Setups de negócios", icone: "chave" as const },
              { href: "/trilhas", label: "Trilhas", icone: "jornada" as const },
            ],
          },
          {
            titulo: "Cadastros",
            itens: [
              {
                href: `/proprietarios/${sessao!.incorporadoraId}`,
                label: "Meus imóveis",
                icone: "casa" as const,
              },
            ],
          },
        ]
    : parceiroTrilha
      ? [
          {
            titulo: "Operação",
            itens: [
              // Sem incorporadora, não há "estoque dele" no painel: o estoque
              // de todas está no simulador, que fica no atalho do menu.
              { href: "/propostas", label: "Minhas propostas", icone: "proposta" as const },
              { href: "/negocios", label: "Setups de negócios", icone: "chave" as const },
              { href: "/trilhas", label: "Trilhas", icone: "jornada" as const },
            ],
          },
        ]
    : parceiro
      ? [
          {
            titulo: "Operação",
            itens: [
              { href: "/propostas", label: "Minhas propostas", icone: "proposta" as const },
              { href: "/negocios", label: "Setups de negócios", icone: "chave" as const },
              { href: "/trilhas", label: "Trilhas", icone: "jornada" as const },
            ],
          },
          {
            titulo: "Estoque",
            itens: [
              { href: "/empreendimentos", label: "Empreendimentos", icone: "predio" as const },
            ],
          },
        ]
      : [
          {
            titulo: "Operação",
            itens: [
              { href: "/negocios", label: "Setups de negócios", icone: "chave" as const },
              { href: "/trilhas", label: "Trilhas", icone: "jornada" as const },
            ],
          },
          {
            titulo: "Cadastros",
            itens: [
              { href: "/empreendimentos", label: "Empreendimentos", icone: "predio" as const },
              { href: "/opcoes-pagamento", label: "Opções de pagamento", icone: "pagamento" as const },
              { href: "/parceiros", label: "Parceiros", icone: "parceiros" as const },
            ],
          },
        ];

  // ADMINISTRADORES FICA FORA DOS GRUPOS, solto embaixo da marca. Esteve em
  // "Cadastros" por um dia e ficou errado: ali ele se lia como mais um
  // registro ao lado de vendedor e corretor, quando é outra categoria de
  // coisa — quem OPERA o sistema, não quem o sistema atende. E é a única
  // tela do painel que mexe em quem pode entrar.
  const topo = admin
    ? { href: "/administradores", label: "Administradores", icone: "equipe" as const }
    : undefined;

  // O menu recolhido ou aberto fica num cookie, lido aqui para a página já
  // nascer no estado certo — sem o menu "pular" ao carregar.
  const menuAberto = (await cookies()).get("sidebar_state")?.value !== "false";

  return (
    <SidebarProvider defaultOpen={menuAberto}>
      <NavLateral
        grupos={grupos}
        topo={topo}
        papel={
          admin
            ? "Painel da Trilha"
            : parceiroTrilha
              ? "Parceiro Trilha"
              : proprietarioPF
                ? "Proprietário"
              : parceiro
                ? "Parceiro imobiliário"
                : "Incorporadora"
        }
        nome={sessao?.conta?.nome ?? ""}
        email={sessao?.email ?? ""}
        mostrarPerfil={!admin && !parceiro}
        mostrarSimulador={parceiro}
      />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur lg:px-6">
          <SidebarTrigger className="-ml-1 text-muted-foreground" />
          <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
          <Migalhas />
          {admin ? <SinoAvisos /> : null}
        </header>
      {/* `SidebarInset` já é o <main> da página; aqui é só o miolo. */}
      <div className="min-w-0 flex-1 px-4 py-8 lg:px-8">
        <div className="mx-auto max-w-6xl">
          {sessao && !sessao.conta ? (
            <div className="mb-8 flex flex-col gap-2 rounded-md border border-aviso/20 bg-aviso-suave px-5 py-4 text-sm text-aviso">
              {sessao.erroLeitura ? (
                <>
                  <strong className="font-semibold">Não consegui carregar os dados da sua ficha.</strong>
                  <span>
                    A linha pode até existir — o banco não deixou ler. Isso é permissão ou regra de
                    acesso, não dado faltando.
                  </span>
                  <code className="rounded bg-aviso/10 px-2 py-1 font-mono text-xs break-all">
                    {sessao.erroLeitura}
                  </code>
                </>
              ) : (
                <>
                  <strong className="font-semibold">
                    Este login não tem ficha na tabela conta.
                  </strong>
                  <span>
                    O banco respondeu sem erro, mas não encontrou nenhuma linha para este usuário.
                    Rode a Parte 7 do arquivo{" "}
                    <code className="rounded bg-aviso/10 px-1">supabase/sprint-1.sql</code>.
                  </span>
                </>
              )}
              <span className="text-xs opacity-80">
                usuário logado: {sessao.email} · id {sessao.usuarioId}
              </span>
              <span className="text-xs opacity-80">
                identidade que o banco recebeu:{" "}
                {sessao.uidNoBanco ?? "NENHUMA — o app está chegando como anônimo"}
              </span>
              <span className="text-xs opacity-80">
                token de sessão:{" "}
                {sessao.token.presente
                  ? `presente · papel "${sessao.token.role ?? "sem papel"}" · sub ${sessao.token.sub ?? "vazio"}`
                  : "AUSENTE — o cliente não carregou a sessão dos cookies"}
              </span>
            </div>
          ) : null}
          {children}
        </div>
      </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
