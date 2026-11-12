-- ----------------------------------------------------------------------------
-- Desativar vendedor · nov/2026
--
-- Vendedor é incorporadora e proprietário pessoa física: a MESMA tabela, com
-- uma coluna `tipo`. Até agora não havia como tirar um do ar sem apagar.
--
-- Decidido com o Matheus: desativar alcança DUAS coisas —
--   1. o login dela para de funcionar;
--   2. o estoque dela sai do ar (simulador, `/condicoes` e nova negociação).
-- NÃO alcança os corretores dela: cada corretor tem o próprio `parceiro.ativo`
-- e continua decidido um a um.
--
-- A coluna fica em `incorporadora`, e não em `conta`, por duas razões. É o
-- mesmo desenho que o corretor já usa (`parceiro.ativo`, honrado por
-- `meu_parceiro_id()`), então as duas metades do sistema se leem igual. E é o
-- VENDEDOR que está sendo desligado, não um login: a incorporadora pode trocar
-- de conta de acesso sem que isso mexa na situação dela.
--
-- Uma chave só, dois efeitos. `conta.ativo` continua existindo e valendo só
-- para administrador da Trilha.
--
-- Aditivo e seguro de rodar mais de uma vez.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- PARTE 1 · A coluna
-- ----------------------------------------------------------------------------

alter table public.incorporadora
  add column if not exists ativo boolean not null default true;

comment on column public.incorporadora.ativo is
  'Vendedor ativo. Desativado: o login para de enxergar qualquer coisa (minha_incorporadora_id devolve null) e o estoque sai do simulador. Nasce true, inclusive nas linhas que ja existiam. Nao mexe nos corretores dele.';


-- ----------------------------------------------------------------------------
-- PARTE 2 · O login deixa de enxergar
--
-- `minha_incorporadora_id()` é o que recorta TODAS as policies do vendedor:
-- empreendimento, imóvel, opção de pagamento, parceiro, proposta, negócio.
-- Exigir `ativo` aqui desliga tudo de uma vez — não existe tela esquecida,
-- porque não é a tela que decide.
--
-- É exatamente o que `meu_parceiro_id()` já faz com `parceiro.ativo`.
-- ----------------------------------------------------------------------------

create or replace function public.minha_incorporadora_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.incorporadora where conta_id = auth.uid() and ativo;
$$;

comment on function public.minha_incorporadora_id() is
  'O id do vendedor de quem esta perguntando, ou null. Exige ativo desde nov/2026: desmarcar a coluna recorta todas as policies do vendedor ao mesmo tempo.';


-- ----------------------------------------------------------------------------
-- Conferência
-- ----------------------------------------------------------------------------

select 'coluna incorporadora.ativo' as o_que,
       case when exists (
              select 1 from information_schema.columns
               where table_schema = 'public'
                 and table_name = 'incorporadora'
                 and column_name = 'ativo'
            ) then 'ok' else 'FALTOU' end as situacao
union all
select 'minha_incorporadora_id() exige ativo',
       case when pg_get_functiondef('public.minha_incorporadora_id()'::regprocedure) like '%ativo%'
            then 'ok' else 'FALTOU' end
union all
select 'vendedores ativos',
       count(*)::text from public.incorporadora where ativo
union all
select 'vendedores desativados',
       count(*)::text from public.incorporadora where not ativo;

-- Todos devem aparecer com ativo = true.
select nome, tipo, ativo from public.incorporadora order by tipo, nome;
