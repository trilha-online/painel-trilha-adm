"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { avisarTrocasEDespachar } from "@/lib/chave-pix";
import { getSessao } from "@/lib/sessao";
import { conferirAndamento } from "@/lib/andamento";
import { fichaVendedorSchema, type FichaVendedorValues } from "@/lib/schemas";
import { stripMask, telefoneNacional, temConjuge } from "@/lib/br";

/**
 * Salvar os dados do vendedor PF no fechamento.
 *
 * Salvar conclui a tarefa "Dados do vendedor" (gatilho no banco). Quem pode:
 * a Trilha e o próprio proprietário, pela regra da tabela — o corretor não.
 *
 * Depois de salvar, os dados pessoais e bancários voltam para o cadastro do
 * proprietário: é o dado mais recente, e o próximo negócio já nasce com ele.
 * Os do cônjuge ficam só na ficha deste negócio.
 */

export type ResultadoFichaVendedor = { ok: true } | { ok: false; erro: string };

const limpo = (v: string) => v.trim();
const ouNulo = (v: string) => (v.trim() === "" ? null : v.trim());

export async function salvarFichaVendedor(
  negocioId: string,
  valores: FichaVendedorValues,
): Promise<ResultadoFichaVendedor> {
  const lido = fichaVendedorSchema.safeParse(valores);
  if (!lido.success) {
    return { ok: false, erro: "Há campos incompletos ou inválidos. Confira os destaques em vermelho." };
  }

  const sessao = await getSessao();
  if (!sessao) return { ok: false, erro: "Sua sessão expirou. Entre de novo." };

  const { vendedor: v, conjuge: j, banco: b } = lido.data;
  const casado = temConjuge(v.estado_civil);
  const doConjuge = (valor: string, formato: (x: string) => string | null = ouNulo) =>
    casado ? formato(valor) : null;

  const linha = {
    negocio_id: negocioId,
    nome: limpo(v.nome),
    email: limpo(v.email).toLowerCase(),
    telefone: telefoneNacional(v.telefone),
    cpf: stripMask(v.cpf),
    rg: ouNulo(v.rg),
    endereco: ouNulo(v.endereco),
    profissao: ouNulo(v.profissao),
    estado_civil: v.estado_civil,
    conjuge_nome: doConjuge(j.nome),
    conjuge_email: doConjuge(j.email, (x) => limpo(x).toLowerCase()),
    conjuge_telefone: doConjuge(j.telefone, telefoneNacional),
    conjuge_cpf: doConjuge(j.cpf, stripMask),
    conjuge_rg: doConjuge(j.rg),
    conjuge_endereco: doConjuge(j.endereco),
    conjuge_profissao: doConjuge(j.profissao),
    banco: ouNulo(b.banco),
    agencia: ouNulo(b.agencia),
    conta_numero: ouNulo(b.conta_numero),
    chave_pix: ouNulo(b.chave_pix),
    preenchida_por: sessao.usuarioId,
  };

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ficha_vendedor")
    .upsert(linha, { onConflict: "negocio_id" })
    .select("negocio_id")
    .maybeSingle<{ negocio_id: string }>();

  if (error || !data) {
    if (error?.code === "42501" || !error) {
      return { ok: false, erro: "Você não pode editar estes dados. O negócio pode ter sido cancelado." };
    }
    if (error.code === "23514") {
      return { ok: false, erro: "Casado ou em união estável: preencha nome, e-mail, telefone e CPF do cônjuge." };
    }
    if (error.code === "PGRST205" || error.code === "42P01") {
      return { ok: false, erro: "O banco ainda não tem a tabela dos dados do vendedor. Rode o proprietario-pf.sql." };
    }
    console.error("[ficha do vendedor] gravação recusada:", error);
    return { ok: false, erro: "Não consegui salvar os dados. Tente de novo em instantes." };
  }

  // De volta ao cadastro. Falhar aqui não desfaz nada: a ficha do negócio,
  // que é o que o contrato usa, já está salva.
  const { data: negocio } = await supabase
    .from("negocio")
    .select("incorporadora_id")
    .eq("id", negocioId)
    .maybeSingle<{ incorporadora_id: string }>();

  if (negocio) {
    const { error: erroCadastro } = await supabase
      .from("incorporadora")
      .update({
        nome: linha.nome,
        email: linha.email,
        telefone: linha.telefone,
        resp_nome: linha.nome,
        resp_email: linha.email,
        resp_telefone: linha.telefone,
        resp_cpf: linha.cpf,
        resp_rg: linha.rg,
        resp_endereco: linha.endereco,
        resp_profissao: linha.profissao,
        resp_estado_civil: linha.estado_civil,
        banco: linha.banco,
        agencia: linha.agencia,
        conta_numero: linha.conta_numero,
        chave_pix: linha.chave_pix,
      })
      .eq("id", negocio.incorporadora_id)
      .eq("tipo", "proprietario_pf");
    if (erroCadastro) console.error("[ficha do vendedor] cadastro não atualizado:", erroCadastro);
  }

  await conferirAndamento(negocioId);
  // A troca de chave (se houve) já está no histórico, pelo gatilho do banco;
  // o WhatsApp ao dono sai depois da resposta.
  after(() => avisarTrocasEDespachar(createAdminClient()));
  revalidatePath(`/negocios/${negocioId}`);
  return { ok: true };
}
