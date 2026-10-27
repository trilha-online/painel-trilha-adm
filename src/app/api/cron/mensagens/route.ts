import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { varrerFila } from "@/lib/avisos";
import { varrerAndamento } from "@/lib/andamento";
import { avisarTrocasDeChave } from "@/lib/chave-pix";

/**
 * A segunda chance das mensagens: `GET /api/cron/mensagens`.
 *
 * Toda mensagem tenta sair na hora em que nasce. O que falhou (uazapi fora do
 * ar, por exemplo) é tentado de novo aqui, uma vez por dia às 10h de Brasília
 * — horário decente para chegar WhatsApp em comprador. Até 3 tentativas no
 * total; depois disso, só pelo botão em Avisos → Mensagens.
 *
 * Antes, a rede de segurança do andamento: um negócio que avançou por um
 * caminho que não passa pelas actions (gatilho do banco, edição direta) tem
 * o aviso gravado aqui e sai na mesma execução.
 *
 * Mesma porta da rotina do financeiro: `Authorization: Bearer <CRON_SECRET>`.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function autorizado(header: string | null): boolean {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${segredo}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  if (!autorizado(request.headers.get("authorization"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const inicio = Date.now();
  try {
    const admin = createAdminClient();
    const andamento = await varrerAndamento(admin, inicio + 20_000);
    // Rede de segurança das trocas de chave: pega o que não passou por uma
    // action (edição direta no Supabase, envio que caiu). Só enfileira; a
    // varredura logo abaixo manda.
    const trocasDeChave = (await avisarTrocasDeChave(admin)).length;
    const fila = await varrerFila(admin, inicio + 55_000);
    return NextResponse.json({ ok: true, andamento, trocasDeChave, fila });
  } catch (e) {
    console.error("[mensagens] falha inesperada:", e);
    return NextResponse.json({ ok: false, erro: "falha inesperada" }, { status: 500 });
  }
}
