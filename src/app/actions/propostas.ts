"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getSessao } from "@/lib/sessao";
import { simular } from "@/lib/simulador";
import { propostaLogadaSchema, propostaSchema } from "@/lib/schemas";
import { linkDeConvite, novoConvite } from "@/lib/convite";
import { after } from "next/server";
import { enviarWhatsApp, textoConviteParceiro, textoPropostaRecebida } from "@/lib/notificacoes";
import { criarAviso, despachar, enfileirar } from "@/lib/avisos";
import { linkDoSite } from "@/lib/site";

/**
 * O envio da proposta.
 *
 * Este arquivo é o par de `lib/simulador.ts`: lá mora a única LEITURA pública,
 * aqui mora a única ESCRITA pública. Os dois usam a chave de administrador
 * pelo mesmo motivo — quem está do outro lado não tem identidade nenhuma no
 * banco. É `anon`, e `anon` não pode nada.
 *
 * Isso quer dizer que, só aqui, a permissão NÃO vive no banco. Então a regra
 * fica escrita em um lugar só, e a forma da escrita é fixa: nenhum parâmetro
 * desta função escolhe tabela, coluna ou filtro.
 *
 * O QUE NÃO VEM DO CLIENTE: os números. O formulário manda apenas a ORDEM da
 * condição escolhida; o valor do imóvel, a parcela, o ato e o saldo são
 * recalculados aqui, no servidor, e é essa versão que fica gravada. Se o preço
 * mudou entre a simulação e o envio, vale o preço de agora.
 */

export type ResultadoProposta =
  | { ok: true; codigo: string }
  | { ok: false; erro: string; precisaLogin?: boolean };

type Corretor = {
  nome: string;
  documento?: string;
  creci?: string;
  email: string;
  telefone: string;
};

type Comprador = { nome: string; cpf: string; email: string; telefone: string };

type ParceiroExistente = { id: string; incorporadora_id: string | null; conta_id: string | null };

type Entrada = {
  empreendimentoId: string;
  imovelId: string;
  ordem: number;
  corretor?: Corretor;
  /**
   * Só para quem não está logado: o corretor diz se é da incorporadora da
   * unidade ou Parceiro Trilha (independente). Quem está logado já tem isso
   * no cadastro.
   */
  vinculo?: "incorporadora" | "trilha";
  comprador: Comprador;
  observacao?: string;
};

const digitos = (v: string | undefined | null) => (v ?? "").replace(/\D/g, "");
const normalizarEmail = (v: string) => v.trim().toLowerCase();

/**
 * Uma proposta aberta por CPF (decisão de 27/out). A mesma frase está no
 * gatilho `proposta_trava_cpf` do banco. Não diz qual corretor nem qual
 * unidade: quem digita um CPF não precisa saber de quem é a outra proposta.
 */
const AVISO_PROPOSTA_ABERTA =
  "Já existe uma proposta em análise para este CPF. Aguarde a resposta da Trilha ou fale com a equipe.";

/** Situações em que a proposta ainda prende o CPF. Recusada, invalidada e cancelada liberam. */
const STATUS_ABERTOS = ["enviada", "em_analise", "aceita"] as const;

export async function enviarProposta(entrada: Entrada): Promise<ResultadoProposta> {
  // ------------------------------------------------------------ quem envia
  // "Público" quer dizer que não EXIGE sessão, não que ignore a que existe.
  // Se o corretor entrou pelo atalho do painel, os cookies vieram junto.
  const sessao = await getSessao();
  let parceiroId: string | null = null;
  // `undefined` = não logado; `null` = Parceiro Trilha; texto = incorporadora dele.
  let incorporadoraDoLogado: string | null | undefined = undefined;

  if (sessao?.conta?.tipo === "parceiro") {
    const supabase = await createClient();
    const { data } = await supabase
      .from("parceiro")
      .select("id, incorporadora_id")
      .eq("conta_id", sessao.usuarioId)
      .maybeSingle<{ id: string; incorporadora_id: string | null }>();
    parceiroId = data?.id ?? null;
    if (data) incorporadoraDoLogado = data.incorporadora_id;
  }

  // ---------------------------------------------------------- o formulário
  let corretor: Corretor | null = null;
  let comprador: Comprador;
  let observacao: string | undefined;

  if (parceiroId) {
    const r = propostaLogadaSchema.safeParse({
      comprador: entrada.comprador,
      observacao: entrada.observacao,
    });
    if (!r.success) return { ok: false, erro: primeiroErro(r.error.issues) };
    comprador = r.data.comprador;
    observacao = r.data.observacao;
  } else {
    const r = propostaSchema.safeParse({
      corretor: entrada.corretor,
      comprador: entrada.comprador,
      observacao: entrada.observacao,
    });
    if (!r.success) return { ok: false, erro: primeiroErro(r.error.issues) };
    corretor = r.data.corretor;
    comprador = r.data.comprador;
    observacao = r.data.observacao;

    if (entrada.vinculo !== "incorporadora" && entrada.vinculo !== "trilha") {
      return { ok: false, erro: "Diga qual é o seu vínculo: corretor da incorporadora ou Parceiro Trilha." };
    }
  }

  // ------------------------------------------------------------- a unidade
  // Refazer a simulação aqui não é redundância: é o que garante que a unidade
  // ainda está à venda e que os números são os de agora.
  const simulacao = await simular(entrada.empreendimentoId, entrada.imovelId);
  if (!simulacao) {
    return {
      ok: false,
      erro: "Esta unidade não está mais disponível. Volte ao simulador e escolha outra.",
    };
  }

  const condicao = simulacao.condicoes.find((c) => c.ordem === entrada.ordem);
  if (!condicao) {
    return {
      ok: false,
      erro: "Esta condição de pagamento não vale mais para esta unidade. Refaça a simulação.",
    };
  }

  // Corretor de incorporadora vende o estoque DELA. Quem trabalha com mais de
  // uma é cadastrado como Parceiro Trilha, que vende qualquer unidade.
  if (typeof incorporadoraDoLogado === "string" && incorporadoraDoLogado !== simulacao.incorporadoraId) {
    return {
      ok: false,
      erro: "Seu cadastro é de parceiro de outra incorporadora. Para vender esta unidade, fale com a Trilha sobre ser Parceiro Trilha.",
    };
  }

  const admin = createAdminClient();

  // ------------------------------------------- uma proposta aberta por CPF
  // Antes de cadastrar corretor e mandar convite: proposta que não vai entrar
  // não pode deixar cadastro nem WhatsApp para trás. A garantia de verdade é o
  // gatilho do banco; isto aqui é a mensagem chegar cedo.
  const aberta = await cpfComPropostaAberta(admin, comprador.cpf);
  if (aberta === "erro") {
    return { ok: false, erro: "Não consegui conferir o CPF do comprador. Tente de novo em instantes." };
  }
  if (aberta) return { ok: false, erro: AVISO_PROPOSTA_ABERTA };

  // ------------------------------------------------------------- o corretor
  // `convite` só vem preenchido quando o cadastro nasceu agora: é o link de
  // primeiro acesso, disparado depois que a proposta estiver gravada.
  let convite: Convite | null = null;

  if (!parceiroId && corretor) {
    const resolvido = await resolverParceiro(
      admin,
      corretor,
      entrada.vinculo === "trilha" ? null : simulacao.incorporadoraId,
    );
    if ("erro" in resolvido) return resolvido;
    parceiroId = resolvido.id;
    convite = resolvido.convite ?? null;
  }

  if (!parceiroId) {
    return { ok: false, erro: "Não consegui identificar quem está enviando a proposta." };
  }

  // ------------------------------------------------------------ o comprador
  const compradorId = await acharOuCriarComprador(admin, comprador);
  if (!compradorId) {
    return { ok: false, erro: "Não consegui registrar os dados do comprador. Tente de novo." };
  }

  // ------------------------------------ de qual opção saiu a condição
  // Só para rastrear. Se a opção for editada ou apagada depois, a proposta
  // continua íntegra: os números dela estão congelados nas colunas.
  const consultaOpcao = admin
    .from("opcao_pagamento")
    .select("id")
    .eq("incorporadora_id", simulacao.incorporadoraId)
    .eq("ordem", entrada.ordem);

  const { data: opcao } =
    simulacao.escopo === "empreendimento"
      ? await consultaOpcao
          .eq("empreendimento_id", simulacao.empreendimentoId)
          .maybeSingle<{ id: string }>()
      : await consultaOpcao.is("empreendimento_id", null).maybeSingle<{ id: string }>();

  // -------------------------------------------------------------- gravar
  const { data, error } = await admin
    .from("proposta")
    .insert({
      imovel_id: entrada.imovelId,
      empreendimento_id: simulacao.empreendimentoId,
      incorporadora_id: simulacao.incorporadoraId,
      parceiro_id: parceiroId,
      comprador_id: compradorId,

      valor_imovel: simulacao.valorImovel,
      escopo: simulacao.escopo,
      opcao_pagamento_id: opcao?.id ?? null,

      prazo_meses: condicao.prazoMeses,
      percentual_ato: condicao.percentualAto,
      percentual_entrada: condicao.percentualEntrada,
      percentual_comissao: condicao.percentualComissao,

      valor_base: condicao.base,
      valor_ato: condicao.ato,
      valor_parcela: condicao.parcela,
      valor_entrada: condicao.entrada,
      valor_saldo: condicao.saldoFinanciar,

      condicao,
      observacao: observacao || null,
    })
    .select("id, codigo")
    .maybeSingle<{ id: string; codigo: string }>();

  if (error || !data) {
    console.error("[proposta] falha ao gravar a proposta:", error);
    return {
      ok: false,
      erro:
        error?.code === "TRL01"
          ? AVISO_PROPOSTA_ABERTA
          : error?.code === "23505"
            ? "Esta unidade acabou de ser negociada. Volte ao simulador e escolha outra."
            : "Não consegui registrar a proposta. Tente de novo em instantes.",
    };
  }

  // ------------------------------------------------------ o primeiro acesso
  // Depois de gravar, e nunca antes: se o envio falhar, a proposta já está
  // salva e a Trilha reenvia o convite pela ficha do parceiro. O contrário —
  // mandar o link e a proposta não entrar — deixaria o corretor com acesso a
  // um negócio que não existe.
  if (convite) {
    const link = await linkDeConvite(convite.token);

    const envio = await enviarWhatsApp(
      convite.telefone,
      textoConviteParceiro({
        nome: convite.nome,
        link,
        proposta: {
          codigo: data.codigo,
          unidade: simulacao.unidade.identificacao,
          empreendimento: simulacao.empreendimento,
        },
      }),
    );

    if (!envio.ok) {
      console.error("[proposta] convite não saiu:", envio.erro);
      await criarAviso(admin, {
        chave: `convite-falhou:${data.id}`,
        tipo: "mensagem_falhou",
        gravidade: "problema",
        titulo: `Convite de acesso não saiu: ${convite.nome} (proposta ${data.codigo})`,
        texto: `${envio.erro}\nReenvie o convite pela ficha do parceiro.`,
        link: `/parceiros/${parceiroId}`,
      });
    }

    await admin
      .from("parceiro")
      .update({
        convite_enviado_em: envio.ok ? new Date().toISOString() : null,
        convite_canal: envio.ok ? "whatsapp" : null,
      })
      .eq("id", parceiroId);
  }

  await avisarDaProposta(admin, {
    propostaId: data.id,
    codigo: data.codigo,
    parceiroId,
    jaConvidado: Boolean(convite),
    unidade: simulacao.unidade.identificacao,
    empreendimento: simulacao.empreendimento,
  });

  return { ok: true, codigo: data.codigo };
}

/**
 * Proposta gravada: o sino da Trilha e a confirmação para o corretor.
 *
 * O corretor NOVO não recebe a confirmação: o convite de acesso que acabou de
 * sair já começa com "recebemos a sua proposta". Os outros recebem pela fila,
 * depois da resposta — quem enviou não fica esperando a uazapi.
 *
 * Nada aqui derruba o envio: a proposta já está salva.
 */
async function avisarDaProposta(
  admin: Admin,
  p: {
    propostaId: string;
    codigo: string;
    parceiroId: string;
    jaConvidado: boolean;
    unidade: string;
    empreendimento: string;
  },
) {
  try {
    const { data: corretor } = await admin
      .from("parceiro")
      .select("nome, telefone")
      .eq("id", p.parceiroId)
      .maybeSingle<{ nome: string; telefone: string | null }>();

    await criarAviso(admin, {
      chave: `proposta-nova:${p.propostaId}`,
      tipo: "proposta_nova",
      titulo: `Nova proposta ${p.codigo}`,
      texto: `${p.unidade} · ${p.empreendimento}${corretor ? ` — corretor ${corretor.nome}` : ""}`,
      link: `/propostas/${p.propostaId}`,
    });

    if (p.jaConvidado || !corretor?.telefone) return;

    const ids = await enfileirar(admin, [
      {
        chave: `proposta-recebida:${p.propostaId}:corretor`,
        destino: corretor.telefone,
        destinatario: `${corretor.nome} (corretor)`,
        papel: "corretor",
        assunto: "Proposta recebida",
        propostaId: p.propostaId,
        texto: textoPropostaRecebida({
          nome: corretor.nome,
          codigo: p.codigo,
          unidade: p.unidade,
          empreendimento: p.empreendimento,
          link: await linkDoSite(`/propostas/${p.propostaId}`),
        }),
      },
    ]);
    if (ids.length) after(() => despachar(admin, ids));
  } catch (e) {
    console.error("[proposta] falha ao avisar do envio:", e);
  }
}

// ---------------------------------------------------------------------------

type Admin = ReturnType<typeof createAdminClient>;

type Convite = { token: string; telefone: string; nome: string };

const primeiroErro = (issues: { message: string }[]) =>
  issues[0]?.message ?? "Confira os dados informados.";

/**
 * O corretor que ainda não está logado.
 *
 * Três casos, e a diferença entre eles é ter ou não ter porta de entrada:
 *
 *   não existe        → nasce parceiro PENDENTE, sem login. A proposta passa.
 *   existe COM login  → barra. Ele tem conta; que entre por ela.
 *   existe SEM login  → é um pendente de uma proposta anterior. A proposta
 *                       passa e se pendura no cadastro que já existe. Mandá-lo
 *                       fazer login seria um beco sem saída: ele não tem senha
 *                       e não tem como criar uma.
 *
 * A conta é global, o cadastro é por incorporadora — por isso a busca por
 * login não filtra incorporadora, e o reaproveitamento do pendente filtra.
 */
async function resolverParceiro(
  admin: Admin,
  corretor: Corretor,
  /** Nulo = Parceiro Trilha. */
  incorporadoraId: string | null,
): Promise<
  { id: string; convite?: Convite } | { ok: false; erro: string; precisaLogin: boolean }
> {
  const email = normalizarEmail(corretor.email);
  const documento = digitos(corretor.documento);

  // Duas buscas, e não uma: o corretor pode já estar cadastrado com OUTRO
  // e-mail e o mesmo CPF. Procurar só pelo e-mail deixava passar até o insert,
  // que então batia no índice `parceiro_documento_unico` e falhava sem
  // explicação. Identidade aqui é e-mail OU documento.
  const campos = "id, incorporadora_id, conta_id";

  const [porEmail, porDocumento] = await Promise.all([
    admin
      .from("parceiro")
      .select(campos)
      .ilike("email", email)
      .returns<ParceiroExistente[]>(),
    documento
      ? admin
          .from("parceiro")
          .select(campos)
          .eq("documento", documento)
          .returns<ParceiroExistente[]>()
      : Promise.resolve({ data: [] as ParceiroExistente[] }),
  ]);

  const porId = new Map<string, ParceiroExistente>();
  for (const p of [...(porEmail.data ?? []), ...(porDocumento.data ?? [])]) porId.set(p.id, p);
  const existentes = [...porId.values()];

  const comLogin = existentes.find((p) => p.conta_id);
  if (comLogin) {
    return {
      ok: false,
      precisaLogin: true,
      erro: "Este e-mail já está cadastrado na nossa base. Entre na sua conta antes de enviar a proposta, ou fale com a equipe da Trilha.",
    };
  }

  const pendente = existentes.find((p) => p.incorporadora_id === incorporadoraId);
  if (pendente) return { id: pendente.id };

  // O cadastro nasce ATIVO, e o login nasce quando ele usar o convite.
  //
  // Antes o parceiro nascia desligado, esperando a Trilha aprovar. O argumento
  // era que conta automática abriria o estoque — mas o simulador já é público
  // e mostra o estoque inteiro sem login nenhum, então a trava não protegia
  // nada e só criava atrito no momento em que o corretor está mais engajado.
  //
  // O que segue valendo é não mandar senha para contato que ninguém verificou.
  // Por isso aqui nasce só o CADASTRO e um token de convite: quem usa o link
  // prova que aquele WhatsApp é dele, e só aí o login existe.
  const { token, expiraEm } = novoConvite();

  const { data: criado, error } = await admin
    .from("parceiro")
    .insert({
      incorporadora_id: incorporadoraId,
      nome: corretor.nome,
      documento: documento || null,
      creci: corretor.creci || null,
      email,
      telefone: digitos(corretor.telefone),
      ativo: true,
      origem: "proposta",
      convite_token: token,
      convite_expira_em: expiraEm,
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || !criado) {
    // O motivo real vai para o terminal do servidor. A tela recebe uma frase
    // que quem está do outro lado consegue usar — e, quando o problema é de
    // instalação, uma que diz exatamente o que fazer.
    console.error("[proposta] falha ao criar parceiro:", error);
    return { ok: false, precisaLogin: false, erro: traduzirFalhaDeCadastro(error) };
  }

  return {
    id: criado.id,
    convite: { token, telefone: corretor.telefone, nome: corretor.nome },
  };
}

/**
 * As três formas de isto dar errado, na ordem em que aparecem na vida real.
 *
 * `PGRST204` e `42703` são a mesma coisa vista de dois lugares: a coluna não
 * existe. Acontece quando o SQL do ciclo ainda não foi rodado — e é um erro de
 * instalação, não do que a pessoa digitou. Dizer "confira o e-mail" nesse caso
 * manda ela procurar defeito onde não tem.
 */
function traduzirFalhaDeCadastro(error: { code?: string; message?: string } | null): string {
  if (!error) return "Não consegui registrar os seus dados. Tente de novo em instantes.";

  if (error.code === "PGRST204" || error.code === "42703") {
    return "O sistema está em atualização e ainda não consegue registrar novos corretores. Fale com a equipe da Trilha.";
  }

  if (error.code === "23505") {
    return "Já existe um cadastro com este CPF/CNPJ nesta incorporadora. Entre na sua conta ou fale com a equipe da Trilha.";
  }

  return "Não consegui registrar os seus dados. Confira o e-mail e o CPF informados e tente de novo.";
}

/**
 * O comprador é uma pessoa só, identificada pelo CPF. Propor duas unidades não
 * cria duas fichas.
 *
 * Comprador que JÁ EXISTE não é alterado aqui (decisão de 27/out). Esta é a
 * rota pública: se ela atualizasse o contato, qualquer um que digitasse um CPF
 * conhecido trocaria o telefone para onde vão o link de acompanhamento e a
 * minuta. Corrigir contato de comprador existente é coisa da Trilha, no painel
 * (a negociação pela Trilha atualiza).
 */
async function acharOuCriarComprador(admin: Admin, comprador: Comprador): Promise<string | null> {
  const cpf = digitos(comprador.cpf);

  const existente = await buscarComprador(admin, cpf);
  if (existente === "erro") return null;
  if (existente) return existente;

  const { data, error } = await admin
    .from("comprador")
    .insert({
      nome: comprador.nome.trim(),
      cpf,
      email: normalizarEmail(comprador.email),
      telefone: digitos(comprador.telefone),
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  // Dois envios com o mesmo CPF novo ao mesmo tempo: o outro criou primeiro.
  // Usa o dele, sem sobrescrever nada.
  if (error?.code === "23505") {
    const criadoPeloOutro = await buscarComprador(admin, cpf);
    return criadoPeloOutro === "erro" ? null : criadoPeloOutro;
  }
  if (error) console.error("[proposta] falha ao registrar comprador:", error);

  return data?.id ?? null;
}

async function buscarComprador(admin: Admin, cpf: string): Promise<string | null | "erro"> {
  const { data, error } = await admin
    .from("comprador")
    .select("id")
    .eq("cpf", cpf)
    .maybeSingle<{ id: string }>();
  if (error) {
    console.error("[proposta] falha ao procurar comprador:", error);
    return "erro";
  }
  return data?.id ?? null;
}

/**
 * O CPF tem proposta enviada, em análise ou aceita? Lê a tabela direto (e não
 * a função do banco) para funcionar mesmo antes de o SQL novo ser aplicado.
 */
async function cpfComPropostaAberta(admin: Admin, cpfDigitado: string): Promise<boolean | "erro"> {
  const compradorId = await buscarComprador(admin, digitos(cpfDigitado));
  if (compradorId === "erro") return "erro";
  if (!compradorId) return false;

  const { data, error } = await admin
    .from("proposta")
    .select("id")
    .eq("comprador_id", compradorId)
    .in("status", [...STATUS_ABERTOS])
    .limit(1);
  if (error) {
    console.error("[proposta] falha ao conferir proposta aberta:", error);
    return "erro";
  }
  return (data?.length ?? 0) > 0;
}
