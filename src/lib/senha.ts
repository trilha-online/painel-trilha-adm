import { createHash, randomBytes } from "node:crypto";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * A senha nova, do lado de quem esqueceu a antiga.
 *
 * Irmão de `lib/convite.ts`: quem pede a senha nova não tem sessão, então tudo
 * aqui vai pela chave de servidor — com forma fixa e sem aceitar "quais
 * campos" nem "qual filtro" de fora. O e-mail (para pedir) e o token (para
 * usar) são as únicas entradas.
 *
 * NÃO é "use server" de propósito: nada aqui confere quem chama. As portas
 * ficam em `app/actions/senha.ts`.
 *
 * O desenho, em três regras (ver `supabase/redefinicao-senha.sql`):
 *   - o token só existe no link; o banco guarda o hash;
 *   - vale uma vez, por `MINUTOS_DO_LINK`, e só o pedido mais recente da conta;
 *   - a resposta de "pedir" é a mesma exista ou não o e-mail, para a tela não
 *     virar um jeito de descobrir quem tem acesso ao painel.
 */

type Admin = ReturnType<typeof createAdminClient>;

export const MINUTOS_DO_LINK = 60;

/**
 * Teto de pedidos por conta, por hora. Cada pedido é um WhatsApp no celular
 * de alguém: sem teto, a tela vira um jeito de importunar qualquer pessoa
 * cadastrada sabendo só o e-mail dela.
 */
export const PEDIDOS_POR_HORA = 3;

/** O mesmo mínimo do primeiro acesso e da ficha de acesso. */
export const SENHA_MINIMA = 8;

export const hashDoToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/** Token aleatório e longo; o banco recebe só o hash. */
export function novoPedido() {
  const token = randomBytes(32).toString("hex");
  return {
    token,
    hash: hashDoToken(token),
    expiraEm: new Date(Date.now() + MINUTOS_DO_LINK * 60_000).toISOString(),
  };
}

/** No ILIKE, `_` e `%` de um e-mail são letras, não curingas. */
const semCuringas = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

export type Destinatario = { contaId: string; nome: string; telefone: string | null };

/**
 * De quem é este e-mail, e para qual WhatsApp vai o link. `null` quando não há
 * acesso com ele — ou quando o acesso está desligado: quem foi desativado não
 * recebe link para entrar numa tela que vai dizer que o acesso está desligado.
 *
 * O telefone sai do cadastro de cada tipo, que é o que a equipe mantém em dia
 * — `conta.telefone` é a cópia do dia em que o login nasceu. Para vendedor, é
 * o do RESPONSÁVEL, o mesmo que já recebe os avisos de negócio: quem tem o
 * login é a pessoa, não o telefone da empresa.
 */
export async function quemPediu(admin: Admin, email: string): Promise<Destinatario | null> {
  const { data: contas } = await admin
    .from("conta")
    .select("id, tipo, nome, telefone, ativo")
    .ilike("email", semCuringas(email.trim()))
    .limit(2);

  // Dois logins com o mesmo e-mail não deveriam existir; se existirem, não é
  // aqui que se escolhe um deles.
  if (!contas || contas.length !== 1) return null;

  const c = contas[0] as { id: string; tipo: string; nome: string; telefone: string | null; ativo: boolean };
  if (!c.ativo) return null;

  if (c.tipo === "trilha_admin") return { contaId: c.id, nome: c.nome, telefone: c.telefone };

  if (c.tipo === "incorporadora") {
    const { data: v } = await admin
      .from("incorporadora")
      .select("resp_nome, resp_telefone, telefone, ativo")
      .eq("conta_id", c.id)
      .maybeSingle<{ resp_nome: string | null; resp_telefone: string | null; telefone: string | null; ativo: boolean }>();
    if (!v || !v.ativo) return null;
    return {
      contaId: c.id,
      nome: v.resp_nome || c.nome,
      telefone: v.resp_telefone || v.telefone || c.telefone,
    };
  }

  const { data: p } = await admin
    .from("parceiro")
    .select("nome, telefone")
    .eq("conta_id", c.id)
    .maybeSingle<{ nome: string | null; telefone: string | null }>();
  return { contaId: c.id, nome: p?.nome || c.nome, telefone: p?.telefone || c.telefone };
}

/** Quantos pedidos esta conta fez na última hora (usados ou não). */
export async function pedidosNaUltimaHora(admin: Admin, contaId: string): Promise<number> {
  const desde = new Date(Date.now() - 60 * 60_000).toISOString();
  const { count } = await admin
    .from("redefinicao_senha")
    .select("id", { count: "exact", head: true })
    .eq("conta_id", contaId)
    .gte("created_at", desde);
  return count ?? 0;
}

export type PedidoAberto = { id: string; contaId: string; nome: string; email: string };

export type MotivoPedido = "invalido" | "expirado" | "usado" | "substituido";

/**
 * O pedido de um link, ou o motivo de não valer. Cada motivo tem um recado
 * diferente na tela porque cada um pede uma ação diferente: quem já usou o
 * link entra com a senha nova; quem esperou demais, ou pediu de novo, precisa
 * do link mais recente.
 */
export async function lerPedido(
  admin: Admin,
  token: string,
): Promise<{ ok: true; pedido: PedidoAberto } | { ok: false; motivo: MotivoPedido }> {
  if (!/^[0-9a-f]{64}$/.test(token)) return { ok: false, motivo: "invalido" };

  const { data } = await admin
    .from("redefinicao_senha")
    .select("id, conta_id, expira_em, usado_em, created_at")
    .eq("token_hash", hashDoToken(token))
    .maybeSingle<{ id: string; conta_id: string; expira_em: string; usado_em: string | null; created_at: string }>();

  if (!data) return { ok: false, motivo: "invalido" };
  if (data.usado_em) return { ok: false, motivo: "usado" };
  if (new Date(data.expira_em) < new Date()) return { ok: false, motivo: "expirado" };

  const { count } = await admin
    .from("redefinicao_senha")
    .select("id", { count: "exact", head: true })
    .eq("conta_id", data.conta_id)
    .gt("created_at", data.created_at);
  if ((count ?? 0) > 0) return { ok: false, motivo: "substituido" };

  // O e-mail vem do LOGIN, não da cópia em `conta`: é com ele que a pessoa
  // vai entrar, e é ele que o gerenciador de senhas precisa guardar.
  const [{ data: conta }, { data: usuario }] = await Promise.all([
    admin.from("conta").select("nome").eq("id", data.conta_id).maybeSingle<{ nome: string }>(),
    admin.auth.admin.getUserById(data.conta_id),
  ]);
  const email = usuario?.user?.email;
  if (!email) return { ok: false, motivo: "invalido" };

  return { ok: true, pedido: { id: data.id, contaId: data.conta_id, nome: conta?.nome ?? "", email } };
}

/** O recado de cada motivo, igual na tela e na resposta da action. */
export const RECADO_PEDIDO: Record<MotivoPedido, string> = {
  usado: "Este link já foi usado. Entre com a sua senha nova — ou peça outro link, se precisar.",
  expirado: `Este link venceu: ele vale por ${MINUTOS_DO_LINK} minutos. Peça um novo.`,
  substituido: "Você pediu um link mais novo depois deste. Use o da mensagem mais recente.",
  invalido: "Não encontrei este link. Confira se ele veio inteiro na mensagem.",
};
