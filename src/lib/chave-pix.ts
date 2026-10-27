/**
 * Avisar o DONO de uma chave Pix — troca de chave e repasse que a chave
 * derrubou (ciclo 2, out/2026).
 *
 * A troca em si é detectada no banco (`chave-pix-1-historico.sql`): todo
 * UPDATE de chave vira linha em `chave_pix_alteracao` e aviso no sino da
 * Trilha. Aqui é só a outra ponta: ler as trocas ainda não avisadas e pôr o
 * WhatsApp do dono na fila.
 *
 * Não é "use server" de propósito: nada aqui confere quem chama. Quem chama
 * (actions depois de salvar, a rotina das 10h, o webhook) passa a chave de
 * servidor.
 *
 * Nada aqui derruba quem chamou: o cadastro já foi salvo, o repasse já falhou.
 * Erro vira log.
 */

import type { createAdminClient } from "@/lib/supabase/admin";
import { criarAviso, despachar, digitosDe, enfileirar, type Papel } from "@/lib/avisos";
import { formatBRL } from "@/lib/br";
import {
  textoChavePixAlterada,
  textoRepasseChaveRecusada,
  type MotivoChaveRecusada,
} from "@/lib/notificacoes";

type Admin = ReturnType<typeof createAdminClient>;

/** Onde o painel está, para os links das mensagens. Sem cabeçalho de requisição: roda também na rotina. */
const painel = (caminho: string) =>
  `${(process.env.SITE_URL?.trim() || "https://painel.trilha.online").replace(/\/$/, "")}${caminho}`;

const quandoBR = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date(iso))
    .replace(",", " às");

const diaBR = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));

/**
 * O suficiente para o dono reconhecer a chave, sem a mensagem servir de
 * cópia dela: "lu•••@gmail.com", "•••1140".
 */
export function mascararChave(chave: string | null | undefined): string | null {
  const c = chave?.trim();
  if (!c) return null;
  const arroba = c.indexOf("@");
  if (arroba > 0) return `${c.slice(0, Math.min(2, arroba))}•••${c.slice(arroba)}`;
  if (c.length <= 4) return "••••";
  return `•••${c.slice(-4)}`;
}

/**
 * A recusa do Asaas é problema DE CHAVE (o dono resolve) ou da Trilha (saldo,
 * limite, configuração)? Na dúvida, não: avisar o dono de um problema que
 * não é dele assusta e não resolve nada. A Trilha é avisada de todo jeito.
 */
export function ehProblemaDeChave(mensagem: string | null | undefined): boolean {
  const m = mensagem ?? "";
  if (/saldo|balance|limite|limit/i.test(m)) return false;
  return /chave|pix|dict|key|destinat/i.test(m);
}

// ---------------------------------------------------------------- o dono

type DonoTipo = "incorporadora" | "parceiro";

type Dono = {
  nome: string;
  /** Sem telefone não há WhatsApp, mas o aviso no sino sai do mesmo jeito. */
  telefone: string | null;
  contaId: string | null;
  papel: Papel;
  /** Onde ele mesmo corrige a chave. Nulo enquanto não houver tela para ele. */
  link: string | null;
  /** O mesmo lugar, como caminho do painel — para o aviso no sino. */
  caminho: string | null;
};

/** Para quem vai o aviso no sino. */
const destinatario = (tipo: DonoTipo, id: string) =>
  tipo === "parceiro" ? { parceiroId: id } : { incorporadoraId: id };

async function lerDono(admin: Admin, tipo: DonoTipo, id: string): Promise<Dono | null> {
  if (tipo === "parceiro") {
    const { data } = await admin
      .from("parceiro")
      .select("nome, telefone, conta_id")
      .eq("id", id)
      .maybeSingle<{ nome: string; telefone: string | null; conta_id: string | null }>();
    if (!data) return null;
    // O corretor ainda não edita os próprios dados (ciclo 4): sem link.
    return { nome: data.nome, telefone: data.telefone, contaId: data.conta_id, papel: "corretor", link: null, caminho: null };
  }

  const { data } = await admin
    .from("incorporadora")
    .select("nome, resp_nome, telefone, resp_telefone, conta_id, tipo")
    .eq("id", id)
    .maybeSingle<{
      nome: string;
      resp_nome: string | null;
      telefone: string | null;
      resp_telefone: string | null;
      conta_id: string | null;
      tipo: string;
    }>();
  // O responsável é quem fala pela empresa; o telefone geral é o reserva.
  if (!data) return null;
  const telefone = data.resp_telefone || data.telefone || null;
  return {
    nome: data.resp_nome ?? data.nome,
    telefone,
    contaId: data.conta_id,
    papel: "vendedor",
    link: data.conta_id ? painel("/perfil") : null,
    caminho: data.conta_id ? "/perfil" : null,
  };
}

// ------------------------------------------------------------ troca de chave

type Troca = {
  id: string;
  created_at: string;
  dono_tipo: DonoTipo;
  incorporadora_id: string | null;
  parceiro_id: string | null;
  chave_antiga: string | null;
  chave_nova: string | null;
  alterado_por: string | null;
  alterado_por_papel: "trilha" | "incorporadora" | "parceiro" | "sistema";
};

/**
 * Põe na fila o WhatsApp de cada troca de chave ainda não avisada ao dono.
 * Devolve os ids das mensagens novas — quem chama decide se despacha agora
 * (action, depois da resposta) ou deixa para a varredura (rotina).
 *
 * A ficha do vendedor PF e o cadastro dele mudam juntos e geram duas linhas
 * de histórico: aqui viram UMA mensagem (mesmo dono, mesmo antes → depois,
 * mesmo dia), como no sino.
 */
export async function avisarTrocasDeChave(admin: Admin): Promise<string[]> {
  try {
    const seteDias = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data, error } = await admin
      .from("chave_pix_alteracao")
      .select(
        "id, created_at, dono_tipo, incorporadora_id, parceiro_id, chave_antiga, chave_nova, alterado_por, alterado_por_papel",
      )
      .is("dono_avisado_em", null)
      .gte("created_at", seteDias)
      .order("created_at")
      .limit(50)
      .returns<Troca[]>();
    if (error) {
      console.error("[chave pix] trocas não lidas:", error.message);
      return [];
    }

    const grupos = new Map<string, Troca[]>();
    for (const t of data ?? []) {
      const donoId = t.incorporadora_id ?? t.parceiro_id ?? "";
      const k = `${t.dono_tipo}:${donoId}:${t.chave_antiga ?? ""}>${t.chave_nova ?? ""}:${diaBR(t.created_at)}`;
      grupos.set(k, [...(grupos.get(k) ?? []), t]);
    }

    const ids: string[] = [];
    for (const [k, trocas] of grupos) {
      const t = trocas[0];
      const donoId = t.incorporadora_id ?? t.parceiro_id;
      const dono = donoId ? await lerDono(admin, t.dono_tipo, donoId) : null;

      if (dono && donoId) {
        const propria = Boolean(t.alterado_por && t.alterado_por === dono.contaId);
        const quemTrocou = await descreverQuem(admin, t);
        const nova = mascararChave(t.chave_nova);

        // O sino do dono: sai mesmo sem telefone.
        await criarAviso(admin, {
          chave: `pix-dono:${hash(k)}`,
          tipo: "chave_pix",
          gravidade: propria ? "info" : "atencao",
          titulo: propria ? "Sua chave Pix foi alterada" : `Sua chave Pix foi alterada por ${quemTrocou}`,
          texto:
            `Em ${quandoBR(t.created_at)}. ` +
            (nova ? `Nova chave: ${nova}.` : "A chave foi removida: sem ela, os repasses não saem.") +
            " Se não foi você quem pediu, fale com a equipe da Trilha.",
          link: dono.caminho ?? undefined,
          ...destinatario(t.dono_tipo, donoId),
        });

        const novos = !dono.telefone ? [] : await enfileirar(admin, [
          {
            // Sem a chave em si: a chave da fila é visível no log de mensagens.
            chave: `pix-troca:${hash(k)}`,
            destino: digitosDe(dono.telefone),
            destinatario: `${dono.nome} (${dono.papel})`,
            papel: dono.papel,
            assunto: "Chave Pix alterada",
            texto: textoChavePixAlterada({
              nome: dono.nome,
              quemTrocou,
              propria,
              quando: quandoBR(t.created_at),
              chaveNova: nova,
              link: dono.link,
            }),
          },
        ]);
        ids.push(...novos);
      }

      // Marca mesmo sem telefone: o sino do dono já recebeu, e não há o que
      // tentar de novo pelo WhatsApp.
      await admin
        .from("chave_pix_alteracao")
        .update({ dono_avisado_em: new Date().toISOString() })
        .in(
          "id",
          trocas.map((x) => x.id),
        );
    }
    return ids;
  } catch (e) {
    console.error("[chave pix] aviso ao dono falhou:", e);
    return [];
  }
}

/** Para as actions, depois da resposta: enfileira e já manda. */
export async function avisarTrocasEDespachar(admin: Admin): Promise<void> {
  const ids = await avisarTrocasDeChave(admin);
  if (ids.length) await despachar(admin, ids);
}

async function descreverQuem(admin: Admin, t: Troca): Promise<string> {
  // Fora do painel é SQL manual — só quem tem acesso ao banco, que é a Trilha.
  if (t.alterado_por_papel === "trilha" || t.alterado_por_papel === "sistema" || !t.alterado_por) {
    return "a equipe da Trilha";
  }
  const { data } = await admin
    .from("conta")
    .select("nome")
    .eq("id", t.alterado_por)
    .maybeSingle<{ nome: string }>();
  const rotulo = t.alterado_por_papel === "parceiro" ? "corretor" : "incorporadora";
  return data?.nome ? `${data.nome} (${rotulo})` : `a ${rotulo}`;
}

/** Curto e estável: a chave da fila não precisa carregar a chave Pix em claro. */
function hash(texto: string): string {
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// --------------------------------------------------- repasse que a chave derrubou

/**
 * Põe na fila o WhatsApp para o dono de um lote que não saiu por causa da
 * chave. Uma mensagem por lote: "tentar de novo" que falha de novo não manda
 * outra.
 *
 * Só enfileira. Na rotina das 6h a mensagem sai na varredura das 10h — hora
 * decente para mandar WhatsApp — e no webhook, quem chama despacha.
 */
export async function avisarDonoDoRepasse(
  admin: Admin,
  loteId: string,
  motivo: MotivoChaveRecusada,
): Promise<string[]> {
  try {
    const { data: l } = await admin
      .from("repasse_lote")
      .select("beneficiario, incorporadora_id, parceiro_id, valor, data_ref")
      .eq("id", loteId)
      .maybeSingle<{
        beneficiario: "vendedor" | "corretor";
        incorporadora_id: string | null;
        parceiro_id: string | null;
        valor: number;
        data_ref: string;
      }>();
    if (!l) return [];

    const tipo: DonoTipo = l.beneficiario === "corretor" ? "parceiro" : "incorporadora";
    const donoId = l.parceiro_id ?? l.incorporadora_id;
    const dono = donoId ? await lerDono(admin, tipo, donoId) : null;
    if (!dono || !donoId) return [];

    // A chave que o repasse tentou usar é a de AGORA no cadastro.
    const { data: chaves } = await admin.rpc("chave_pix_do_lote", { p_lote: loteId });
    const chave = (chaves as { chave: string | null }[] | null)?.[0]?.chave ?? null;

    const [ano, mes] = l.data_ref.split("-");
    const valor = formatBRL(Number(l.valor));

    await criarAviso(admin, {
      chave: `pix-recusada-dono:${loteId}`,
      tipo: "repasse",
      gravidade: "problema",
      titulo: `Repasse de ${valor} não enviado: confira sua chave Pix`,
      texto:
        motivo === "sem_chave"
          ? "Não há chave Pix cadastrada. Cadastre e fale com a equipe da Trilha para enviarmos de novo."
          : `A chave cadastrada (${mascararChave(chave) ?? "—"}) não funcionou. Corrija e fale com a equipe da Trilha para enviarmos de novo.`,
      link: dono.caminho ?? undefined,
      ...destinatario(tipo, donoId),
    });

    if (!dono.telefone) return [];
    return await enfileirar(admin, [
      {
        chave: `pix-recusada:${loteId}`,
        destino: digitosDe(dono.telefone),
        destinatario: `${dono.nome} (${dono.papel})`,
        papel: dono.papel,
        assunto: "Repasse não enviado: chave Pix",
        texto: textoRepasseChaveRecusada({
          nome: dono.nome,
          valor,
          referencia: `${mes}/${ano}`,
          motivo,
          chave: mascararChave(chave),
          link: dono.link,
        }),
      },
    ]);
  } catch (e) {
    console.error("[chave pix] aviso de repasse ao dono falhou:", loteId, e);
    return [];
  }
}
