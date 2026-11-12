import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type ContaTipo = "trilha_admin" | "incorporadora" | "parceiro";

export type Conta = {
  id: string;
  tipo: ContaTipo;
  nome: string;
  email: string | null;
  /**
   * Acesso ligado. Por enquanto só o admin da Trilha pode ser desligado — a
   * conferência de verdade está em `eh_admin_trilha()`, no banco; aqui é o
   * espelho, para o app não mostrar um painel que o banco vai recusar.
   */
  ativo: boolean;
};

export type Sessao = {
  conta: Conta | null;
  email: string;
  usuarioId: string;
  /** Preenchido apenas quando a conta é de uma incorporadora. */
  incorporadoraId: string | null;
  /** Corretor sem incorporadora: vende qualquer unidade. */
  parceiroTrilha: boolean;
  /** Conta de vendedor pessoa física (mora na tabela `incorporadora`, tipo PF). */
  proprietarioPF: boolean;
  /**
   * Vendedor com o cadastro desativado. O banco já o cega sozinho
   * (`minha_incorporadora_id()` devolve null), e isto é o espelho no app: sem
   * ele, a pessoa entraria num painel que responde vazio em tudo, em vez de
   * ler que o acesso foi desligado.
   */
  vendedorDesativado: boolean;
  /**
   * Motivo de a ficha não ter sido lida, quando o banco recusou a consulta.
   * `null` com `conta` também nulo significa que a linha realmente não existe.
   */
  erroLeitura: string | null;
  /**
   * Identidade que o banco enxergou nesta requisição. Se vier null enquanto
   * há usuário logado, o app está falando com o banco como anônimo.
   */
  uidNoBanco: string | null;
  /** O que o token de sessão carrega, para diagnóstico. */
  token: { presente: boolean; role: string | null; sub: string | null };
};

/** Lê as informações do token sem validar assinatura — só para diagnóstico. */
function lerToken(accessToken?: string | null) {
  if (!accessToken) return { presente: false, role: null, sub: null };
  try {
    const corpo = accessToken.split(".")[1];
    const json = JSON.parse(Buffer.from(corpo, "base64").toString("utf8"));
    return { presente: true, role: json.role ?? null, sub: json.sub ?? null };
  } catch {
    return { presente: true, role: "ilegível", sub: null };
  }
}

/**
 * Quem está logado e o que essa pessoa pode ver.
 * Retorna null se não houver sessão — o proxy já redireciona nesse caso.
 */
export async function getSessao(): Promise<Sessao | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: conta, error } = await supabase
    .from("conta")
    .select("id, tipo, nome, email, ativo")
    .eq("id", user.id)
    .maybeSingle<Conta>();

  let incorporadoraId: string | null = null;
  let proprietarioPF = false;
  let vendedorDesativado = false;

  if (conta?.tipo === "incorporadora") {
    // Pela CHAVE DE SERVIDOR, e não pela sessão: a policy que deixaria ela ler
    // a própria ficha passa por `minha_incorporadora_id()`, que devolve null
    // justamente quando o cadastro está desativado. Lendo pela sessão, a linha
    // sumiria — e o app não saberia distinguir "desativada" de "não existe".
    const { data } = await createAdminClient()
      .from("incorporadora")
      .select("id, tipo, ativo")
      .eq("conta_id", user.id)
      .maybeSingle<{ id: string; tipo: string; ativo: boolean }>();
    incorporadoraId = data?.id ?? null;
    proprietarioPF = data?.tipo === "proprietario_pf";
    vendedorDesativado = Boolean(data) && !data!.ativo;
  }

  // Parceiro sem incorporadora = Parceiro Trilha. Muda o menu e as regras de
  // envio de proposta, então vale uma leitura a mais só para corretores.
  let parceiroTrilha = false;
  if (conta?.tipo === "parceiro") {
    const { data } = await supabase
      .from("parceiro")
      .select("incorporadora_id")
      .eq("conta_id", user.id)
      .maybeSingle<{ incorporadora_id: string | null }>();
    parceiroTrilha = Boolean(data) && data!.incorporadora_id === null;
  }

  // Sondas de diagnóstico, só quando a ficha não veio.
  let uidNoBanco: string | null = null;
  let token = { presente: false, role: null as string | null, sub: null as string | null };

  if (!conta) {
    const { data } = await supabase.rpc("quem_sou_eu");
    uidNoBanco = (data as string | null) ?? null;

    const {
      data: { session },
    } = await supabase.auth.getSession();
    token = lerToken(session?.access_token);
  }

  return {
    conta: conta ?? null,
    email: user.email ?? "",
    usuarioId: user.id,
    incorporadoraId,
    parceiroTrilha,
    proprietarioPF,
    vendedorDesativado,
    erroLeitura: error ? `${error.code ?? "sem código"} · ${error.message}` : null,
    uidNoBanco,
    token,
  };
}

/**
 * Admin da Trilha COM acesso ligado.
 *
 * O `ativo` entra aqui porque o desligamento tem de valer nas duas camadas: no
 * banco ele já vale sozinho (`eh_admin_trilha()` o exige, e com isso todas as
 * policies de uma vez), e esta função é o que impede o app de abrir uma tela
 * que o banco responderia vazia. Quem está desativado não é tratado como
 * parceiro nem como incorporadora: o layout do painel o manda para
 * `/acesso-desativado`.
 */
export const ehAdmin = (sessao: Sessao | null) =>
  sessao?.conta?.tipo === "trilha_admin" && sessao.conta.ativo;

/**
 * Conta que existe mas está com o acesso desligado.
 *
 * Dois interruptores diferentes, um resultado só: `conta.ativo` desliga
 * administrador da Trilha, `incorporadora.ativo` desliga vendedor. São
 * tabelas separadas porque desligam coisas separadas — um login e um
 * cadastro —, mas para quem tenta entrar a resposta é a mesma tela.
 *
 * O corretor fica de fora de propósito: `parceiro.ativo` já existia antes
 * desta tela e desativar corretor sempre significou "ele entra e não vê
 * estoque", não "ele não entra". Mudar isso é decisão de produto, não limpeza
 * de código.
 */
export const contaDesativada = (sessao: Sessao | null) =>
  Boolean(sessao?.conta) && (!sessao!.conta!.ativo || sessao!.vendedorDesativado);

export const ehParceiro = (sessao: Sessao | null) => sessao?.conta?.tipo === "parceiro";

export const ehProprietarioPF = (sessao: Sessao | null) =>
  sessao?.conta?.tipo === "incorporadora" && Boolean(sessao?.proprietarioPF);

export const ehParceiroTrilha = (sessao: Sessao | null) =>
  ehParceiro(sessao) && Boolean(sessao?.parceiroTrilha);

/**
 * Quem pode escrever no sistema. O parceiro imobiliário é somente-leitura em
 * todo lugar — no banco não existe nenhuma policy de escrita para ele, e esta
 * função é o espelho disso na aplicação: serve para esconder botões e barrar
 * rotas de formulário, para ele não chegar numa tela que só falharia no fim.
 */
export const podeEditar = (sessao: Sessao | null) =>
  ehAdmin(sessao) || sessao?.conta?.tipo === "incorporadora";

