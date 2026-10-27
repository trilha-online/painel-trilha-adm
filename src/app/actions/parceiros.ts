"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { avisarTrocasEDespachar } from "@/lib/chave-pix";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  acessoNovoSchema,
  acessoSchema,
  parceiroEdicaoSchema,
  parceiroSchema,
} from "@/lib/schemas";
import { stripMask } from "@/lib/br";
import { ehAdmin, getSessao } from "@/lib/sessao";

export type Resultado = { id: string; erro: null } | { id: null; erro: string };

const vazioVira = <T>(v: T | "" | undefined): T | null =>
  v === "" || v === undefined ? null : v;

const detalhar = (mensagem: string, erro: { code?: string; message?: string } | null) =>
  erro?.message ? `${mensagem} (${erro.code ?? "sem código"}: ${erro.message})` : mensagem;

type Dados = {
  dados: {
    nome: string;
    documento?: string;
    creci?: string;
    email: string;
    telefone: string;
    endereco?: string;
    ativo?: boolean;
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
  return {
    nome: d.dados.nome,
    documento: d.dados.documento ? stripMask(d.dados.documento) : null,
    creci: vazioVira(d.dados.creci),
    email: d.dados.email,
    telefone: stripMask(d.dados.telefone),
    endereco: vazioVira(d.dados.endereco),
    ativo: d.dados.ativo ?? true,

    banco: vazioVira(d.banco.banco),
    agencia: vazioVira(d.banco.agencia),
    conta_numero: vazioVira(d.banco.conta_numero),
    chave_pix: vazioVira(d.banco.chave_pix),
    chave_pix_tipo: vazioVira(d.banco.chave_pix_tipo),
  };
}

/**
 * Quem pode mexer nos parceiros de uma incorporadora: o admin da Trilha, em
 * qualquer uma, e a própria incorporadora, na dela. A mesma regra vale no
 * banco — isto aqui existe para dar mensagem melhor que "permission denied".
 */
async function podeGerenciar(incorporadoraId: string | null) {
  const sessao = await getSessao();
  if (!sessao?.conta) return { ok: false as const, erro: "Sessão expirada. Entre de novo." };
  if (ehAdmin(sessao)) return { ok: true as const };
  // Parceiro Trilha (sem incorporadora) é assunto só da Trilha.
  if (incorporadoraId === null) {
    return { ok: false as const, erro: "Só a Trilha gerencia os Parceiros Trilha." };
  }
  if (sessao.incorporadoraId === incorporadoraId) return { ok: true as const };
  return { ok: false as const, erro: "Você só pode gerenciar os parceiros da sua incorporadora." };
}

// --------------------------------------------------------------- criar

/** `incorporadoraId` nulo cria um Parceiro Trilha (só o admin pode). */
export async function criarParceiro(
  incorporadoraId: string | null,
  bruto: unknown,
): Promise<Resultado> {
  const permissao = await podeGerenciar(incorporadoraId);
  if (!permissao.ok) return { id: null, erro: permissao.erro };

  const parsed = parceiroSchema.safeParse(bruto);
  if (!parsed.success) {
    return { id: null, erro: "Confira os campos destacados e tente de novo." };
  }

  const { acesso } = parsed.data;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return {
      id: null,
      erro: "A chave de administrador do Supabase não está configurada no .env.local.",
    };
  }

  // 1. O usuário que o parceiro vai usar para entrar.
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
        : detalhar("Não foi possível criar o acesso do parceiro.", erroUsuario),
    };
  }

  const contaId = novoUsuario.user.id;
  const desfazer = async () => {
    await admin.auth.admin.deleteUser(contaId);
  };

  // 2. A ficha em `conta`. Ninguém além do service_role escreve nesta tabela —
  //    não existe policy de insert para `authenticated`.
  const { error: erroConta } = await admin.from("conta").insert({
    id: contaId,
    tipo: "parceiro",
    nome: parsed.data.dados.nome,
    email: acesso.email,
    telefone: stripMask(parsed.data.dados.telefone),
  });

  if (erroConta) {
    await desfazer();
    return { id: null, erro: detalhar("Não foi possível criar a conta de acesso.", erroConta) };
  }

  // 3. O parceiro em si vai pelo cliente normal, de propósito: assim a policy
  //    do banco confere de novo se esta sessão pode criar parceiro para esta
  //    incorporadora. Se passasse pelo service_role, a única trava seria a
  //    checagem do app.
  const supabase = await createClient();
  const { data: parceiro, error: erroParceiro } = await supabase
    .from("parceiro")
    .insert({ conta_id: contaId, incorporadora_id: incorporadoraId, ...montarCampos(parsed.data) })
    .select("id")
    .single<{ id: string }>();

  if (erroParceiro || !parceiro) {
    await desfazer();
    if (erroParceiro?.code === "23505") {
      return {
        id: null,
        erro: incorporadoraId
          ? "Já existe um parceiro com esse CPF/CNPJ nesta incorporadora."
          : "Já existe um Parceiro Trilha com esse CPF/CNPJ.",
      };
    }
    if (erroParceiro?.code === "42501") {
      return { id: null, erro: "Você não tem permissão para cadastrar parceiros aqui." };
    }
    return { id: null, erro: detalhar("Não foi possível salvar o parceiro.", erroParceiro) };
  }

  if (incorporadoraId) {
    revalidatePath(`/incorporadoras/${incorporadoraId}`);
    revalidatePath(`/incorporadoras/${incorporadoraId}/parceiros`);
  }
  revalidatePath("/parceiros");
  revalidatePath("/parceiro-trilha");
  return { id: parceiro.id, erro: null };
}

// ------------------------------------------------------------ atualizar

export async function atualizarParceiro(id: string, bruto: unknown): Promise<Resultado> {
  const sessao = await getSessao();
  if (!sessao?.conta) return { id: null, erro: "Sessão expirada. Entre de novo." };

  const parsed = parceiroEdicaoSchema.safeParse(bruto);
  if (!parsed.success) {
    return { id: null, erro: "Confira os campos destacados e tente de novo." };
  }

  const supabase = await createClient();

  // `.select()` não é enfeite: um UPDATE barrado por RLS devolve "0 linhas" e
  // NÃO devolve erro. Sem conferir o retorno, a tela diria "salvo" sem ter
  // salvo nada — foi exatamente assim que a tela "Meus dados" da
  // incorporadora ficou semanas quebrada.
  const { data, error } = await supabase
    .from("parceiro")
    .update(montarCampos(parsed.data))
    .eq("id", id)
    .select("id, incorporadora_id")
    .maybeSingle<{ id: string; incorporadora_id: string | null }>();

  if (error) {
    if (error.code === "23505") {
      return { id: null, erro: "Já existe um parceiro com esse CPF/CNPJ nesta incorporadora." };
    }
    return { id: null, erro: detalhar("Não foi possível salvar as alterações.", error) };
  }

  if (!data) {
    return {
      id: null,
      erro: "Nada foi alterado: este parceiro não existe ou você não tem permissão sobre ele.",
    };
  }

  revalidatePath(`/incorporadoras/${data.incorporadora_id}/parceiros`);
  revalidatePath("/parceiros");
  revalidatePath("/parceiro-trilha");
  // A troca de chave (se houve) já está no histórico, pelo gatilho do banco;
  // o WhatsApp ao dono sai depois da resposta.
  after(() => avisarTrocasEDespachar(createAdminClient()));
  return { id: data.id, erro: null };
}

// --------------------------------------------------------------- acesso

/**
 * Criar o acesso de um parceiro que ainda não tem.
 *
 * É a aprovação do corretor que chegou por proposta: ele nasce PENDENTE
 * (`ativo = false`, `origem = 'proposta'`, sem `conta_id`) e fica esperando
 * alguém liberar. Até aqui não havia como liberar — a tela de acesso só sabia
 * TROCAR um login existente, e quem nasceu sem login ficava num beco.
 *
 * Criar o acesso e ativar o cadastro é um passo só de propósito. São a mesma
 * decisão ("este corretor pode entrar"), e separá-las só criaria o estado
 * esquisito de quem tem senha mas continua desligado.
 */
export async function criarAcessoParceiro(id: string, bruto: unknown): Promise<Resultado> {
  const sessao = await getSessao();
  if (!sessao?.conta) return { id: null, erro: "Sessão expirada. Entre de novo." };

  const parsed = acessoNovoSchema.safeParse(bruto);
  if (!parsed.success) {
    return { id: null, erro: parsed.error.issues[0]?.message ?? "Confira os campos destacados." };
  }

  const { email, senha } = parsed.data;
  if (!senha) return { id: null, erro: "Defina uma senha de ao menos 8 caracteres." };

  // Leitura pelo cliente normal: se esta sessão não enxerga o parceiro, ela
  // também não cria acesso para ele.
  const supabase = await createClient();
  const { data: parceiro } = await supabase
    .from("parceiro")
    .select("nome, telefone, conta_id, incorporadora_id")
    .eq("id", id)
    .maybeSingle<{
      nome: string;
      telefone: string;
      conta_id: string | null;
      incorporadora_id: string | null;
    }>();

  if (!parceiro) {
    return { id: null, erro: "Parceiro não encontrado, ou sem permissão para alterá-lo." };
  }
  if (parceiro.conta_id) {
    return { id: null, erro: "Este parceiro já tem acesso. Use a troca de e-mail e senha." };
  }

  const permissao = await podeGerenciar(parceiro.incorporadora_id);
  if (!permissao.ok) return { id: null, erro: permissao.erro };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return {
      id: null,
      erro: "A chave de administrador do Supabase não está configurada no .env.local.",
    };
  }

  const { data: novoUsuario, error: erroUsuario } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
  });

  if (erroUsuario || !novoUsuario?.user) {
    const jaExiste = erroUsuario?.message?.toLowerCase().includes("already");
    return {
      id: null,
      erro: jaExiste
        ? "Já existe um acesso com esse e-mail. Use outro e-mail de acesso."
        : detalhar("Não foi possível criar o acesso do parceiro.", erroUsuario),
    };
  }

  const contaId = novoUsuario.user.id;

  const { error: erroConta } = await admin.from("conta").insert({
    id: contaId,
    tipo: "parceiro",
    nome: parceiro.nome,
    email,
    telefone: parceiro.telefone,
  });

  if (erroConta) {
    await admin.auth.admin.deleteUser(contaId);
    return { id: null, erro: detalhar("Não foi possível criar a conta de acesso.", erroConta) };
  }

  // Ligar e ativar. Pelo cliente da sessão, para a policy conferir de novo —
  // a checagem do app não pode ser a única trava.
  const { data: ligado, error: erroLigar } = await supabase
    .from("parceiro")
    .update({ conta_id: contaId, ativo: true })
    .eq("id", id)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (erroLigar || !ligado) {
    // Desfaz na ordem inversa, senão sobra um login órfão que entra e não vê
    // nada — o pior estado possível.
    await admin.from("conta").delete().eq("id", contaId);
    await admin.auth.admin.deleteUser(contaId);
    return {
      id: null,
      erro: detalhar("O acesso foi criado, mas não pôde ser ligado ao parceiro.", erroLigar),
    };
  }

  revalidatePath(`/incorporadoras/${parceiro.incorporadora_id}/parceiros`);
  revalidatePath("/parceiros");
  revalidatePath("/parceiro-trilha");
  return { id, erro: null };
}

export async function atualizarAcessoParceiro(id: string, bruto: unknown): Promise<Resultado> {
  const sessao = await getSessao();
  if (!sessao?.conta) return { id: null, erro: "Sessão expirada. Entre de novo." };

  const parsed = acessoSchema.safeParse(bruto);
  if (!parsed.success) {
    return { id: null, erro: "Confira os campos destacados e tente de novo." };
  }

  const { email, senha } = parsed.data;

  // A leitura vai pelo cliente normal justamente para a policy decidir: se
  // esta sessão não enxerga o parceiro, ela também não troca o acesso dele.
  const supabase = await createClient();
  const { data: parceiro } = await supabase
    .from("parceiro")
    .select("conta_id, incorporadora_id")
    .eq("id", id)
    .maybeSingle<{ conta_id: string | null; incorporadora_id: string | null }>();

  if (!parceiro) {
    return { id: null, erro: "Parceiro não encontrado, ou sem permissão para alterá-lo." };
  }
  if (!parceiro.conta_id) {
    return { id: null, erro: "Este parceiro ainda não tem acesso criado." };
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

  const alteracoes: { email: string; password?: string } = { email };
  if (senha) alteracoes.password = senha;

  const { error: erroAuth } = await admin.auth.admin.updateUserById(
    parceiro.conta_id,
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
    .eq("id", parceiro.conta_id);

  if (erroConta) {
    return {
      id: null,
      erro: detalhar("O acesso mudou, mas a ficha não foi atualizada.", erroConta),
    };
  }

  revalidatePath(`/incorporadoras/${parceiro.incorporadora_id}/parceiros`);
  revalidatePath("/parceiros");
  revalidatePath("/parceiro-trilha");
  return { id, erro: null };
}

// -------------------------------------------------------------- remover

/**
 * Apaga o parceiro e o login dele.
 *
 * A ordem importa e não é intercambiável:
 *
 *   1. apaga a ficha pelo cliente NORMAL — é a policy que decide se esta
 *      sessão pode. Se não puder, nada acontece e paramos aqui.
 *   2. só então apaga o usuário do Auth, que é operação de service_role.
 *
 * Fazer o contrário deixaria o login destruído e a ficha viva se o passo 2
 * falhasse. Nesta ordem, o pior caso é um usuário órfão no Auth: ele consegue
 * entrar, mas `minha_incorporadora_como_parceiro()` devolve nulo e ele não
 * enxerga nada. Ruim, mas inofensivo — e o erro aparece na tela.
 *
 * Apagar o usuário leva junto a linha em `conta`, por cascata de `auth.users`.
 */
export async function removerParceiro(id: string): Promise<Resultado> {
  const sessao = await getSessao();
  if (!sessao?.conta) return { id: null, erro: "Sessão expirada. Entre de novo." };

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("parceiro")
    .delete()
    .eq("id", id)
    .select("id, nome, conta_id")
    .maybeSingle<{ id: string; nome: string; conta_id: string | null }>();

  if (error) {
    return { id: null, erro: detalhar("Não foi possível remover o parceiro.", error) };
  }

  // DELETE barrado por RLS não é erro: volta zero linha, igual ao UPDATE.
  if (!data) {
    return {
      id: null,
      erro: "Nada foi removido: este parceiro não existe ou você não tem permissão sobre ele.",
    };
  }

  if (data.conta_id) {
    try {
      const admin = createAdminClient();
      const { error: erroAuth } = await admin.auth.admin.deleteUser(data.conta_id);
      if (erroAuth) {
        return {
          id: null,
          erro: `O cadastro de ${data.nome} foi removido, mas o login dele continua existindo. Avise o time da Trilha. (${erroAuth.message})`,
        };
      }
    } catch {
      return {
        id: null,
        erro: `O cadastro de ${data.nome} foi removido, mas o login não pôde ser apagado: a chave de administrador não está configurada.`,
      };
    }
  }

  revalidatePath("/parceiros");
  revalidatePath("/parceiro-trilha");
  revalidatePath("/incorporadoras");
  return { id: data.id, erro: null };
}
