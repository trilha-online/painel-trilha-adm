"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { marcarAvisosLidos, resumoDoSino, type ResumoSino } from "@/app/actions/avisos";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * O sino do cabeçalho. Cada um vê os seus avisos (a regra está no banco); só
 * a Trilha tem a tela de Avisos por extenso, com o log de mensagens.
 *
 * O layout do painel não é redesenhado a cada navegação, então o sino busca
 * sozinho: ao abrir a página, a cada troca de tela e a cada minuto. Barato —
 * é uma leitura de no máximo 100 linhas.
 */
const COR = {
  info: "bg-muted-foreground/40",
  atencao: "bg-aviso",
  problema: "bg-destructive",
} as const;

const quando = (iso: string) => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  if (min < 24 * 60) return `há ${Math.round(min / 60)} h`;
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
};

export function SinoAvisos({ daTrilha }: { daTrilha: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [resumo, setResumo] = useState<ResumoSino | null>(null);

  const atualizar = useCallback(() => {
    resumoDoSino()
      .then(setResumo)
      .catch(() => {});
  }, []);

  useEffect(() => {
    atualizar();
  }, [pathname, atualizar]);

  useEffect(() => {
    const t = setInterval(atualizar, 60_000);
    return () => clearInterval(t);
  }, [atualizar]);

  const n = resumo?.naoLidos ?? 0;

  const abrir = async (id: string, link: string | null) => {
    await marcarAvisosLidos([id]);
    atualizar();
    if (link) router.push(link);
    else if (daTrilha) router.push("/avisos");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={n ? `${n} aviso(s) novo(s)` : "Avisos"}
        className="relative ml-auto inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Bell className="size-5" aria-hidden="true" />
        {n ? (
          <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-semibold text-white tabular-nums">
            {n > 99 ? "99+" : n}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[22rem] max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Avisos</span>
          {n ? (
            <button
              type="button"
              className="text-xs font-normal text-muted-foreground hover:text-foreground"
              onClick={async (e) => {
                e.preventDefault();
                await marcarAvisosLidos();
                atualizar();
              }}
            >
              marcar todos como lidos
            </button>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {resumo?.recentes.length ? (
          resumo.recentes.map((a) => (
            <DropdownMenuItem key={a.id} className="flex items-start gap-2 py-2" onSelect={() => abrir(a.id, a.link)}>
              <span aria-hidden="true" className={cn("mt-1.5 size-2 shrink-0 rounded-full", a.lido ? "bg-transparent" : COR[a.gravidade])} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className={cn("text-sm leading-snug", a.lido ? "text-muted-foreground" : "font-medium text-foreground")}>
                  {a.titulo}
                </span>
                <span className="text-xs text-muted-foreground">{quando(a.created_at)}</span>
              </span>
            </DropdownMenuItem>
          ))
        ) : (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">Nenhum aviso por enquanto.</p>
        )}
        {daTrilha ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/avisos" className="justify-center text-sm">
                Ver todos os avisos e mensagens
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
