/**
 * A conta de uma condição de pagamento, e de como o dinheiro se divide.
 *
 * A opção guarda só percentual e prazo; os reais nascem aqui, quando ela
 * encontra o valor de um imóvel. Nada disto é gravado no banco — é sempre
 * derivado, para que editar a opção mude todos os imóveis de uma vez.
 *
 * A base NÃO é a coluna `imovel.valor_reajustado`, que é fixa em 24 meses:
 * como o prazo é livre, cada opção valoriza o valor original pelo seu próprio
 * tempo de Trilha.
 *
 * A parcela que o comprador paga se divide em três: o que fica com a
 * incorporadora, a comissão do parceiro imobiliário e a gestão da Trilha. O
 * comprador não vê essa divisão — para ele existe uma parcela só.
 */

import {
  COMISSAO_PADRAO,
  GESTAO_MINIMA_MENSAL,
  TAXA_GESTAO_MENSAL,
  TAXA_REAJUSTE_MENSAL,
} from "@/lib/trilha";

export type OpcaoPagamento = {
  ordem: number;
  percentual_entrada: number;
  percentual_ato: number;
  prazo_meses: number;
};

export type Condicao = {
  ordem: number;
  prazoMeses: number;
  percentualEntrada: number;
  percentualAto: number;
  percentualComissao: number;

  /** Valor do imóvel corrigido pelo tempo de Trilha desta opção. */
  base: number;
  entrada: number;
  /** Parte da entrada paga no fechamento — vai inteira para a incorporadora. */
  ato: number;
  /** O que sobra da entrada para diluir nas parcelas. */
  totalNaTrilha: number;
  /** Quitado no mês seguinte ao fim da Trilha. Não tem desconto de comissão. */
  saldoFinanciar: number;

  /** Gestão da Trilha, igual em todos os meses: 0,1% da base, mínimo R$ 296. */
  gestao: number;
  /** Parcela cheia do comprador, já com a gestão. Vale da segunda em diante. */
  parcela: number;
  /** A primeira leva a sobra de centavos da divisão. */
  primeiraParcela: number;
  temSobra: boolean;

  /** Comissão dos parceiros imobiliários, sobre o valor ajustado. */
  comissaoTotal: number;
  /** A comissão é diluída nos meses da Trilha. */
  comissaoMensal: number;

  /** O que a incorporadora recebe durante a Trilha: entrada − comissão. Inclui
   *  o ato, que ela recebe inteiro no fechamento. */
  incorporadoraNaTrilha: number;
  /** O que ela recebe por mês — o ato não entra aqui, já foi pago à vista. */
  incorporadoraMensal: number;
  /** O total da venda para ela: valor ajustado − comissão. O saldo do fim não
   *  tem desconto nenhum. */
  incorporadoraTotal: number;

  /**
   * Falso quando a comissão é maior que o que há para parcelar — aí a
   * incorporadora receberia valor negativo, e a condição não fecha.
   */
  comissaoCabe: boolean;
};

const centavos = (valor: number) => Math.round(valor * 100);
const emReais = (cents: number) => cents / 100;

/**
 * Devolve `null` quando não há o que calcular — imóvel sem valor. Quem chama
 * usa isso para mostrar "informe o valor do imóvel" em vez de um card com
 * zeros, que pareceria uma condição real.
 */
export function calcularCondicao(
  valorImovel: number | null | undefined,
  opcao: OpcaoPagamento,
  percentualComissao: number = COMISSAO_PADRAO,
): Condicao | null {
  if (valorImovel === null || valorImovel === undefined) return null;
  if (!Number.isFinite(valorImovel) || valorImovel <= 0) return null;

  const { percentual_entrada, percentual_ato, prazo_meses } = opcao;
  if (!Number.isFinite(prazo_meses) || prazo_meses <= 0) return null;

  const comissaoPct = Number.isFinite(percentualComissao) ? percentualComissao : COMISSAO_PADRAO;

  const base = emReais(centavos(valorImovel * (1 + TAXA_REAJUSTE_MENSAL) ** prazo_meses));
  const entrada = emReais(centavos((base * percentual_entrada) / 100));
  const ato = emReais(centavos((base * percentual_ato) / 100));
  const totalNaTrilha = emReais(centavos(entrada) - centavos(ato));
  // O piso entra aqui e em nenhum outro lugar: o banco não recalcula a gestão,
  // ele lê a que ficou congelada na proposta (`condicao->>'gestao'`).
  const gestao = emReais(
    Math.max(centavos(GESTAO_MINIMA_MENSAL), centavos(base * TAXA_GESTAO_MENSAL)),
  );

  // Dividir em centavos, e não em reais, garante que a soma das parcelas dê
  // exatamente o total. A sobra da divisão vai na primeira parcela.
  const totalCents = centavos(totalNaTrilha);
  const parcelaCents = Math.floor(totalCents / prazo_meses);
  const sobraCents = totalCents - parcelaCents * prazo_meses;

  // A comissão incide sobre o valor ajustado do imóvel, não sobre a entrada,
  // e sai do que há para parcelar — o ato é todo da incorporadora.
  const comissaoCents = centavos((base * comissaoPct) / 100);
  const comissaoMensalCents = Math.floor(comissaoCents / prazo_meses);
  // A sobra da divisão da comissão não vira campo próprio: ela acompanha a
  // sobra da parcela, que já vai toda na primeira. `comissaoMensal` é o valor
  // recorrente, da segunda parcela em diante — igual ao que fazemos com o
  // comprador.

  // O que sobra para a incorporadora é derivado da parcela, e não dividido de
  // novo: assim incorporadora + parceiro fecha com a parcela em todo mês, sem
  // centavo sobrando de um arredondamento independente.
  const incorporadoraMensalCents = parcelaCents - comissaoMensalCents;

  return {
    ordem: opcao.ordem,
    prazoMeses: prazo_meses,
    percentualEntrada: percentual_entrada,
    percentualAto: percentual_ato,
    percentualComissao: comissaoPct,

    base,
    entrada,
    ato,
    totalNaTrilha,
    saldoFinanciar: emReais(centavos(base) - centavos(entrada)),

    gestao,
    parcela: emReais(parcelaCents + centavos(gestao)),
    primeiraParcela: emReais(parcelaCents + sobraCents + centavos(gestao)),
    temSobra: sobraCents > 0,

    comissaoTotal: emReais(comissaoCents),
    comissaoMensal: emReais(comissaoMensalCents),

    incorporadoraNaTrilha: emReais(centavos(entrada) - comissaoCents),
    incorporadoraMensal: emReais(incorporadoraMensalCents),
    incorporadoraTotal: emReais(centavos(base) - comissaoCents),

    // A comissão sai do que é parcelado; o ato é da incorporadora. Se ela não
    // couber aí, a condição não fecha.
    comissaoCabe: comissaoCents <= totalCents,
  };
}

/** As condições de um imóvel, na ordem das opções da incorporadora. */
export function calcularCondicoes(
  valorImovel: number | null | undefined,
  opcoes: OpcaoPagamento[],
  percentualComissao: number = COMISSAO_PADRAO,
): Condicao[] {
  return opcoes
    .map((o) => calcularCondicao(valorImovel, o, percentualComissao))
    .filter((c): c is Condicao => c !== null);
}

// ------------------------------------------------ divisão entre corretores

export type FatiaComissao = { parceiroId: string; nome: string; pontos: number };

export type DivisaoComissao = {
  corretores: (FatiaComissao & { total: number; mensal: number })[];
  /** O que os corretores não levam fica com a Trilha. */
  trilha: { pontos: number; total: number; mensal: number };
  /** Falso quando os pontos dos corretores passam da comissão total. */
  cabe: boolean;
};

/**
 * Divide a comissão de uma condição entre corretores, em PONTOS DO VALOR
 * FINAL do imóvel (3,6 = 3,6% do valor final). O que sobra é da Trilha.
 *
 * Mesmos cuidados da conta principal: tudo em centavos, e a parte da Trilha
 * é DERIVADA (comissão − corretores), não calculada de novo — assim as partes
 * sempre fecham com `comissaoTotal` e, por mês, com `comissaoMensal`, e a
 * invariante incorporadora + comissão + gestão = parcela continua valendo.
 */
export function dividirComissao(c: Condicao, fatias: FatiaComissao[]): DivisaoComissao {
  const comissaoCents = centavos(c.comissaoTotal);
  const comissaoMensalCents = centavos(c.comissaoMensal);

  const totais = fatias.map((f) => centavos((c.base * f.pontos) / 100));
  // Pontos que somam exatamente a comissão podem passar dela por 1 centavo de
  // arredondamento; esse centavo sai do último corretor, não da Trilha.
  const somaPontos = fatias.reduce((s, f) => s + f.pontos, 0);
  let soma = totais.reduce((s, t) => s + t, 0);
  if (totais.length && Math.abs(somaPontos - c.percentualComissao) < 1e-9 && soma !== comissaoCents) {
    totais[totais.length - 1] += comissaoCents - soma;
    soma = comissaoCents;
  }

  const mensais = totais.map((t) => Math.floor(t / c.prazoMeses));
  const somaMensal = mensais.reduce((s, m) => s + m, 0);

  return {
    corretores: fatias.map((f, i) => ({ ...f, total: emReais(totais[i]), mensal: emReais(mensais[i]) })),
    trilha: {
      pontos: Math.round((c.percentualComissao - somaPontos) * 100) / 100,
      total: emReais(comissaoCents - soma),
      mensal: emReais(comissaoMensalCents - somaMensal),
    },
    cabe: somaPontos <= c.percentualComissao + 1e-9 && soma <= comissaoCents,
  };
}
