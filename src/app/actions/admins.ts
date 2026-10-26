"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { acessoSchema, adminEdicaoSchema, adminSchema } from "@/lib/schemas";
import { stripMask } from "@/lib/br";
import { ehAdmin, getSessao } from "@/lib/sessao";

/**
 * Os administradores da Trilha.
 *
 * Diferente de incorporadora e parceiro, aqui NÃO existe cadastro separado: um
 * admin é uma linha da tabela `conta` com `tipo = 'trilha_admin'`. É por isso
 * que não há "criar acesso" depois — criar o admin É criar o acesso.
 *
 * Duas regras valem para tudo neste arquivo:
 *
 * 1. **A tabela `conta` não tem nenhuma policy de escrita.** Ninguém logado
 *    insere, altera ou apaga linha nela — é o que impede alguém se promover a
 *    admin. Então toda escrita aqui passa pela chave de servidor, DEPOIS de a
 *    action conferir que quem pediu é admin ativo.
 * 2. **Quem decide se ainda há admin é o banco.** O gatilho
 *    `conta_ultimo_admin` barra desativar, trocar de tipo ou apagar o último
 *    admin ativo, e manda a frase de volta no errcode 23514. A action não
 *    tenta adivinhar isso — só repassa a frase.
 */

export type Resultado = { id: string; erro: null } | { id: null; erro: string };

const detalhar = (mensagem: string, erro: { code?: string; message?: string } | null) =>
  erro?.message ? `${mensagem} (${erro.code ?? "sem código"}: ${erro.message})` : mensagem;

/** A frase do gatilho do banco é a frase que a pessoa precisa ler. */
function falhou(mensagem: string, erro: { code?: string; message?: string } | null): string {
  if (erro?.code === "23514" && erro.message) return erro.message;
  return detalhar(mensagem, erro);
}

/** Quem pode mexer em admin: outro admin ativo. */
async function soAdmin(): Promise<{ ok: true; meuId: string } | { ok: false; erro: string }> {
  const sessao = await getSessao();
  if (!sessao?.conta) return { ok: false, erro: "Sessão expirada. Entre de novo." };
  if (!ehAdmin(sessao)) {
    return { ok: false, erro: "Só um administrador da Trilha pode gerenciar administradores." };
  }
  return { ok: true, meuId: sessao.usuarioId };
}

function servidor() {
  try {
    return { ok: true as const, admin: createAdminClient() };
  } catch {
    return {
      ok: false as const,
      erro: "A chave de administrador do Supabase não está configurada no .env.local.",
    };
  }
}

const revalidar = (id?: string) => {
  revalidatePath("/administradores");
  if (id) revalidatePath(`/administradores/${id}`);
};

// --------------------------------------------------------------- criar

export async function criarAdmin(bruto: unknown): Promise<Resultado> {
  const permissao = await soAdmin();
  if (!permissao.ok) return { id: null, erro: permissao.erro };

  const parsed = adminSchema.safeParse(bruto);
  if (!parsed.success) {
    return { id: null, erro: "Confira os campos destacados e tente de novo." };
  }

  const { nome, telefone, acesso } = parsed.data;

  const chave = servidor();
  if (!chave.ok) return { id: null, erro: chave.erro };
  const { admin } = chave;

  const { data: novoUsuario, error: erroUsuario } = await admin.auth.admin.createUser({
    email: acesso.email,
    password: acesso.senha,
    email_confirm: true,
  });

  if (erroUsuario || !novoUsuario?.user) {
    const jaExiste = erroUsuario?.message?.toLowerCase().includes("already");
    return {
      id: null,
      erro: jaExiste
        ? "Já existe um acesso com esse e-mail. Use outro e-mail, ou veja se essa pessoa já está na lista desativada."
        : detalhar("Não foi possível criar o acesso.", erroUsuario),
    };
  }

  const contaId = novoUsuario.user.id;

  const { error: erroConta } = await admin.from("conta").insert({
    id: contaId,
    tipo: "trilha_admin",
    nome,
    email: acesso.email,
    telefone: telefone ? stripMask(telefone) : null,
    ativo: true,
  });

  if (erroConta) {
    // Sem a linha na `conta`, o login entra e não vê nada — o pior estado
    // possível. Desfaz o usuário antes de devolver o erro.
    await admin.auth.admin.deleteUser(contaId);
    return { id: null, erro: detalhar("Não foi possível criar a conta de acesso.", erroConta) };
  }

  revalidar(contaId);
  return { id: contaId, erro: null };
}

// --------------------------------------------------------------- editar

export async function atualizarAdmin(id: string, bruto: unknown): Promise<Resultado> {
  const permissao = await soAdmin();
  if (!permissao.ok) return { id: null, erro: permissao.erro };

  const parsed = adminEdicaoSchema.safeParse(bruto);
  if (!parsed.success) {
    return { id: null, erro: "Confira os campos destacados e tente de novo." };
  }

  const chave = servidor();
  if (!chave.ok) return { id: null, erro: chave.erro };

  const { data, error } = await chave.admin
    .from("conta")
    .update({
      nome: parsed.data.nome,
      telefone: parsed.data.telefone ? stripMask(parsed.data.telefone) : null,
    })
    .eq("id", id)
    .eq("tipo", "trilha_admin")
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || !data) {
    return { id: null, erro: falhou("Não foi possível salvar os dados.", error) };
  }

  revalidar(id);
  return { id, erro: null };
}

/** Troca o e-mail de login e, opcionalmente, a senha. */
export async function atualizarAcessoAdmin(id: string, bruto: unknown): Promise<Resultado> {
  const permissao = await soAdmin();
  if (!permissao.ok) return { id: null, erro: permissao.erro };

  const parsed = acessoSchema.safeParse(bruto);
  if (!parsed.success) {
    return { id: null, erro: "Confira os campos destacados e tente de novo." };
  }

  const { email, senha } = parsed.data;

  const chave = servidor();
  if (!chave.ok) return { id: null, erro: chave.erro };
  const { admin } = chave;

  // Confere que o id é de um admin antes de mexer no Auth: a tabela `conta` é
  // a única fonte do papel, e o Auth não sabe nada sobre papel.
  const { data: alvo } = await admin
    .from("conta")
    .select("id")
    .eq("id", id)
    .eq("tipo", "trilha_admin")
    .maybeSingle<{ id: string }>();

  if (!alvo) return { id: null, erro: "Este acesso não é de um administrador da Trilha." };

  const { error: erroAuth } = await admin.auth.admin.updateUserById(id, {
    email,
    ...(senha ? { password: senha } : {}),
    email_confirm: true,
  });

  if (erroAuth) {
    const jaExiste = erroAuth.message?.toLowerCase().includes("already");
    return {
      id: null,
      erro: jaExiste
        ? "Já existe um acesso com esse e-mail."
        : detalhar("Não foi possível atualizar o acesso.", erroAuth),
    };
  }

  // O e-mail vive em dois lugares: no Auth (é por ele que se entra) e na
  // `conta` (é o que as telas mostram). Trocar um sem o outro deixa a lista
  // mentindo.
  const { error: erroConta } = await admin.from("conta").update({ email }).eq("id", id);
  if (erroConta) {
    return {
      id: null,
      erro: detalhar(
        "O login foi alterado, mas o e-mail da ficha não. Salve de novo para alinhar.",
        erroConta,
      ),
    };
  }

  revalidar(id);
  return { id, erro: null };
}

// ----------------------------------------------------- ativar / desativar

/**
 * Liga ou desliga um acesso de admin.
 *
 * Desativar em vez de apagar porque todo rastro de quem fez o quê aponta para
 * a `conta` (`concluido_por`, `decidida_por`, `pago_por`…) e é `on delete set
 * null`: apagar não derruba nada, mas transforma "concluído por Arthur" em
 * "concluído por —". O histórico vale mais que a linha a menos.
 *
 * Duas travas, em camadas diferentes:
 * - **aqui:** ninguém desativa a si mesmo. É erro de dedo clássico, e quem se
 *   desativa perde a tela onde desfaria isso.
 * - **no banco:** o gatilho `conta_ultimo_admin` impede ficar sem nenhum admin
 *   ativo, inclusive se a conta for mexida pelo painel do Supabase.
 */
export async function definirAtivoAdmin(id: string, ativo: boolean): Promise<Resultado> {
  const permissao = await soAdmin();
  if (!permissao.ok) return { id: null, erro: permissao.erro };

  if (id === permissao.meuId && !ativo) {
    return {
      id: null,
      erro: "Você não pode desativar o seu próprio acesso. Pede para outro administrador fazer isso.",
    };
  }

  const chave = servidor();
  if (!chave.ok) return { id: null, erro: chave.erro };

  const { data, error } = await chave.admin
    .from("conta")
    .update({ ativo })
    .eq("id", id)
    .eq("tipo", "trilha_admin")
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || !data) {
    return {
      id: null,
      erro: falhou(
        ativo ? "Não foi possível reativar o acesso." : "Não foi possível desativar o acesso.",
        error,
      ),
    };
  }

  revalidar(id);
  return { id, erro: null };
}
