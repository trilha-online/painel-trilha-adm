"use server";

import { createClient as clienteSemCookies } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { linkDoSite } from "@/lib/site";
import { isValidEmail } from "@/lib/br";
import { criarAviso } from "@/lib/avisos";
import { enviarWhatsApp, textoRedefinicaoSenha } from "@/lib/notificacoes";
import {
  MINUTOS_DO_LINK,
  PEDIDOS_POR_HORA,
  RECADO_PEDIDO,
  SENHA_MINIMA,
  lerPedido,
  novoPedido,
  pedidosNaUltimaHora,
  quemPediu,
} from "@/lib/senha";

/**
 * A senha da própria pessoa: pedir uma nova, criar a nova pelo link, trocar
 * estando logada.
 *
 * As duas primeiras são escritas PÚBLICAS — quem chama não tem sessão. Vão
 * pela chave de servidor, com a forma fixa e a regra escrita aqui, como o
 * primeiro acesso em `convite.ts`. A troca exige sessão e a senha atual.
 *
 * A senha de OUTRA pessoa continua sendo trocada pela Trilha, na ficha de
 * acesso de cada cadastro. Nada aqui mexe nisso.
 */

export type ResultadoSenha = { ok: true } | { ok: false; erro: string };

const SENHA_CURTA = `A senha precisa ter ao menos ${SENHA_MINIMA} caracteres.`;

/** O que o Supabase diz ao recusar uma senha, em português e sem detalhe técnico. */
function recusaDaSenha(erro: { code?: string; message?: string }): string {
  if (erro.code === "same_password") return "A senha nova precisa ser diferente da anterior.";
  if (erro.code === "weak_password") {
    return "Essa senha é fraca demais. Use uma mais longa, misturando letras e números.";
  }
  return "Não consegui salvar a senha nova. Tente de novo em instantes.";
}

/**
 * Deixa a pessoa logada com a senha que ela acabou de definir e encerra as
 * OUTRAS sessões abertas com este acesso — outro computador, outro celular.
 * Se alguém tinha a senha antiga e entrou com ela, sai agora.
 *
 * O encerramento vai pela chave de servidor com o token da sessão nova, e não
 * por `signOut` do cliente: nesta mesma requisição, o cliente ainda pode estar
 * lendo os cookies de antes do login.
 */
async function entrarEFecharOutras(email: string, senha: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error || !data.session) {
    console.error("[senha] senha salva, mas o login logo depois falhou:", error?.message);
    return false;
  }

  const { error: erroFechar } = await createAdminClient().auth.admin.signOut(data.session.access_token, "others");
  if (erroFechar) console.error("[senha] não consegui encerrar as outras sessões:", erroFechar.message);
  return true;
}

// ------------------------------------------------------------ pedir

/**
 * "Esqueci minha senha": manda o link para o WhatsApp do cadastro.
 *
 * A resposta é `ok` em todos os casos em que a culpa não é do e-mail digitado
 * — inclusive quando não existe acesso com ele, quando o teto de pedidos da
 * hora já foi atingido e quando o WhatsApp falhou. A tela diz sempre a mesma
 * frase ("se houver um acesso com este e-mail…"), e quem tenta descobrir quem
 * está cadastrado não descobre nada. Quando a falha é do lado da Trilha (sem
 * telefone, WhatsApp fora do ar), ela fica sabendo pelo sino.
 */
export async function pedirSenhaNova(email: string): Promise<ResultadoSenha> {
  const limpo = (email ?? "").trim().toLowerCase();
  if (!isValidEmail(limpo)) return { ok: false, erro: "Digite um e-mail válido." };

  const admin = createAdminClient();

  try {
    const quem = await quemPediu(admin, limpo);
    if (!quem) return { ok: true };

    if ((await pedidosNaUltimaHora(admin, quem.contaId)) >= PEDIDOS_POR_HORA) {
      console.warn("[senha] teto de pedidos da hora atingido:", quem.contaId);
      return { ok: true };
    }

    if (!quem.telefone) {
      const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
      await criarAviso(admin, {
        chave: `senha-sem-telefone:${quem.contaId}:${dia}`,
        tipo: "senha",
        gravidade: "atencao",
        titulo: `Pedido de senha nova sem WhatsApp: ${quem.nome}`,
        texto:
          "A pessoa pediu uma senha nova na tela de login, mas o cadastro não tem telefone. " +
          "Cadastre o telefone para ela pedir de novo, ou troque a senha pela ficha de acesso.",
      });
      return { ok: true };
    }

    const { token, hash, expiraEm } = novoPedido();
    const { error } = await admin
      .from("redefinicao_senha")
      .insert({ conta_id: quem.contaId, token_hash: hash, expira_em: expiraEm });

    if (error) {
      console.error("[senha] pedido não gravado:", error.message);
      return { ok: false, erro: "Não consegui gerar o link agora. Tente de novo em instantes." };
    }

    const link = await linkDoSite(`/redefinir-senha?t=${token}`);
    const envio = await enviarWhatsApp(
      quem.telefone,
      textoRedefinicaoSenha({ nome: quem.nome, link, minutos: MINUTOS_DO_LINK }),
    );

    if (!envio.ok) {
      console.error("[senha] WhatsApp do link não saiu:", envio.erro);
      await criarAviso(admin, {
        tipo: "senha",
        gravidade: "problema",
        titulo: `Link de senha nova não saiu: ${quem.nome}`,
        texto:
          `${envio.erro}\n\nConfira o telefone do cadastro. A pessoa pode pedir de novo na tela ` +
          "de login, ou a Trilha troca a senha pela ficha de acesso.",
      });
    }

    return { ok: true };
  } catch (e) {
    console.error("[senha] falha ao pedir senha nova:", e);
    return { ok: false, erro: "Não consegui enviar agora. Tente de novo em instantes." };
  }
}

// ------------------------------------------------------------ criar pelo link

/**
 * Define a senha nova com o link do WhatsApp e já deixa a pessoa logada.
 *
 * O link é QUEIMADO antes de a senha mudar, numa escrita condicional: dois
 * cliques no mesmo link (aba duplicada, botão apertado duas vezes) não passam
 * os dois. Se a senha não puder ser salva, o link volta a valer — a pessoa
 * não precisa pedir outro por uma falha que não foi dela.
 */
export async function definirSenhaNova(
  token: string,
  senha: string,
): Promise<{ ok: true; entrou: boolean } | { ok: false; erro: string }> {
  if (!senha || senha.length < SENHA_MINIMA) return { ok: false, erro: SENHA_CURTA };

  const admin = createAdminClient();
  const lido = await lerPedido(admin, token ?? "");
  if (!lido.ok) return { ok: false, erro: RECADO_PEDIDO[lido.motivo] };

  const { id, contaId, email } = lido.pedido;

  const { data: queimado } = await admin
    .from("redefinicao_senha")
    .update({ usado_em: new Date().toISOString() })
    .eq("id", id)
    .is("usado_em", null)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (!queimado) return { ok: false, erro: RECADO_PEDIDO.usado };

  const { error } = await admin.auth.admin.updateUserById(contaId, { password: senha });
  if (error) {
    console.error("[senha] senha nova recusada:", error.code, error.message);
    await admin.from("redefinicao_senha").update({ usado_em: null }).eq("id", id);
    return { ok: false, erro: recusaDaSenha(error) };
  }

  return { ok: true, entrou: await entrarEFecharOutras(email, senha) };
}

// ------------------------------------------------------------ trocar logado

/**
 * Trocar a senha estando logado: pede a atual, como qualquer sistema sério —
 * um computador esquecido aberto não pode virar a troca da senha de alguém.
 *
 * A senha atual é conferida num cliente à parte, sem cookies: uma tentativa
 * errada ali não mexe na sessão que está aberta nesta tela.
 */
export async function trocarSenha(atual: string, nova: string): Promise<ResultadoSenha> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, erro: "A sua sessão expirou. Entre de novo." };

  if (!atual) return { ok: false, erro: "Digite a sua senha atual." };
  if (!nova || nova.length < SENHA_MINIMA) return { ok: false, erro: SENHA_CURTA };
  if (nova === atual) return { ok: false, erro: "A senha nova precisa ser diferente da atual." };

  const conferencia = clienteSemCookies(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error: erroAtual } = await conferencia.auth.signInWithPassword({ email: user.email, password: atual });

  if (erroAtual) {
    if (erroAtual.status === 429) {
      return { ok: false, erro: "Muitas tentativas seguidas. Espere alguns minutos e tente de novo." };
    }
    return { ok: false, erro: "A senha atual não confere." };
  }

  const { error } = await createAdminClient().auth.admin.updateUserById(user.id, { password: nova });
  if (error) {
    console.error("[senha] troca recusada:", error.code, error.message);
    return { ok: false, erro: recusaDaSenha(error) };
  }

  // Também encerra a sessão aberta pela conferência acima, que é uma "outra".
  await entrarEFecharOutras(user.email, nova);
  return { ok: true };
}
