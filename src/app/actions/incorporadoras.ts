"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { avisarTrocasEDespachar } from "@/lib/chave-pix";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { acessoSchema, incorporadoraEdicaoSchema, incorporadoraSchema } from "@/lib/schemas";
import { stripMask } from "@/lib/br";
import { ehAdmin, getSessao } from "@/lib/sessao";

export type Resultado = { id: string; erro: null } | { id: null; erro: string };

const vazioVira = <T>(v: T | "" | undefined): T | null =>
  v === "" || v === undefined ? null : v;

/**
 * Junta a explicação amigável com o motivo técnico. Esconder o motivo real
 * já nos custou várias rodadas de diagnóstico às cegas — a causa raiz costuma
 * estar no código de erro do Postgres.
 */
const detalhar = (mensagem: string, erro: { code?: string; message?: string } | null) =>
  erro?.message ? `${mensagem} (${erro.code ?? "sem código"}: ${erro.message})` : mensagem;

/** Campos cadastrais, no formato que a tabela espera. */
function montarCamposCadastrais(d: {
  empresa: { nome: string; cnpj: string; email: string; telefone: string; endereco?: string };
  banco: {
    banco?: string;
    agencia?: string;
    conta_numero?: string;
    chave_pix?: string;
    chave_pix_tipo?: string;
  };
  responsavel: {
    nome: string;
    cpf: string;
    rg?: string;
    profissao?: string;
    cargo?: string;
    estado_civil?: string;
    email: string;
    telefone: string;
    endereco?: string;
  };
}) {
  return {
    nome: d.empresa.nome,
    cnpj: stripMask(d.empresa.cnpj),
    email: d.empresa.email,
    telefone: stripMask(d.empresa.telefone),
    endereco: vazioVira(d.empresa.endereco),

    resp_nome: d.responsavel.nome,
    resp_cpf: stripMask(d.responsavel.cpf),
    resp_rg: vazioVira(d.responsavel.rg),
    resp_profissao: vazioVira(d.responsavel.profissao),
    resp_cargo: vazioVira(d.responsavel.cargo),
    resp_estado_civil: vazioVira(d.responsavel.estado_civil),
    resp_email: d.responsavel.email,
    resp_telefone: stripMask(d.responsavel.telefone),
    resp_endereco: vazioVira(d.responsavel.endereco),

    banco: vazioVira(d.banco.banco),
    agencia: vazioVira(d.banco.agencia),
    conta_numero: vazioVira(d.banco.conta_numero),
    chave_pix: vazioVira(d.banco.chave_pix),
    chave_pix_tipo: vazioVira(d.banco.chave_pix_tipo),
  };
}

// --------------------------------------------------------------- criar

export async function criarIncorporadora(bruto: unknown): Promise<Resultado> {
  const sessao = await getSessao();
  if (!ehAdmin(sessao)) {
    return { id: null, erro: "Só o admin da Trilha pode cadastrar incorporadoras." };
  }

  const parsed = incorporadoraSchema.safeParse(bruto);
  if (!parsed.success) {
    return { id: null, erro: "Confira os campos destacados e tente de novo." };
  }

  const { acesso, responsavel } = parsed.data;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return {
      id: null,
      erro: "A chave de administrador do Supabase não está configurada no .env.local.",
    };
  }

  // 1. Cria o usuário que a incorporadora vai usar para entrar.
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
        ? "Já existe um acesso com esse e-mail. Use outro e-mail de acesso."
        : detalhar("Não foi possível criar o acesso da incorporadora.", erroUsuario),
    };
  }

  const contaId = novoUsuario.user.id;

  // Se algo falhar daqui para frente, o usuário criado acima vira lixo —
  // então desfazemos antes de devolver o erro.
  const desfazer = async () => {
    await admin.auth.admin.deleteUser(contaId);
  };

  const { error: erroConta } = await admin.from("conta").insert({
    id: contaId,
    tipo: "incorporadora",
    nome: responsavel.nome,
    email: acesso.email,
    telefone: stripMask(responsavel.telefone),
  });

  if (erroConta) {
    await desfazer();
    return { id: null, erro: detalhar("Não foi possível criar a conta de acesso.", erroConta) };
  }

  const { data: incorporadora, error: erroIncorporadora } = await admin
    .from("incorporadora")
    .insert({ conta_id: contaId, ...montarCamposCadastrais(parsed.data) })
    .select("id")
    .single<{ id: string }>();

  if (erroIncorporadora || !incorporadora) {
    await desfazer();
    const cnpjRepetido = erroIncorporadora?.code === "23505";
    return {
      id: null,
      erro: cnpjRepetido
        ? "Já existe uma incorporadora cadastrada com esse CNPJ."
        : detalhar("Não foi possível salvar a incorporadora.", erroIncorporadora),
    };
  }

  revalidatePath("/incorporadoras");
  return { id: incorporadora.id, erro: null };
}

// ------------------------------------------------------------ atualizar

export async function atualizarIncorporadora(id: string, bruto: unknown): Promise<Resultado> {
  const sessao = await getSessao();
  if (!ehAdmin(sessao)) {
    return { id: null, erro: "Só o admin da Trilha pode editar incorporadoras." };
  }

  const parsed = incorporadoraEdicaoSchema.safeParse(bruto);
  if (!parsed.success) {
    return { id: null, erro: "Confira os campos destacados e tente de novo." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("incorporadora")
    .update(montarCamposCadastrais(parsed.data))
    .eq("id", id);

  if (error) {
    const cnpjRepetido = error.code === "23505";
    return {
      id: null,
      erro: cnpjRepetido
        ? "Já existe outra incorporadora cadastrada com esse CNPJ."
        : detalhar("Não foi possível salvar as alterações.", error),
    };
  }

  // A troca de chave (se houve) já está no histórico, pelo gatilho do banco;
  // o WhatsApp ao dono sai depois da resposta.
  after(() => avisarTrocasEDespachar(createAdminClient()));
  revalidatePath("/incorporadoras");
  revalidatePath(`/incorporadoras/${id}`);
  return { id, erro: null };
}

// --------------------------------------------------------------- acesso

export async function atualizarAcesso(id: string, bruto: unknown): Promise<Resultado> {
  const sessao = await getSessao();
  if (!ehAdmin(sessao)) {
    return { id: null, erro: "Só o admin da Trilha pode alterar o acesso." };
  }

  const parsed = acessoSchema.safeParse(bruto);
  if (!parsed.success) {
    return { id: null, erro: "Confira os campos destacados e tente de novo." };
  }

  const { email, senha } = parsed.data;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return {
      id: null,
      erro: "A chave de administrador do Supabase não está configurada no .env.local.",
    };
  }

  const { data: incorporadora } = await admin
    .from("incorporadora")
    .select("conta_id")
    .eq("id", id)
    .maybeSingle<{ conta_id: string | null }>();

  if (!incorporadora?.conta_id) {
    return { id: null, erro: "Esta incorporadora ainda não tem acesso criado." };
  }

  const alteracoes: { email: string; password?: string } = { email };
  if (senha) alteracoes.password = senha;

  const { error: erroAuth } = await admin.auth.admin.updateUserById(
    incorporadora.conta_id,
    alteracoes,
  );

  if (erroAuth) {
    const jaExiste = erroAuth.message?.toLowerCase().includes("already");
    return {
      id: null,
      erro: jaExiste
        ? "Esse e-mail já está em uso por outro acesso."
        : detalhar("Não foi possível alterar o acesso.", erroAuth),
    };
  }

  const { error: erroConta } = await admin
    .from("conta")
    .update({ email })
    .eq("id", incorporadora.conta_id);

  if (erroConta) {
    return {
      id: null,
      erro: detalhar("O acesso mudou, mas a ficha não foi atualizada.", erroConta),
    };
  }

  revalidatePath(`/incorporadoras/${id}`);
  return { id, erro: null };
}

/**
 * A própria incorporadora editando os dados dela.
 *
 * Não recebe id: usa o da sessão. Assim não existe caminho pelo qual uma
 * incorporadora consiga apontar para a ficha de outra — e a policy
 * `incorporadora_atualiza_propria` barra no banco de qualquer forma.
 */
export async function atualizarPerfil(bruto: unknown): Promise<Resultado> {
  const sessao = await getSessao();

  if (!sessao?.incorporadoraId) {
    return { id: null, erro: "Esta conta não está ligada a nenhuma incorporadora." };
  }

  const parsed = incorporadoraEdicaoSchema.safeParse(bruto);
  if (!parsed.success) {
    return { id: null, erro: "Confira os campos destacados e tente de novo." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("incorporadora")
    .update(montarCamposCadastrais(parsed.data))
    .eq("id", sessao.incorporadoraId);

  if (error) {
    const cnpjRepetido = error.code === "23505";
    return {
      id: null,
      erro: cnpjRepetido
        ? "Já existe outra incorporadora cadastrada com esse CNPJ."
        : detalhar("Não foi possível salvar as alterações.", error),
    };
  }

  // A troca de chave (se houve) já está no histórico, pelo gatilho do banco;
  // o WhatsApp ao dono sai depois da resposta.
  after(() => avisarTrocasEDespachar(createAdminClient()));
  revalidatePath("/perfil");
  return { id: sessao.incorporadoraId, erro: null };
}

// --------------------------------------------------- ativar / desativar

/**
 * Liga ou desliga um vendedor — incorporadora ou proprietário pessoa física.
 *
 * Uma chave, dois efeitos, e os dois moram no banco:
 *
 * - **o login para.** `minha_incorporadora_id()` exige `ativo`, e é ela que
 *   recorta todas as policies do vendedor. Não existe tela esquecida.
 * - **o estoque sai do ar.** A leitura pública (`lib/simulador.ts`) filtra
 *   vendedor inativo, no simulador, no `/condicoes` e no envio da proposta.
 *
 * O que NÃO acontece, por decisão: os corretores dela continuam ativos, cada
 * um com o próprio `parceiro.ativo`. E nada é apagado — as trilhas em
 * andamento, as propostas e o histórico seguem intactos, porque desativar é
 * sobre acesso e vitrine, não sobre o passado.
 *
 * Escreve pela chave de servidor: `incorporadora` tem policy de escrita só
 * para o admin, e desativar um vendedor é ato de admin por definição — quem
 * está sendo desligado não pode se desligar nem se religar.
 */
export async function definirAtivoVendedor(id: string, ativo: boolean): Promise<Resultado> {
  const sessao = await getSessao();
  if (!sessao?.conta) return { id: null, erro: "Sessão expirada. Entre de novo." };
  if (!ehAdmin(sessao)) {
    return { id: null, erro: "Só um administrador da Trilha pode ativar ou desativar vendedores." };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return {
      id: null,
      erro: "A chave de administrador do Supabase não está configurada no .env.local.",
    };
  }

  const { data, error } = await admin
    .from("incorporadora")
    .update({ ativo })
    .eq("id", id)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || !data) {
    return {
      id: null,
      erro: detalhar(
        ativo ? "Não foi possível reativar o vendedor." : "Não foi possível desativar o vendedor.",
        error,
      ),
    };
  }

  revalidatePath("/vendedores");
  revalidatePath(`/incorporadoras/${id}`);
  revalidatePath(`/proprietarios/${id}`);
  revalidatePath("/empreendimentos");
  return { id, erro: null };
}
