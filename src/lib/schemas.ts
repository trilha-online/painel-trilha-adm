import { z } from "zod";
import { isValidCNPJ, isValidCPF, isValidEmail, isValidPhone, parseDecimal, telefoneNacional, temConjuge } from "@/lib/br";
import { MAX_OPCOES_PAGAMENTO, PRAZO_TRILHA_MAX, PRAZO_TRILHA_MIN } from "@/lib/trilha";

const req = (label: string) => z.string().trim().min(1, `${label} é obrigatório`);
const opt = () => z.string().trim().optional();
const optNum = (label: string) =>
  z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^\d+$/.test(v), `${label} deve ser um número inteiro`);

// ---------------------------------------------------------------- login

export const loginSchema = z.object({
  email: req("E-mail").refine(isValidEmail, "E-mail inválido"),
  password: z.string().min(6, "Senha deve ter ao menos 6 caracteres"),
});

// ----------------------------------------------------- administradores

/**
 * Administrador da Trilha. Poucos campos de propósito: o admin NÃO tem
 * cadastro próprio como a incorporadora ou o parceiro — ele é a própria linha
 * da tabela `conta`, que já guarda nome, e-mail e telefone.
 *
 * Sem dados bancários: admin não recebe repasse. Se um dia um sócio também
 * for corretor, ele é um `parceiro` à parte, com outro login.
 */
const dadosAdmin = {
  nome: req("Nome").min(3, "Nome muito curto"),
  // Opcional porque hoje nada usa: o alerta das rotinas vai para o telefone
  // de `config_financeiro`, não para o de cada admin.
  telefone: opt().refine((v) => !v || isValidPhone(v), "Telefone inválido"),
};

export const adminSchema = z.object({
  ...dadosAdmin,
  acesso: z.object({
    email: req("E-mail de acesso").refine(isValidEmail, "E-mail inválido"),
    senha: z.string().min(8, "A senha precisa ter ao menos 8 caracteres"),
  }),
});

/** Edição: o acesso tem tela própria, como no parceiro. */
export const adminEdicaoSchema = z.object(dadosAdmin);

export type AdminFormValues = z.infer<typeof adminSchema>;
export type AdminEdicaoValues = z.infer<typeof adminEdicaoSchema>;

// ------------------------------------------------------ dados bancários

/**
 * Para onde vai o dinheiro. Incorporadora e parceiro usam os mesmos campos —
 * o repasse é o mesmo tipo de operação, então a validação também é a mesma.
 */
const bancoSchema = z.object({
  banco: opt(),
  agencia: opt(),
  conta_numero: opt(),
  chave_pix: opt(),
  chave_pix_tipo: z
    .enum(["cpf", "cnpj", "email", "telefone", "aleatoria"])
    .optional()
    .or(z.literal("")),
});

// -------------------------------------------------------- incorporadora

const dadosIncorporadora = {
  empresa: z.object({
    nome: req("Nome da incorporadora").min(3, "Nome muito curto"),
    cnpj: req("CNPJ").refine(isValidCNPJ, "CNPJ inválido"),
    email: req("E-mail corporativo").refine(isValidEmail, "E-mail inválido"),
    telefone: req("Telefone").refine(isValidPhone, "Telefone inválido"),
    endereco: opt(),
  }),
  banco: bancoSchema,
  responsavel: z.object({
    nome: req("Nome do responsável").min(3, "Nome muito curto"),
    cpf: req("CPF").refine(isValidCPF, "CPF inválido"),
    rg: opt(),
    profissao: opt(),
    cargo: opt(),
    estado_civil: opt(),
    email: req("E-mail do responsável").refine(isValidEmail, "E-mail inválido"),
    telefone: req("Telefone do responsável").refine(isValidPhone, "Telefone inválido"),
    endereco: opt(),
  }),
};

/** Cadastro: a senha de acesso é obrigatória, porque o acesso nasce junto. */
export const incorporadoraSchema = z.object({
  ...dadosIncorporadora,
  acesso: z.object({
    email: req("E-mail de acesso").refine(isValidEmail, "E-mail inválido"),
    senha: z.string().min(8, "A senha precisa ter ao menos 8 caracteres"),
  }),
});

/** Edição: os dados cadastrais mudam; o acesso tem tela própria. */
export const incorporadoraEdicaoSchema = z.object(dadosIncorporadora);

export type IncorporadoraFormValues = z.infer<typeof incorporadoraSchema>;
export type IncorporadoraEdicaoValues = z.infer<typeof incorporadoraEdicaoSchema>;

// ------------------------------------------------------ proprietário PF

/**
 * Vendedor pessoa física. No banco mora na tabela `incorporadora` (tipo PF),
 * com os dados pessoais nas colunas `resp_*`.
 */
const dadosProprietario = {
  pessoa: z.object({
    nome: req("Nome").min(3, "Nome muito curto"),
    cpf: req("CPF").refine(isValidCPF, "CPF inválido"),
    email: req("E-mail").refine(isValidEmail, "E-mail inválido"),
    telefone: req("Telefone").refine(isValidPhone, "Telefone inválido"),
    rg: opt(),
    endereco: opt(),
    profissao: opt(),
    estado_civil: opt(),
  }),
  banco: bancoSchema,
};

export const proprietarioSchema = z.object({
  ...dadosProprietario,
  acesso: z.object({
    email: req("E-mail de acesso").refine(isValidEmail, "E-mail inválido"),
    senha: z.string().min(8, "A senha precisa ter ao menos 8 caracteres"),
  }),
});

export const proprietarioEdicaoSchema = z.object(dadosProprietario);

export type ProprietarioFormValues = z.infer<typeof proprietarioSchema>;

/** Onde fica o imóvel avulso: vira o "empreendimento" dele no banco. */
export const localAvulsoSchema = z.object({
  nome: req("Condomínio, edifício ou endereço").min(2, "Muito curto"),
  endereco: opt(),
});

export type LocalAvulsoValues = z.infer<typeof localAvulsoSchema>;

/** Troca de e-mail e/ou senha de acesso. Senha vazia significa "manter a atual". */
export const acessoSchema = z.object({
  email: req("E-mail de acesso").refine(isValidEmail, "E-mail inválido"),
  senha: z
    .string()
    .optional()
    .refine((v) => !v || v.length >= 8, "A senha precisa ter ao menos 8 caracteres"),
});

/**
 * Criar acesso do zero. Mesmos campos, mas aqui a senha é obrigatória: não há
 * senha atual para manter.
 *
 * É um `refine` sobre o schema de troca, e não um objeto novo, de propósito: o
 * tipo inferido continua sendo o mesmo, e o formulário atende os dois casos
 * sem duplicar campo nem componente.
 */
export const acessoNovoSchema = acessoSchema.refine((v) => (v.senha ?? "").length >= 8, {
  message: "Defina uma senha de ao menos 8 caracteres",
  path: ["senha"],
});

export type AcessoFormValues = z.infer<typeof acessoSchema>;

// ------------------------------------------------------- empreendimento

export const empreendimentoSchema = z.object({
  incorporadora_id: req("Incorporadora").uuid("Selecione uma incorporadora"),
  nome: req("Nome do empreendimento").min(2, "Nome muito curto"),
  endereco: opt(),
});

export type EmpreendimentoFormValues = z.infer<typeof empreendimentoSchema>;

// --------------------------------------------------------------- imóvel

export const imovelSchema = z.object({
  empreendimento_id: req("Empreendimento").uuid("Selecione um empreendimento"),
  identificacao: req("Identificação"),
  /**
   * Os quatro campos abaixo nasceram na importação por IA e ficaram meses sem
   * formulário: a IA gravava, e nenhuma tela editava. Uma unidade cadastrada à
   * mão nascia sem eles.
   */
  tipologia: opt(),
  area_total: opt(),
  area_garden: opt(),
  observacao: opt(),
  numero_matricula: opt(),
  tipo: z.enum(["apartamento", "casa", "sala_comercial", "terreno", "outro"]),
  status: z.enum(["disponivel", "reservado", "em_negociacao", "em_trilha", "indisponivel"]),
  valor: opt(),
  metros_quadrados: opt(),
  posicao_solar: opt(),
  num_quartos: optNum("Quartos"),
  num_suites: optNum("Suítes"),
  num_banheiros: optNum("Banheiros"),
  num_vagas: optNum("Vagas"),
  matricula_vaga: opt(),
  sacada: z.boolean(),
  churrasqueira: z.boolean(),
});

export type ImovelFormValues = z.infer<typeof imovelSchema>;

// --------------------------------------------- opções de pagamento

/** Aceita "20" e "2,5". Vazio conta como ausente. */
const numeroEntre = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .refine((v) => {
      const n = parseDecimal(v);
      return n !== null && n >= min && n <= max;
    }, `${label} deve ser um número entre ${min} e ${max}`);

/**
 * Só três campos são livres. O que se paga durante a Trilha (entrada − ato) e
 * o saldo a financiar (100% − entrada) são consequência, e por isso não são
 * digitados nem guardados.
 */
export const opcaoPagamentoSchema = z
  .object({
    percentual_entrada: numeroEntre("Entrada", 0.01, 100),
    percentual_ato: z
      .string()
      .trim()
      .refine((v) => {
        if (v === "") return true;
        const n = parseDecimal(v);
        return n !== null && n >= 0 && n <= 100;
      }, "Ato deve ser um número entre 0 e 100"),
    prazo_meses: numeroEntre("Tempo de Trilha", PRAZO_TRILHA_MIN, PRAZO_TRILHA_MAX).refine(
      (v) => Number.isInteger(parseDecimal(v)),
      "Tempo de Trilha deve ser um número inteiro de meses",
    ),
  })
  .refine(
    (o) => (parseDecimal(o.percentual_ato || "0") ?? 0) <= (parseDecimal(o.percentual_entrada) ?? 0),
    { message: "O ato sai de dentro da entrada — não pode ser maior que ela", path: ["percentual_ato"] },
  );

export const opcoesPagamentoSchema = z.object({
  opcoes: z
    .array(opcaoPagamentoSchema)
    .max(MAX_OPCOES_PAGAMENTO, `No máximo ${MAX_OPCOES_PAGAMENTO} opções por incorporadora`),
  /**
   * Só viaja quando se edita o padrão da incorporadora: a comissão é dela, não
   * de cada opção nem de cada empreendimento.
   */
  percentual_comissao: numeroEntre("Comissão", 0, 100).optional(),
});

export type OpcaoPagamentoValues = z.infer<typeof opcaoPagamentoSchema>;
export type OpcoesPagamentoValues = z.infer<typeof opcoesPagamentoSchema>;


// ------------------------------------------------------------- parceiro

/**
 * Imobiliária ou corretor. O documento é um só campo porque o parceiro tanto
 * pode ser pessoa física quanto jurídica — validamos como CPF ou CNPJ e
 * deixamos opcional: cadastrar o parceiro não pode travar por falta de um
 * número que às vezes só chega no dia do repasse.
 */
const dadosParceiro = {
  dados: z.object({
    nome: req("Nome do parceiro").min(3, "Nome muito curto"),
    documento: opt().refine(
      (v) => !v || isValidCPF(v) || isValidCNPJ(v),
      "Informe um CPF ou CNPJ válido",
    ),
    creci: opt(),
    email: req("E-mail").refine(isValidEmail, "E-mail inválido"),
    telefone: req("Telefone").refine(isValidPhone, "Telefone inválido"),
    endereco: opt(),
    ativo: z.boolean().optional(),
  }),
  banco: bancoSchema,
};

/** Cadastro: o acesso nasce junto, igual ao da incorporadora. */
export const parceiroSchema = z.object({
  ...dadosParceiro,
  acesso: z.object({
    email: req("E-mail de acesso").refine(isValidEmail, "E-mail inválido"),
    senha: z.string().min(8, "A senha precisa ter ao menos 8 caracteres"),
  }),
});

/** Edição: o acesso tem tela própria. */
export const parceiroEdicaoSchema = z.object(dadosParceiro);

export type ParceiroFormValues = z.infer<typeof parceiroSchema>;
export type ParceiroEdicaoValues = z.infer<typeof parceiroEdicaoSchema>;

// ------------------------------------------------------------- proposta

/**
 * Quem compra. CPF é obrigatório e validado: é por ele que o comprador é uma
 * pessoa só no banco, mesmo propondo duas unidades em meses diferentes.
 */
const compradorSchema = z.object({
  nome: req("Nome do comprador").min(3, "Nome muito curto"),
  cpf: req("CPF do comprador").refine(isValidCPF, "CPF inválido"),
  email: req("E-mail do comprador").refine(isValidEmail, "E-mail inválido"),
  telefone: req("Telefone do comprador").refine(isValidPhone, "Telefone inválido"),
});

/**
 * Proposta enviada por quem NÃO está logado. Os dados do corretor vêm no
 * formulário porque ele ainda pode não existir no sistema — e se não existir,
 * nasce como parceiro pendente.
 *
 * Dados bancários não entram aqui de propósito: só fazem sentido quando há
 * comissão a pagar. Pedir no primeiro contato é atrito sem função.
 */
export const propostaSchema = z.object({
  corretor: z.object({
    nome: req("Seu nome").min(3, "Nome muito curto"),
    documento: opt().refine(
      (v) => !v || isValidCPF(v) || isValidCNPJ(v),
      "Informe um CPF ou CNPJ válido",
    ),
    creci: opt(),
    email: req("Seu e-mail").refine(isValidEmail, "E-mail inválido"),
    telefone: req("Seu telefone").refine(isValidPhone, "Telefone inválido"),
  }),
  comprador: compradorSchema,
  observacao: opt(),
});

/** Proposta de corretor logado: quem ele é, o sistema já sabe. */
export const propostaLogadaSchema = z.object({
  comprador: compradorSchema,
  observacao: opt(),
});

export type PropostaFormValues = z.infer<typeof propostaSchema>;
export type PropostaLogadaValues = z.infer<typeof propostaLogadaSchema>;

// ------------------------------------------------ ficha de qualificação

const telefoneFicha = (label: string) =>
  req(label).refine((v) => isValidPhone(telefoneNacional(v)), "Telefone inválido");

/** Os dados de uma pessoa na ficha. Titular e cônjuge pedem os mesmos. */
const pessoaFicha = (quem: string) => ({
  nome: req(`Nome ${quem}`).min(3, "Nome muito curto"),
  email: req(`E-mail ${quem}`).refine(isValidEmail, "E-mail inválido"),
  telefone: telefoneFicha(`Telefone ${quem}`),
  cpf: req(`CPF ${quem}`).refine(isValidCPF, "CPF inválido"),
  rg: req(`RG ${quem}`),
  rg_emissor: req("Órgão emissor"),
  endereco: req(`Endereço ${quem}`),
  profissao: req(`Profissão ${quem}`),
});

const pessoaFichaObj = (quem: string) => z.object(pessoaFicha(quem));

/**
 * A ficha que o corretor preenche no fechamento.
 *
 * O cônjuge e o regime de bens só existem para quem é CASADO ou vive em
 * UNIÃO ESTÁVEL — é a mesma trava `ficha_conjuge` do banco. Os campos ficam no formulário mesmo quando
 * escondidos; por isso a validação deles é condicional, e não um `optional()`
 * que deixaria passar um casado sem cônjuge.
 */
export const fichaSchema = z
  .object({
    comprador: pessoaFichaObj("do comprador").extend({
      estado_civil: z.enum(["solteiro", "casado", "uniao_estavel", "divorciado", "viuvo"], {
        message: "Escolha o estado civil",
      }),
      regime_bens: z.string().optional(),
    }),
    conjuge: z.object({
      nome: z.string(),
      email: z.string(),
      telefone: z.string(),
      cpf: z.string(),
      rg: z.string(),
      rg_emissor: z.string(),
      endereco: z.string(),
      profissao: z.string(),
    }),
  })
  .superRefine((v, ctx) => {
    if (!temConjuge(v.comprador.estado_civil)) return;

    if (!v.comprador.regime_bens) {
      ctx.addIssue({ code: "custom", path: ["comprador", "regime_bens"], message: "Escolha o regime de bens" });
    }

    const conjuge = pessoaFichaObj("do cônjuge").safeParse(v.conjuge);
    if (!conjuge.success) {
      for (const issue of conjuge.error.issues) {
        ctx.addIssue({ code: "custom", path: ["conjuge", ...issue.path], message: issue.message });
      }
    }
  });

export type FichaValues = z.infer<typeof fichaSchema>;

// ------------------------------------------------ dados do vendedor PF

/** Nome, e-mail, telefone e CPF obrigatórios; o resto é opcional (vendedor e cônjuge). */
const pessoaVendedor = (quem: string) =>
  z.object({
    nome: req(`Nome ${quem}`).min(3, "Nome muito curto"),
    email: req(`E-mail ${quem}`).refine(isValidEmail, "E-mail inválido"),
    telefone: telefoneFicha(`Telefone ${quem}`),
    cpf: req(`CPF ${quem}`).refine(isValidCPF, "CPF inválido"),
    rg: z.string(),
    endereco: z.string(),
    profissao: z.string(),
  });

/**
 * Os dados do vendedor PF no fechamento. O cônjuge só é validado para quem é
 * casado ou vive em união estável — mesma trava `ficha_vendedor_conjuge` do banco.
 */
export const fichaVendedorSchema = z
  .object({
    vendedor: pessoaVendedor("do vendedor").extend({
      estado_civil: z.enum(["solteiro", "casado", "uniao_estavel", "divorciado", "viuvo"], {
        message: "Escolha o estado civil",
      }),
    }),
    conjuge: z.object({
      nome: z.string(),
      email: z.string(),
      telefone: z.string(),
      cpf: z.string(),
      rg: z.string(),
      endereco: z.string(),
      profissao: z.string(),
    }),
    banco: z.object({
      banco: z.string(),
      agencia: z.string(),
      conta_numero: z.string(),
      chave_pix: z.string(),
    }),
  })
  .superRefine((v, ctx) => {
    if (!temConjuge(v.vendedor.estado_civil)) return;
    const conjuge = pessoaVendedor("do cônjuge").safeParse(v.conjuge);
    if (!conjuge.success) {
      for (const issue of conjuge.error.issues) {
        ctx.addIssue({ code: "custom", path: ["conjuge", ...issue.path], message: issue.message });
      }
    }
  });

export type FichaVendedorValues = z.infer<typeof fichaVendedorSchema>;
