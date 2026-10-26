"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building,
  Building2,
  CreditCard,
  ExternalLink,
  FileCheck2,
  House,
  KeyRound,
  LogOut,
  Route,
  ShieldUser,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/shadcn/sidebar";
import { signOut } from "@/app/actions/auth";
import { LogoTrilha, SimboloTrilha } from "@/components/logo-trilha";

/** Os ícones por nome, para o layout (servidor) poder descrever o menu. */
const ICONES = {
  proposta: FileCheck2,
  chave: KeyRound,
  empresa: Building2,
  predio: Building,
  pagamento: CreditCard,
  parceiros: Users,
  jornada: Route,
  casa: House,
  equipe: ShieldUser,
} satisfies Record<string, LucideIcon>;

export type ItemMenu = { href: string; label: string; icone: keyof typeof ICONES };

/**
 * O menu vem em grupos com título.
 *
 * Antes era uma lista só, e o do admin chegou a nove itens misturando o
 * trabalho do dia com os cadastros. Separar em "Operação" e "Cadastros" não
 * encurta o menu — faz a pessoa procurar em metade dele.
 */
export type GrupoMenu = { titulo: string; itens: ItemMenu[] };

/**
 * Um item solto logo abaixo da marca, fora dos grupos.
 *
 * É para o que não é trabalho do dia nem cadastro de negócio — hoje, só
 * "Administradores". Ficava em Cadastros e dava a entender que administrador
 * é mais um registro ao lado de vendedor e corretor; é outra categoria de
 * coisa: quem opera o sistema, não quem o sistema atende.
 */
export type ItemTopo = ItemMenu;

/**
 * O menu lateral do painel.
 *
 * Recolhível: no computador vira uma faixa só de ícones (o estado fica num
 * cookie e sobrevive ao recarregar); no celular abre por cima da tela.
 *
 * Texto sempre em preto e cinza. O roxo aparece só no ÍCONE do item ativo —
 * é o único ponto de cor do menu.
 */
export function NavLateral({
  grupos,
  topo,
  papel,
  nome,
  email,
  mostrarPerfil,
  mostrarSimulador,
}: {
  grupos: GrupoMenu[];
  topo?: ItemTopo;
  papel: string;
  nome: string;
  email: string;
  mostrarPerfil: boolean;
  mostrarSimulador: boolean;
}) {
  const caminho = usePathname();
  const ativo = (href: string) => caminho === href || caminho.startsWith(`${href}/`);

  const IconeTopo = topo ? ICONES[topo.icone] : null;
  const topoAtivo = Boolean(topo) && ativo(topo!.href);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                {/* Menu recolhido: só o "T" da marca no quadrado azul. */}
                <span className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground group-data-[collapsible=icon]:flex">
                  <SimboloTrilha className="size-4" />
                </span>
                <span className="flex min-w-0 flex-col gap-1.5 leading-tight group-data-[collapsible=icon]:hidden">
                  <LogoTrilha className="h-4 w-auto self-start text-[#26305a]" />
                  <span className="text-xs text-muted-foreground">{papel}</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {topo && IconeTopo ? (
          <SidebarMenu className="mt-1 border-t border-sidebar-border pt-1.5">
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={topoAtivo} tooltip={topo.label}>
                <Link href={topo.href} aria-current={topoAtivo ? "page" : undefined}>
                  <IconeTopo className={topoAtivo ? "text-destaque" : "text-muted-foreground"} />
                  <span>{topo.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        ) : null}
      </SidebarHeader>

      <SidebarContent>
        {grupos.map((grupo) => (
          <SidebarGroup key={grupo.titulo}>
            <SidebarGroupLabel>{grupo.titulo}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {grupo.itens.map((link) => {
                  const Icone = ICONES[link.icone];
                  const on = ativo(link.href);
                  return (
                    <SidebarMenuItem key={link.href}>
                      <SidebarMenuButton asChild isActive={on} tooltip={link.label}>
                        <Link href={link.href} aria-current={on ? "page" : undefined}>
                          <Icone className={on ? "text-destaque" : "text-muted-foreground"} />
                          <span>{link.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        {/* Atalho, não item de menu: o corretor sai do painel e vai para a
            página que mostra ao cliente — por isso abre em outra aba. */}
        {mostrarSimulador ? (
          <SidebarGroup>
            <SidebarGroupLabel>Ferramentas</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Simulador">
                    <a href="/simulador" target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="text-muted-foreground" />
                      <span>Simulador</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:hidden">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full border bg-muted text-xs font-semibold text-foreground">
                {iniciais(nome || email)}
              </span>
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-sm font-medium text-foreground" title={nome}>
                  {nome || email}
                </span>
                {nome ? (
                  <span className="truncate text-xs text-muted-foreground" title={email}>
                    {email}
                  </span>
                ) : null}
              </span>
            </div>
          </SidebarMenuItem>
          {mostrarPerfil ? (
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={ativo("/perfil")} tooltip="Meus dados">
                <Link href="/perfil">
                  <UserRound className={ativo("/perfil") ? "text-destaque" : "text-muted-foreground"} />
                  <span>Meus dados</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
          <SidebarMenuItem>
            <form action={signOut}>
              <SidebarMenuButton type="submit" tooltip="Sair">
                <LogOut className="text-muted-foreground" />
                <span>Sair</span>
              </SidebarMenuButton>
            </form>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function iniciais(texto: string) {
  const partes = texto.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase() || "?";
}
