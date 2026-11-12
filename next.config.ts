import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // O padrão do Next é 1 MB, e uma tabela de estoque em PDF passa disso
      // fácil — sem esta linha o upload falha antes de chegar na ação.
      //
      // O teto NÃO é escolha nossa: a Vercel corta o corpo da requisição por
      // volta de 4,5 MB, e nada que configurarmos aqui muda isso. Deixar 25 MB
      // só fazia o erro chegar como falha genérica de rede em vez de mensagem
      // explicando o problema. A ação recusa acima de 4 MB, e esta folga é
      // para o cabeçalho do multipart.
      bodySizeLimit: "4.5mb",
    },
  },

  /**
   * `/simulador` virou `/proposta` em nov/2026.
   *
   * O redirecionamento não é cortesia: aquele link já foi para dezenas de
   * conversas de WhatsApp, com `?e=` e `?u=` apontando para uma unidade
   * específica, e está no material impresso do corretor. O Next leva a query
   * junto sozinho, então o cliente que abrir o link velho cai na mesma
   * unidade, na mesma condição.
   *
   * `permanent: true` manda 308: o navegador passa a ir direto, e a rota
   * antiga some do histórico de quem já usou.
   *
   * A ordem importa — a regra mais específica vem primeiro, senão
   * `/simulador/proposta` cairia na regra genérica e viraria
   * `/proposta/proposta`, que não existe.
   */
  async redirects() {
    return [
      { source: "/simulador/proposta", destination: "/proposta/enviar", permanent: true },
      { source: "/simulador", destination: "/proposta", permanent: true },
    ];
  },
};

export default nextConfig;
