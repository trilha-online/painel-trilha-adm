-- ----------------------------------------------------------------------------
-- Empreendimento indisponível · nov/2026
--
-- Até agora o empreendimento só tinha dois estados: existe ou não existe. A
-- unidade sempre teve um meio-termo (`indisponivel`); o empreendimento, não.
-- Então "essa parceria acabou" e "cadastrei errado" caíam os dois no mesmo
-- botão de excluir, e excluir leva junto as unidades e as condições.
--
-- Agora são três:
--
--   disponível     no ar, vendável
--   INDISPONÍVEL   cadastrado, guardado, fora do ar — e reversível
--   excluído       some do banco (só serve para importação que não vai ser
--                  usada ou cadastro feito errado)
--
-- Duas decisões que moram neste arquivo:
--
-- 1. A COLUNA SE CHAMA `ativo`, igual às de `incorporadora` e `parceiro`.
--    Três colunas com o mesmo nome e o mesmo sentido se leem de um jeito só.
--    Na tela a palavra é "indisponível", que é como a equipe fala e como a
--    unidade já se chama — o nome da coluna é para quem lê o código.
--
-- 2. A VISIBILIDADE É CALCULADA, nunca gravada. Um empreendimento aparece
--    quando ele está ativo E o vendedor dele está ativo. Desativar o vendedor
--    NÃO marca os empreendimentos dele: se marcasse, na hora de reativar
--    ninguém saberia quais religar — os que o sistema desligou, ou também os
--    que a Trilha já tinha desligado à mão. Calculando, reativar devolve
--    exatamente o estado que existia antes.
--
-- Quem enxerga empreendimento indisponível: só a Trilha. Nem o corretor, nem
-- o próprio vendedor, nem o simulador.
--
-- Aditivo e seguro de rodar mais de uma vez.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- PARTE 1 · A coluna
-- ----------------------------------------------------------------------------

alter table public.empreendimento
  add column if not exists ativo boolean not null default true;

comment on column public.empreendimento.ativo is
  'Empreendimento no ar. Falso = indisponivel: some do simulador, do painel do corretor e do painel do vendedor; so a Trilha ve. Nada e apagado e da para religar. Nasce true, inclusive nas linhas que ja existiam.';


-- ----------------------------------------------------------------------------
-- PARTE 2 · Some do painel do corretor
--
-- Duas policies, e a condição é a mesma: o empreendimento tem de estar ativo.
-- O `minha_incorporadora_como_parceiro()` já cuida do vendedor desativado
-- (nov/2026) — aqui entra o empreendimento desligado um a um.
-- ----------------------------------------------------------------------------

drop policy if exists empreendimento_parceiro on public.empreendimento;
create policy empreendimento_parceiro on public.empreendimento
  for select to authenticated
  using (ativo and incorporadora_id = public.minha_incorporadora_como_parceiro());

drop policy if exists imovel_parceiro on public.imovel;
create policy imovel_parceiro on public.imovel
  for select to authenticated
  using (
    status = 'disponivel'
    and exists (
      select 1 from public.empreendimento e
      where e.id = imovel.empreendimento_id
        and e.ativo
        and e.incorporadora_id = public.minha_incorporadora_como_parceiro()
    )
  );


-- ----------------------------------------------------------------------------
-- PARTE 3 · Some do painel do próprio vendedor
--
-- Decisão do Matheus: empreendimento indisponível é assunto da Trilha. Quem
-- desliga é a Trilha, e quem vê é a Trilha. Para o vendedor, aquele prédio
-- simplesmente não está mais na plataforma.
--
-- O corretor e o vendedor NÃO ficam cegos no que já é deles: proposta,
-- negócio e trilha passam por `participo_de()` e pelas policies de negócio,
-- que não olham esta coluna. Some o catálogo, não o histórico.
-- ----------------------------------------------------------------------------

drop policy if exists empreendimento_proprio on public.empreendimento;
create policy empreendimento_proprio on public.empreendimento
  for all to authenticated
  using (ativo and incorporadora_id = public.minha_incorporadora_id())
  with check (ativo and incorporadora_id = public.minha_incorporadora_id());

drop policy if exists imovel_proprio on public.imovel;
create policy imovel_proprio on public.imovel
  for all to authenticated
  using (exists (
    select 1 from public.empreendimento e
    where e.id = imovel.empreendimento_id
      and e.ativo
      and e.incorporadora_id = public.minha_incorporadora_id()
  ))
  with check (exists (
    select 1 from public.empreendimento e
    where e.id = imovel.empreendimento_id
      and e.ativo
      and e.incorporadora_id = public.minha_incorporadora_id()
  ));


-- ----------------------------------------------------------------------------
-- Conferência
-- ----------------------------------------------------------------------------

select 'coluna empreendimento.ativo' as o_que,
       case when exists (
              select 1 from information_schema.columns
               where table_schema='public' and table_name='empreendimento' and column_name='ativo'
            ) then 'ok' else 'FALTOU' end as situacao
union all
select 'as 4 policies exigem ativo',
       count(*)::text || ' de 4'
  from pg_policy
 where polname in ('empreendimento_parceiro','imovel_parceiro','empreendimento_proprio','imovel_proprio')
   and pg_get_expr(polqual, polrelid) like '%ativo%'
union all
select 'empreendimentos no ar',
       count(*)::text from public.empreendimento where ativo
union all
select 'empreendimentos indisponiveis',
       count(*)::text from public.empreendimento where not ativo;

-- Todos devem aparecer com ativo = true.
select e.nome, i.nome as vendedor, e.ativo,
       (select count(*) from public.imovel m where m.empreendimento_id = e.id) as unidades
  from public.empreendimento e join public.incorporadora i on i.id = e.incorporadora_id
 order by i.nome, e.nome;
