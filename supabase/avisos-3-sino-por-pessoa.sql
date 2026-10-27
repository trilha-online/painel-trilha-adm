-- ----------------------------------------------------------------------------
-- O sino para a incorporadora e o corretor · out/2026 (chave Pix, ciclo 3)
--
-- Até aqui o sino era só da Trilha. Agora o aviso pode ter um DESTINATÁRIO:
--
--   incorporadora_id e parceiro_id nulos  → aviso da Trilha (como sempre foi)
--   incorporadora_id preenchido           → da incorporadora / proprietário PF
--   parceiro_id preenchido                → do corretor
--
-- O que entra no sino deles, por decisão de 27/out: a troca da chave Pix
-- deles e o repasse que não saiu por causa da chave. O resto (aceite,
-- andamento) continua só no WhatsApp.
--
-- Quem lê o quê fica no BANCO: cada um enxerga só os avisos que são dele. A
-- Trilha continua lendo todos (auditoria), e o sino dela filtra os da Trilha.
--
-- Aditivo e seguro de rodar mais de uma vez. Avisos antigos não mudam: todos
-- nasceram sem destinatário, ou seja, continuam da Trilha.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- PARTE 1 · O destinatário
-- ----------------------------------------------------------------------------

alter table public.aviso
  add column if not exists incorporadora_id uuid references public.incorporadora (id) on delete cascade,
  add column if not exists parceiro_id      uuid references public.parceiro (id)      on delete cascade;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'aviso_um_destinatario') then
    alter table public.aviso
      add constraint aviso_um_destinatario check (num_nonnulls(incorporadora_id, parceiro_id) <= 1);
  end if;
end $$;

comment on column public.aviso.incorporadora_id is
  'Destinatário: a incorporadora ou o proprietário PF. Nulo com parceiro_id nulo = aviso da Trilha.';
comment on column public.aviso.parceiro_id is
  'Destinatário: o corretor. Nulo com incorporadora_id nulo = aviso da Trilha.';

create index if not exists aviso_incorporadora_idx
  on public.aviso (incorporadora_id, created_at desc) where incorporadora_id is not null;
create index if not exists aviso_parceiro_idx
  on public.aviso (parceiro_id, created_at desc) where parceiro_id is not null;


-- ----------------------------------------------------------------------------
-- PARTE 2 · Quem lê
-- A policy da Trilha (aviso_admin_le) continua como está.
-- ----------------------------------------------------------------------------

drop policy if exists aviso_incorporadora_le on public.aviso;
create policy aviso_incorporadora_le on public.aviso
  for select to authenticated
  using (incorporadora_id is not null and incorporadora_id = public.minha_incorporadora_id());

drop policy if exists aviso_parceiro_le on public.aviso;
create policy aviso_parceiro_le on public.aviso
  for select to authenticated
  using (parceiro_id is not null and parceiro_id = public.meu_parceiro_id());

-- A marca de lido deixa de ser só do admin: cada conta lê as próprias.
-- Escrever continua sendo só pela chave de servidor (a action confere antes).
drop policy if exists aviso_lido_proprio on public.aviso_lido;
create policy aviso_lido_proprio on public.aviso_lido
  for select to authenticated using (conta_id = auth.uid());


-- ----------------------------------------------------------------------------
-- Conferência
-- ----------------------------------------------------------------------------

select 'colunas de destinatário' as o_que,
       case when (select count(*) from information_schema.columns
                   where table_schema = 'public' and table_name = 'aviso'
                     and column_name in ('incorporadora_id', 'parceiro_id')) = 2
            then 'ok' else 'FALTOU' end as situacao
union all
select 'policy ' || p, case when exists (select 1 from pg_policies where tablename = 'aviso' and policyname = p)
                            then 'ok' else 'FALTOU' end
  from unnest(array['aviso_admin_le', 'aviso_incorporadora_le', 'aviso_parceiro_le']) as p
union all
select 'avisos da Trilha (sem destinatário)',
       count(*)::text from public.aviso where incorporadora_id is null and parceiro_id is null;
