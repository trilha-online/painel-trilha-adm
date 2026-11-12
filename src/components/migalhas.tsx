"use client";

import { Fragment, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/shadcn/breadcrumb";

/**
 * A trilha de navegação do cabeçalho: "Setups de negócios / Apto 302".
 *
 * Nenhuma página precisa configurá-la. O `PageHeader` de cada tela já sabe o
 * título dela e para onde se volta (`voltar`); ele publica isso aqui, e o
 * cabeçalho do layout monta a trilha com a seção do menu na frente.
 *
 * O canal é um armazenzinho de módulo, e não estado de React, porque quem
 * publica (a página) e quem lê (o cabeçalho) não têm pai comum que valha a
 * pena. Só existe no navegador: no servidor a trilha nasce com a seção e o
 * título entra um instante depois.
 */

type Voltar = { href: string; label: string };
type Estado = { titulo?: string; voltar?: Voltar };

let estado: Estado = {};
const ouvintes = new Set<() => void>();

function publicar(novo: Estado) {
  if (novo.titulo === estado.titulo && novo.voltar?.href === estado.voltar?.href && novo.voltar?.label === estado.voltar?.label) {
    return;
  }
  estado = novo;
  ouvintes.forEach((o) => o());
}

function assinar(ouvinte: () => void) {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

const VAZIO: Estado = {};

/** Chamado pelo `PageHeader`: diz ao cabeçalho onde a pessoa está. */
export function usePublicarMigalhas(titulo: string, voltar?: Voltar) {
  const href = voltar?.href;
  const label = voltar?.label;
  useEffect(() => {
    publicar({ titulo, voltar: href && label ? { href, label } : undefined });
    return () => publicar({});
  }, [titulo, href, label]);
}

/** A seção do menu, pelo primeiro pedaço do endereço. */
const SECOES: Record<string, string> = {
  propostas: "Propostas",
  negocios: "Setups de negócios",
  importacao: "Importação de estoque",
  incorporadoras: "Incorporadoras",
  empreendimentos: "Empreendimentos",
  imoveis: "Imóveis",
  parceiros: "Parceiros imobiliários",
  "parceiro-trilha": "Parceiro Trilha",
  proprietarios: "Proprietários PF",
  "opcoes-pagamento": "Opções de pagamento",
  perfil: "Meus dados",
  senha: "Trocar senha",
  avisos: "Avisos",
  repasses: "Repasses",
  trilhas: "Trilhas",
};

export function Migalhas() {
  const caminho = usePathname();
  const { titulo, voltar } = useSyncExternalStore(assinar, () => estado, () => VAZIO);

  const segmento = caminho.split("/")[1] ?? "";
  const secao = SECOES[segmento];
  const hrefSecao = `/${segmento}`;
  if (!secao) return null;

  const itens: { label: string; href?: string }[] = [{ label: secao, href: hrefSecao }];
  if (voltar && voltar.href !== hrefSecao && voltar.label !== secao) {
    itens.push({ label: voltar.label, href: voltar.href });
  }
  if (titulo && titulo !== secao) {
    itens.push({ label: titulo });
  }
  // O último item é a página atual: sem link.
  const ultimo = itens.length - 1;

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {itens.map((item, i) => (
          <Fragment key={`${i}-${item.label}`}>
            {i > 0 ? <BreadcrumbSeparator className="hidden sm:inline-flex" /> : null}
            <BreadcrumbItem className={i < ultimo ? "hidden min-w-0 sm:inline-flex" : "min-w-0"}>
              {i === ultimo ? (
                <BreadcrumbPage className="truncate">{item.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild className="truncate">
                  <Link href={item.href ?? hrefSecao}>{item.label}</Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
