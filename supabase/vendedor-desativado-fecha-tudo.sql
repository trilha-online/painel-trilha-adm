-- ----------------------------------------------------------------------------
-- Desativar vendedor: fechar o que ficou aberto · nov/2026
--
-- Continuação de `vendedor-desativar.sql`. Aquele arquivo criou
-- `incorporadora.ativo` e fez `minha_incorporadora_id()` exigi-lo, o que
-- cegou o vendedor desativado no painel e tirou o estoque dele do simulador.
--
-- Uma auditoria depois mostrou dois buracos que sobraram. Os dois são da
-- mesma natureza: um caminho de leitura ou de escrita que não passa por
-- `minha_incorporadora_id()` e, por isso, não ficou sabendo da mudança.
--
--   1. O vendedor desativado ainda EDITAVA a própria ficha — inclusive a
--      chave Pix, que decide para onde o repasse vai. A policy de update
--      pergunta só `conta_id = auth.uid()`.
--
--   2. O catálogo do vendedor desativado continuava aparecendo no painel dos
--      CORRETORES dele. Esse recorte passa por outra função,
--      `minha_incorporadora_como_parceiro()`, que confere `parceiro.ativo`
--      mas não o `ativo` da incorporadora.
--
-- Aditivo e seguro de rodar mais de uma vez.
-- ⚠️ Rode `vendedor-desativar.sql` antes: a coluna `ativo` vem de lá.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- PARTE 1 · Vendedor desativado não escreve mais na própria ficha
--
-- `using` olha a linha como ela está; `with check`, como ela ficaria. Os dois
-- exigem `ativo` — o primeiro impede desativado editar, o segundo impede
-- alguém se religar por tabela.
--
-- Ler a própria ficha continua liberado de propósito: é como a aplicação
-- distingue "cadastro desativado" de "cadastro não existe", e é o que leva a
-- pessoa para a tela que explica, em vez de um painel vazio.
-- ----------------------------------------------------------------------------

drop policy if exists incorporadora_propria_edicao on public.incorporadora;

create policy incorporadora_propria_edicao on public.incorporadora
  for update to authenticated
  using (conta_id = auth.uid() and ativo)
  with check (conta_id = auth.uid() and ativo);

comment on policy incorporadora_propria_edicao on public.incorporadora is
  'O vendedor edita a propria ficha enquanto estiver ativo. Desativado nao escreve nada, nem a chave Pix.';

-- Nome antigo da mesma regra, de `perfil-incorporadora.sql`. Já não existe no
-- banco de produção, mas quem recriar o projeto a partir dos arquivos ia
-- acabar com as duas. Uma regra, um nome.
drop policy if exists incorporadora_atualiza_propria on public.incorporadora;


-- ----------------------------------------------------------------------------
-- PARTE 2 · O catálogo do vendedor desativado some do painel do corretor
--
-- Esta função responde "de qual incorporadora eu sou corretor?", e é ela que
-- recorta QUATRO policies de leitura: a incorporadora em si, os
-- empreendimentos, as unidades e as opções de pagamento. Acrescentar o
-- `ativo` dela aqui apaga o catálogo inteiro nas quatro de uma vez.
--
-- O corretor NÃO perde nada do que já é dele: proposta, negócio e trilha
-- passam por `participo_de()` e `meu_parceiro_id()`, que não chamam esta
-- função. Ele continua acompanhando o que vendeu — só não vê mais estoque
-- novo de um vendedor que saiu do ar. É coerente com o resto: o simulador já
-- recusa simular, então aparecer no painel só serviria para ele descobrir no
-- clique que não dá para propor.
-- ----------------------------------------------------------------------------

create or replace function public.minha_incorporadora_como_parceiro()
returns uuid
language sql stable security definer set search_path = public as $$
  select p.incorporadora_id
    from public.parceiro p
    join public.incorporadora i on i.id = p.incorporadora_id
   where p.conta_id = auth.uid()
     and p.ativo
     and i.ativo;
$$;

comment on function public.minha_incorporadora_como_parceiro() is
  'De qual incorporadora eu sou corretor, ou null. Exige o corretor ativo E a incorporadora ativa desde nov/2026: vendedor desativado some do painel dos corretores dele.';


-- ----------------------------------------------------------------------------
-- Conferência
-- ----------------------------------------------------------------------------

select 'policy de update exige ativo' as o_que,
       case when exists (
              select 1 from pg_policy
               where polname = 'incorporadora_propria_edicao'
                 and pg_get_expr(polqual, polrelid) like '%ativo%'
            ) then 'ok' else 'FALTOU' end as situacao
union all
select 'policy duplicada removida',
       case when not exists (select 1 from pg_policy where polname = 'incorporadora_atualiza_propria')
            then 'ok' else 'AINDA EXISTE' end
union all
select 'corretor enxerga so vendedor ativo',
       case when pg_get_functiondef('public.minha_incorporadora_como_parceiro()'::regprocedure) like '%i.ativo%'
            then 'ok' else 'FALTOU' end
union all
select 'policies de update na incorporadora',
       count(*)::text from pg_policy
 where polrelid = 'public.incorporadora'::regclass and polcmd in ('w','*');

-- Deve listar exatamente duas: incorporadora_admin (ALL) e
-- incorporadora_propria_edicao (UPDATE, agora exigindo ativo).
select polname,
       case polcmd when 'w' then 'UPDATE' when '*' then 'ALL' else polcmd::text end as cmd,
       pg_get_expr(polqual, polrelid) as usando
  from pg_policy
 where polrelid = 'public.incorporadora'::regclass and polcmd in ('w','*')
 order by polname;
