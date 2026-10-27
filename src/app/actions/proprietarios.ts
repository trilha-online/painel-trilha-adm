"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { avisarTrocasEDespachar } from "@/lib/chave-pix";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  localAvulsoSchema,
  proprietarioEdicaoSchema,
  proprietarioSchema,
} from "@/lib/schemas";
import { stripMask } from "@/lib/br";
import { ehAdmin, ehProprietarioPF, getSessao } from "@/lib/sessao";

/**
 * Proprietário PF: o vendedor pessoa física de um imóvel avulso.
 *
 * No banco ele é uma linha de `incorporadora` com `tipo = 'proprietario_pf'`,
 * sem CNPJ e com os dados pessoais em `resp_*`. As colunas "da empresa"
 * (nome, e-mail, telefone, endereço) repetem os dados dele — é o que as telas
 * e os avisos que já existem leem, e assim funcionam sem saber do tipo.
 */

export type Resultado = { id: string; erro: null } | { id: null; erro: string };

const vazioVira = (v: string | undefined) => (v === "" || v === undefined ? null : v);

const detalhar = (mensagem: string, erro: { code?: string; message?: string } | null) =>
  erro?.message ? `${mensagem} (${erro.code ?? "sem código"}: ${erro.message})` : mensagem;

type Dados = {
  pessoa: {
    nome: string;
    cpf: string;
    email: string;
    telefone: string;
    rg?: string;
    endereco?: string;
    profissao?: string;
    estado_civil?: string;
  };
  banco: {
    banco?: string;
    agencia?: string;
    conta_numero?: string;
    chave_pix?: string;
    chave_pix_tipo?: string;
  };
};

function montarCampos(d: Dados) {
  const telefone = stripMask(d.pessoa.telefone);
  const endereco = vazioVira(d.pessoa.endereco);
  return {
    tipo: "proprietario_pf",
    nome: d.pessoa.nome,
    cnpj: null,
    email: d.pessoa.email,
    telefone,
    // O endereço pessoal fica só em `resp_endereco` (coluna protegida).
    endereco: null,

    resp_nome: d.pessoa.nome,
    resp_cpf: stripMask(d.pessoa.cpf),
    resp_rg: vazioVira(d.pessoa.rg),
    resp_profissao: vazioVira(d.pessoa.profissao),
    resp_estado_civil: vazioVira(d.pessoa.estado_civil),
    resp_email: d.pessoa.email,
    resp_telefone: telefone,
    resp_endereco: endereco,

    banco: vazioVira(d.banco.banco),
    agencia: vazioVira(d.banco.agencia),
    conta_numero: vazioVira(d.banco.conta_numero),
    chave_pix: vazioVira(d.banco.chave_pix),
    chave_pix_tipo: vazioVira(d.banco.chave_pix_tipo),
  };
}

const cpfRepetido = (e: { code?: string; message?: string } | null) =>
  e?.code === "23505" && (e.message ?? "").includes("proprietario_cpf_unico");

// --------------------------------------------------------------- criar

export async function criarProprietario(bruto: unknown): Promise<Resultado> {
  const sessao = await getSessao();
  if (!ehAdmin(sessao)) return { id: null, erro: "Só a Trilha cadastra proprietários." };

  const parsed = proprietarioSchema.safeParse(bruto);
  if (!parsed.success) return { id: null, erro: "Confira os campos destacados e tente de novo." };

  const { acesso, pessoa } = parsed.data;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { id: null, erro: "A chave de administrador do Supabase não está configurada no .env.local." };
  }

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
        : detalhar("Não foi possível criar o acesso do proprietário.", erroUsuario),
    };
  }

  const contaId = novoUsuario.user.id;
  const desfazer = async () => {
    await admin.auth.admin.deleteUser(contaId);
  };

  // Mesmo tipo de conta da incorporadora: é o que faz as regras de acesso
  // ("o que é da minha incorporadora") valerem para ele sem nada novo.
  const { error: erroConta } = await admin.from("conta").insert({
    id: contaId,
    tipo: "incorporadora",
    nome: pessoa.nome,
    email: acesso.email,
    telefone: stripMask(pessoa.telefone),
  });

  if (erroConta) {
    await desfazer();
    return { id: null, erro: detalhar("Não foi possível criar a conta de acesso.", erroConta) };
  }

  const { data, error } = await admin
    .from("incorporadora")
    .insert({ conta_id: contaId, ...montarCampos(parsed.data) })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    await desfazer();
    return {
      id: null,
      erro: cpfRepetido(error)
        ? "Já existe um proprietário cadastrado com esse CPF."
        : detalhar("Não foi possível salvar o proprietário.", error),
    };
  }

  revalidatePath("/proprietarios");
  return { id: data.id, erro: null };
}

// ------------------------------------------------------------ atualizar

/** Admin editando qualquer proprietário, ou o próprio proprietário (sem id). */
export async function atualizarProprietario(id: string | null, bruto: unknown): Promise<Resultado> {
  const sessao = await getSessao();
  const admin = ehAdmin(sessao);
  const alvo = admin ? id : ehProprietarioPF(sessao) ? sessao!.incorporadoraId : null;
  if (!alvo) return { id: null, erro: "Sem permissão para editar este cadastro." };

  const parsed = proprietarioEdicaoSchema.safeParse(bruto);
  if (!parsed.success) return { id: null, erro: "Confira os campos destacados e tente de novo." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("incorporadora")
    .update(montarCampos(parsed.data))
    .eq("id", alvo)
    .eq("tipo", "proprietario_pf")
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    return {
      id: null,
      erro: cpfRepetido(error)
        ? "Já existe outro proprietário com esse CPF."
        : detalhar("Não foi possível salvar as alterações.", error),
    };
  }
  if (!data) return { id: null, erro: "Nada foi alterado: cadastro não encontrado ou sem permissão." };

  revalidatePath("/proprietarios");
  revalidatePath(`/proprietarios/${alvo}`);
  revalidatePath("/perfil");
  // A troca de chave (se houve) já está no histórico, pelo gatilho do banco;
  // o WhatsApp ao dono sai depois da resposta.
  after(() => avisarTrocasEDespachar(createAdminClient()));
  return { id: alvo, erro: null };
}

// ------------------------------------------------------ local do imóvel

/**
 * O condomínio/edifício (ou endereço, se for casa) do imóvel avulso. Se o
 * proprietário já tem um local com o mesmo nome, reaproveita: dois
 * apartamentos no mesmo prédio ficam juntos.
 */
export async function salvarLocalAvulso(
  proprietarioId: string,
  localId: string | null,
  bruto: unknown,
): Promise<Resultado> {
  const sessao = await getSessao();
  if (!ehAdmin(sessao)) return { id: null, erro: "Só a Trilha cadastra imóveis avulsos." };

  const parsed = localAvulsoSchema.safeParse(bruto);
  if (!parsed.success) return { id: null, erro: parsed.error.issues[0]?.message ?? "Confira os campos." };

  const nome = parsed.data.nome.trim();
  const endereco = vazioVira(parsed.data.endereco?.trim());
  const supabase = await createClient();

  if (localId) {
    const { data, error } = await supabase
      .from("empreendimento")
      .update({ nome, endereco })
      .eq("id", localId)
      .eq("incorporadora_id", proprietarioId)
      .select("id")
      .maybeSingle<{ id: string }>();
    if (error || !data) return { id: null, erro: detalhar("Não foi possível salvar o local.", error) };
    revalidatePath(`/proprietarios/${proprietarioId}`);
    return { id: data.id, erro: null };
  }

  const { data: existente } = await supabase
    .from("empreendimento")
    .select("id")
    .eq("incorporadora_id", proprietarioId)
    .ilike("nome", nome)
    .maybeSingle<{ id: string }>();
  if (existente) return { id: existente.id, erro: null };

  const { data, error } = await supabase
    .from("empreendimento")
    .insert({ incorporadora_id: proprietarioId, nome, endereco })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) return { id: null, erro: detalhar("Não foi possível salvar o local.", error) };

  revalidatePath(`/proprietarios/${proprietarioId}`);
  return { id: data.id, erro: null };
}
