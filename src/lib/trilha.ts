/**
 * Regras da jornada Trilha que valem para o sistema inteiro.
 *
 * O reajuste é a valorização que o imóvel sofre ao longo da jornada: 0,42% ao
 * mês, compostos, durante os 24 meses padrão. Se a taxa ou o prazo mudarem,
 * mude aqui — e no espelho `supabase/valor-reajustado.sql`, que faz a mesma
 * conta dentro do banco.
 */

export const TAXA_REAJUSTE_MENSAL = 0.0042;

/**
 * Gestão da Trilha, cobrada junto de cada parcela. Incide sobre a base da
 * própria opção — a mesma que serve para entrada, ato e saldo —, então numa
 * opção de 12 meses ela é menor do que numa de 36. Constante da empresa: não
 * é campo de cadastro.
 */
export const TAXA_GESTAO_MENSAL = 0.001;

/**
 * Piso da gestão, em reais por mês. A gestão é o MAIOR entre R$ 296 e 0,1% da
 * base — então o piso vale até a base de R$ 296 mil e, dali para cima, manda o
 * percentual. A comparação é com a base (valor reajustado), não com o preço de
 * hoje: decisão de 26/out.
 */
export const GESTAO_MINIMA_MENSAL = 296;

/**
 * Comissão dos parceiros imobiliários quando a incorporadora não define a
 * dela: 6% do valor ajustado do imóvel. Sai da entrada, nunca do saldo, e é
 * paga parcelada ao longo da Trilha.
 */
export const COMISSAO_PADRAO = 6;
export const PRAZO_PADRAO_MESES = 24;

/** Ex.: 500000 → 552910.98 (R$ 500.000,00 valem R$ 552.910,98 em 24 meses). */
export function valorReajustado(
  valor: number | null | undefined,
  meses: number = PRAZO_PADRAO_MESES,
): number | null {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return null;
  const reajustado = valor * (1 + TAXA_REAJUSTE_MENSAL) ** meses;
  // Arredonda em centavos, igual ao numeric(14, 2) do banco.
  return Math.round(reajustado * 100) / 100;
}

const taxaEmPercentual = (TAXA_REAJUSTE_MENSAL * 100).toLocaleString("pt-BR", {
  maximumFractionDigits: 2,
});

/** Frase que acompanha o campo, para o usuário entender de onde vem o número. */
export const OBSERVACAO_REAJUSTE =
  `Na Trilha, o imóvel sofre um reajuste de ${taxaEmPercentual}% ao mês. ` +
  `Esse é o valor dele em ${PRAZO_PADRAO_MESES} meses.`;

// ---- opções de pagamento --------------------------------------------------

/** Cada incorporadora define até quatro formatos de entrada parcelada. */
export const MAX_OPCOES_PAGAMENTO = 4;

/** Limites do "tempo de Trilha" definidos pela empresa. */
export const PRAZO_TRILHA_MIN = 12;
export const PRAZO_TRILHA_MAX = 36;
