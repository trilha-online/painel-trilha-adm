/**
 * O que o sistema manda para fora.
 *
 * Hoje só WhatsApp, pela uazapi. O e-mail fica de fora de propósito: todo
 * caminho sério de envio exige conta em um provedor, e o envio nativo do
 * Supabase é limitado a poucos por hora e cai em spam — o que, para entregar
 * credencial de acesso, é pior do que não mandar. Quando houver provedor,
 * entra aqui, ao lado, com a mesma assinatura.
 *
 * TODA a forma da chamada da uazapi mora no bloco de constantes abaixo. Se o
 * endpoint, o header ou o nome de um campo mudar, o conserto é uma linha e não
 * uma caçada pelo código.
 */

// ------------------------------------------------------------ a chamada
// Confirmado com o workflow que já roda no n8n da Trilha:
//   POST https://trilha.uazapi.com/send/text
//   header: token
//   corpo:  { number, text }
const CAMINHO_TEXTO = "/send/text";
const HEADER_TOKEN = "token";
const CAMPO_NUMERO = "number";
const CAMPO_TEXTO = "text";

export type EnvioResultado = { ok: true } | { ok: false; erro: string };

/**
 * O número no formato que a uazapi espera: só dígitos, com código do país.
 *
 * O cadastro guarda telefone sem máscara e quase sempre sem o 55 — é o que o
 * corretor digita. Mandar `53991592604` para a API entrega no lugar errado ou
 * em lugar nenhum, então o 55 entra aqui, uma vez, e não em cada chamada.
 */
export function numeroWhatsApp(telefone: string): string | null {
  const digitos = telefone.replace(/\D/g, "");

  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) return digitos;

  // Número estrangeiro ou lixo: não inventa prefixo. Melhor falhar visível do
  // que mandar mensagem para um desconhecido.
  return digitos.length >= 12 ? digitos : null;
}

export async function enviarWhatsApp(telefone: string, texto: string): Promise<EnvioResultado> {
  const url = process.env.UAZAPI_URL;
  const token = process.env.UAZAPI_TOKEN;

  if (!url || !token) {
    return { ok: false, erro: "UAZAPI_URL ou UAZAPI_TOKEN não configurados." };
  }

  const numero = numeroWhatsApp(telefone);
  if (!numero) return { ok: false, erro: `Telefone inválido para WhatsApp: ${telefone}` };

  try {
    const resposta = await fetch(`${url.replace(/\/$/, "")}${CAMINHO_TEXTO}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [HEADER_TOKEN]: token,
      },
      body: JSON.stringify({ [CAMPO_NUMERO]: numero, [CAMPO_TEXTO]: texto }),
      // Sem timeout o envio pendura a resposta da proposta. 10s é generoso
      // para uma API de mensagem e curto para quem está esperando a tela.
      signal: AbortSignal.timeout(10_000),
    });

    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => "");
      return { ok: false, erro: `uazapi respondeu ${resposta.status}: ${corpo.slice(0, 200)}` };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "Falha ao falar com a uazapi." };
  }
}

// ------------------------------------------------------------ as mensagens
// Texto em um lugar só. Mensagem que o corretor recebe é a primeira impressão
// da Trilha para ele, e não deve estar espalhada dentro de uma action.

/**
 * Proposta aceita: três mensagens, uma por ator, cada uma com o link que é dela.
 *
 * O comprador recebe a página pública de acompanhamento — ele não tem login e
 * nunca vai ter. O corretor e a incorporadora recebem o link do painel, que é
 * onde eles trabalham; mandar a página do comprador para eles seria mandar a
 * versão resumida de um processo em que eles têm tarefas.
 */
export function textoAceitaComprador({
  nome,
  link,
  unidade,
  empreendimento,
  pelaTrilha = false,
}: {
  nome: string;
  link: string;
  unidade: string;
  empreendimento: string;
  /** Negócio aberto pela Trilha no painel: não houve "proposta aceita" para ele. */
  pelaTrilha?: boolean;
}): string {
  return [
    pelaTrilha
      ? `Olá, ${nome.trim().split(/\s+/)[0]}! A negociação do seu imóvel começou. 🎉`
      : `Olá, ${nome.trim().split(/\s+/)[0]}! Sua proposta foi aceita. 🎉`,
    "",
    `🏠 *${unidade}* · ${empreendimento}`,
    "",
    "Agora começa o fechamento. Acompanhe o andamento por aqui, a qualquer hora:",
    link,
    "",
    "Guarde este link — ele é seu e vale até a entrega das chaves.",
  ].join("\n");
}

export function textoAceitaCorretor({
  nome,
  link,
  codigo,
  unidade,
  empreendimento,
}: {
  nome: string;
  link: string;
  codigo: string;
  unidade: string;
  empreendimento: string;
}): string {
  return [
    `Boa notícia, ${nome.trim().split(/\s+/)[0]}! A proposta ${codigo} foi aceita. 🎉`,
    "",
    `🏠 *${unidade}* · ${empreendimento}`,
    "",
    "O fechamento começou e já tem tarefas esperando por você — a documentação do comprador:",
    link,
    "",
    "O comprador também recebeu um link para acompanhar o processo.",
  ].join("\n");
}

/** Corretor que entrou na divisão da comissão, mas não conduz o fechamento. */
export function textoAceitaCorretorAcompanha({
  nome,
  link,
  codigo,
  unidade,
  empreendimento,
}: {
  nome: string;
  link: string;
  codigo: string;
  unidade: string;
  empreendimento: string;
}): string {
  return [
    `Boa notícia, ${nome.trim().split(/\s+/)[0]}! O negócio ${codigo} começou e você participa da comissão. 🎉`,
    "",
    `🏠 *${unidade}* · ${empreendimento}`,
    "",
    "Acompanhe o fechamento por aqui:",
    link,
  ].join("\n");
}

/** Vendedor pessoa física: fala com ele, não com "a equipe". */
export function textoAceitaProprietario({
  nome,
  link,
  unidade,
  empreendimento,
}: {
  nome: string;
  link: string;
  unidade: string;
  empreendimento: string;
}): string {
  return [
    `Olá, ${nome.trim().split(/\s+/)[0]}! Seu imóvel entrou em negociação pela Trilha. 🎉`,
    "",
    `🏠 *${unidade}* · ${empreendimento}`,
    "",
    "O fechamento começou. Seus dados e alguns documentos já podem ser enviados por aqui:",
    link,
  ].join("\n");
}

export function textoAceitaIncorporadora({
  nome,
  link,
  unidade,
  empreendimento,
}: {
  nome: string;
  link: string;
  unidade: string;
  empreendimento: string;
}): string {
  return [
    `Olá, ${nome.trim().split(/\s+/)[0]}! Uma unidade de vocês foi vendida pela Trilha. 🎉`,
    "",
    `🏠 *${unidade}* · ${empreendimento}`,
    "",
    "O fechamento começou. Há documentos do imóvel esperando por vocês:",
    link,
  ].join("\n");
}

export function textoConviteParceiro({
  nome,
  link,
  proposta,
}: {
  nome: string;
  link: string;
  /** Ausente num reenvio: ali o corretor já sabe de qual proposta se trata. */
  proposta?: { codigo: string; unidade: string; empreendimento: string };
}): string {
  const primeiroNome = nome.trim().split(/\s+/)[0];

  const abertura = proposta
    ? [
        `Olá, ${primeiroNome}! Recebemos a sua proposta na Trilha. 🎉`,
        "",
        `📄 *Proposta:* ${proposta.codigo}`,
        `🏠 *Unidade:* ${proposta.unidade} · ${proposta.empreendimento}`,
      ]
    : [`Olá, ${primeiroNome}! Aqui está o seu acesso à Trilha.`];

  return [
    ...abertura,
    "",
    "Defina a sua senha neste link e acompanhe o andamento por lá:",
    link,
    "",
    "O link vale por 7 dias e só pode ser usado uma vez.",
  ].join("\n");
}

// ------------------------------------------------------ proposta enviada

const primeiro = (nome: string) => nome.trim().split(/\s+/)[0];

/**
 * Confirmação para o corretor que já tem cadastro. Quem é novo recebe o
 * convite de acesso, que já diz "recebemos a sua proposta" — mandar as duas
 * seria repetir.
 */
export function textoPropostaRecebida({
  nome,
  codigo,
  unidade,
  empreendimento,
  link,
}: {
  nome: string;
  codigo: string;
  unidade: string;
  empreendimento: string;
  link: string;
}): string {
  return [
    `Olá, ${primeiro(nome)}! Recebemos a sua proposta na Trilha. ✅`,
    "",
    `📄 *Proposta:* ${codigo}`,
    `🏠 *Unidade:* ${unidade} · ${empreendimento}`,
    "",
    "Agora ela passa pela análise da Trilha. Você recebe a resposta aqui no WhatsApp.",
    "Acompanhe pelo painel:",
    link,
  ].join("\n");
}

// --------------------------------------------------------------- recusa
// Só o corretor recebe o MOTIVO: é ele quem conversa com o cliente e decide o
// próximo passo. Comprador e vendedor recebem uma mensagem neutra.

export function textoRecusaCorretor({
  nome,
  codigo,
  unidade,
  empreendimento,
  motivo,
  link,
}: {
  nome: string;
  codigo: string;
  unidade: string;
  empreendimento: string;
  motivo: string | null;
  link: string;
}): string {
  return [
    `Olá, ${primeiro(nome)}. A proposta ${codigo} não foi aprovada pela Trilha.`,
    "",
    `🏠 *${unidade}* · ${empreendimento}`,
    ...(motivo ? ["", `*Motivo:* ${motivo}`] : []),
    "",
    "Se fizer sentido, converse com o seu cliente e envie uma nova proposta pelo simulador. Detalhes no painel:",
    link,
  ].join("\n");
}

export function textoRecusaComprador({
  nome,
  unidade,
  empreendimento,
  corretor,
}: {
  nome: string;
  unidade: string;
  empreendimento: string;
  corretor: string | null;
}): string {
  return [
    `Olá, ${primeiro(nome)}. A sua proposta para o imóvel abaixo não seguiu adiante desta vez.`,
    "",
    `🏠 *${unidade}* · ${empreendimento}`,
    "",
    corretor
      ? `${primeiro(corretor)}, o seu corretor, vai falar com você sobre os próximos passos.`
      : "O seu corretor vai falar com você sobre os próximos passos.",
  ].join("\n");
}

export function textoRecusaVendedor({
  nome,
  codigo,
  unidade,
  empreendimento,
}: {
  nome: string;
  codigo: string;
  unidade: string;
  empreendimento: string;
}): string {
  return [
    `Olá, ${primeiro(nome)}. A proposta ${codigo} não seguiu adiante.`,
    "",
    `🏠 *${unidade}* · ${empreendimento}`,
    "",
    "Não há nada a fazer da sua parte.",
  ].join("\n");
}

// ------------------------------------------------------ andamento do fechamento
// Um aviso por NÍVEL que abre (não por tarefa), mais dois marcos: o contrato
// enviado para assinatura e a trilha começando. Cada papel recebe o seu texto
// e o seu link: o comprador, a página pública; os outros, o painel.
//
// A verificação de crédito é interna e nunca aparece aqui: "a documentação
// está completa" vale para quem quer que tenha fechado o nível.

export type MarcoAndamento = "documentos" | "contrato" | "assinatura" | "pagamentos" | "chaves" | "trilha";
export type PapelAviso = "comprador" | "corretor" | "vendedor";

type DadosAndamento = {
  marco: MarcoAndamento;
  papel: PapelAviso;
  nome: string;
  unidade: string;
  empreendimento: string;
  link: string;
  /** Só no marco "contrato". */
  linkMinuta?: string;
  /** Vendedor pessoa física: "o proprietário" no lugar de "a incorporadora". */
  vendedorPF?: boolean;
};

export function textoAndamento(d: DadosAndamento): string {
  const ola = `Olá, ${primeiro(d.nome)}!`;
  const imovel = `🏠 *${d.unidade}* · ${d.empreendimento}`;
  const comprador = d.papel === "comprador";
  const corretor = d.papel === "corretor";
  const vendedor = d.vendedorPF ? "o proprietário" : "a incorporadora";

  const corpo: Record<MarcoAndamento, string[]> = {
    // Só para o vendedor, quando ele termina a parte dele no nível 1.
    documentos: [
      `${ola} Recebemos todos os documentos de vocês. ✅ Obrigado!`,
      "",
      imovel,
      "",
      "Agora a Trilha segue com as próximas etapas. Acompanhe o andamento por aqui, quando quiser:",
      d.link,
    ],
    contrato: [
      `${ola} A documentação ${comprador ? "da sua compra " : ""}está completa. ✅`,
      "",
      imovel,
      "",
      "Agora a Trilha está redigindo o contrato. Antes da assinatura, leia a minuta: é o modelo padrão, que recebe os dados das partes e do imóvel na versão final.",
      d.linkMinuta ?? "",
      "",
      comprador
        ? "Ficou alguma dúvida sobre as cláusulas? Fale com o seu corretor ou com a Trilha antes de assinar."
        : "Dúvidas sobre as cláusulas: fale com a Trilha antes do envio para assinatura.",
      "",
      comprador ? "Acompanhe por aqui:" : "Painel:",
      d.link,
    ],
    assinatura: [
      `${ola} O contrato foi enviado para assinatura. 📝`,
      "",
      imovel,
      "",
      "*Confira o seu e-mail*: o convite para assinar chega pela Autentique (olhe também o spam ou lixo eletrônico). Cada parte recebe o seu e assina pelo link do e-mail.",
      "",
      comprador ? "Acompanhe por aqui:" : "Painel:",
      d.link,
    ],
    pagamentos: [
      `${ola} O contrato foi assinado por todos. ✅`,
      "",
      imovel,
      "",
      comprador
        ? "Falta só um detalhe antes das chaves: os pagamentos do seguro incêndio e da vistoria. A Trilha vai gerar essas cobranças e, assim que forem confirmadas, o seu corretor agenda a entrega das chaves com você."
        : corretor
          ? `Agora estamos aguardando o cliente pagar o seguro incêndio e a vistoria — se precisar, dê um toque nele. Assim que os pagamentos forem confirmados, agende com ${vendedor} a retirada das chaves e combine a entrega com o cliente.`
          : "O próximo passo é a entrega das chaves: assim que os pagamentos iniciais do comprador forem confirmados, o corretor entra em contato para combinar a retirada.",
      "",
      comprador ? "Acompanhe por aqui:" : "Painel:",
      d.link,
    ],
    chaves: [
      comprador ? `${ola} Os seus pagamentos foram confirmados. ✅` : `${ola} Os pagamentos do comprador foram confirmados. ✅`,
      "",
      imovel,
      "",
      comprador
        ? "Agora é a entrega das chaves: o seu corretor vai combinar o dia com você."
        : corretor
          ? `Agende agora com ${vendedor} a retirada das chaves e combine a entrega com o cliente.`
          : "O corretor vai entrar em contato para combinar a retirada das chaves.",
      "",
      comprador ? "Acompanhe por aqui:" : "Painel:",
      d.link,
    ],
    trilha: [
      comprador ? `${ola} Chaves liberadas. Bem-vindo(a) ao seu novo lar! 🎉🔑` : `${ola} Chaves liberadas! 🎉🔑`,
      "",
      imovel,
      "",
      comprador
        ? "A partir de agora começa a sua Trilha. As parcelas mensais vencem todo dia 10, pagas por Pix — a cobrança de cada mês chega por e-mail e SMS."
        : d.papel === "corretor"
          ? "O negócio virou trilha. A sua comissão é repassada por Pix nos dias 14 e 15 de cada mês, conforme as parcelas forem pagas. Obrigado pela parceria!"
          : "O negócio virou trilha. Os repasses das parcelas pagas são feitos por Pix nos dias 14 e 15 de cada mês.",
      "",
      comprador ? "Acompanhe por aqui:" : "Painel:",
      d.link,
    ],
  };

  return corpo[d.marco].join("\n");
}

export const ASSUNTO_DO_MARCO: Record<MarcoAndamento, string> = {
  documentos: "Documentos do vendedor recebidos",
  contrato: "Contrato em redação (minuta)",
  assinatura: "Contrato enviado para assinatura",
  pagamentos: "Contrato assinado",
  chaves: "Pagamentos confirmados",
  trilha: "Chaves liberadas",
};

// ------------------------------------------------------------ chave Pix

/**
 * O dono é avisado de TODA troca da chave dele, inclusive quando foi ele
 * mesmo: é o que denuncia um login roubado. A frase muda, o aviso não.
 */
export function textoChavePixAlterada({
  nome,
  quemTrocou,
  propria,
  quando,
  chaveNova,
  link,
}: {
  nome: string;
  /** "INC TESTE (incorporadora)", "a equipe da Trilha". Ignorado quando `propria`. */
  quemTrocou: string;
  propria: boolean;
  quando: string;
  /** Já mascarada. Nulo = a chave foi apagada. */
  chaveNova: string | null;
  /** Onde ele mesmo corrige; nulo quando ainda não há tela para ele. */
  link: string | null;
}): string {
  return [
    `Olá, ${primeiro(nome)}. A sua chave Pix de recebimento na Trilha foi alterada${
      propria ? "" : ` por ${quemTrocou}`
    } em ${quando}.`,
    "",
    chaveNova ? `*Nova chave:* ${chaveNova}` : "*A chave foi removida.* Sem chave, não conseguimos fazer os seus repasses.",
    "",
    propria
      ? "Se foi você, está tudo certo. Se não foi, fale com a equipe da Trilha agora."
      : "Se você não pediu essa troca, fale com a equipe da Trilha agora: os próximos repasses vão para esta chave.",
    ...(link ? ["", "Seus dados no painel:", link] : []),
  ].join("\n");
}

export type MotivoChaveRecusada = "sem_chave" | "formato" | "recusada";

/** Repasse que não saiu por causa da chave — o único caso em que o dono pode resolver. */
export function textoRepasseChaveRecusada({
  nome,
  valor,
  referencia,
  motivo,
  chave,
  link,
}: {
  nome: string;
  /** Já formatado: "R$ 2.201,13". */
  valor: string;
  /** "10/2026" */
  referencia: string;
  motivo: MotivoChaveRecusada;
  /** Já mascarada. */
  chave: string | null;
  link: string | null;
}): string {
  const porque =
    motivo === "sem_chave"
      ? "não há chave Pix cadastrada para você."
      : motivo === "formato"
        ? `a chave cadastrada (${chave ?? "—"}) está num formato que não conseguimos usar.`
        : `o banco não aceitou a chave cadastrada (${chave ?? "—"}).`;
  return [
    `Olá, ${primeiro(nome)}. Não conseguimos enviar o seu repasse de ${valor} (referência ${referencia}): ${porque}`,
    "",
    link
      ? "Confira a sua chave Pix no painel e fale com a equipe da Trilha para enviarmos de novo:"
      : "Fale com a equipe da Trilha para corrigir a chave e enviarmos de novo.",
    ...(link ? [link] : []),
  ].join("\n");
}
