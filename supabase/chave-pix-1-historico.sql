-- ----------------------------------------------------------------------------
-- Troca de chave Pix · ciclo 1 · out/2026
--
-- Decidido com o Matheus em 27/out: a incorporadora pode trocar chaves Pix
-- (a dela e a dos corretores dela), mas TODA troca é avisada. Este arquivo é a
-- base: cada troca vira uma linha de histórico e um aviso no sino da Trilha.
-- Os próximos ciclos leem o mesmo histórico para avisar o dono da chave por
-- WhatsApp (ciclo 2) e no sino dele (ciclo 3).
--
-- Por que no banco e não na action: a chave mora em três lugares e é gravada
-- por quatro telas (perfil da incorporadora, cadastro pela Trilha, ficha do
-- vendedor PF, parceiro). Um gatilho pega todas — e também a edição direta no
-- painel do Supabase, que nenhuma action veria.
--
-- Onde a chave mora:
--   incorporadora.chave_pix   incorporadora e proprietário PF (cadastro)
--   parceiro.chave_pix        corretor e Parceiro Trilha
--   ficha_vendedor.chave_pix  o PF no negócio — é ESTA que o repasse usa para
--                             o vendedor PF (`chave_pix_do_lote`)
--
-- Quem trocou: `auth.uid()`. Todas as telas que mexem em chave gravam pela
-- sessão, então o banco sabe quem é. Nulo = SQL manual ou chave de servidor.
--
-- Cadastro NOVO não é troca: só UPDATE (e a ficha do vendedor, que nasce no
-- fechamento e é comparada com o cadastro do PF naquele momento).
--
-- Aditivo e seguro de rodar mais de uma vez.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- PARTE 1 · O histórico
-- ----------------------------------------------------------------------------

create table if not exists public.chave_pix_alteracao (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),

  -- De quem é a chave. Proprietário PF é `incorporadora` (mesma tabela).
  dono_tipo             text not null check (dono_tipo in ('incorporadora', 'parceiro')),
  incorporadora_id      uuid references public.incorporadora (id) on delete cascade,
  parceiro_id           uuid references public.parceiro (id) on delete cascade,

  -- Em qual tabela a troca aconteceu.
  origem                text not null check (origem in ('incorporadora', 'parceiro', 'ficha_vendedor')),
  negocio_id            uuid references public.negocio (id) on delete set null,

  chave_antiga          text,
  chave_nova            text,
  tipo_antigo           text,
  tipo_novo             text,

  alterado_por          uuid references public.conta (id) on delete set null,
  -- O papel no momento da troca: se a conta mudar de tipo depois, o histórico
  -- continua dizendo quem a pessoa era quando trocou.
  alterado_por_papel    text not null
                          check (alterado_por_papel in ('trilha', 'incorporadora', 'parceiro', 'sistema')),

  constraint chave_pix_alteracao_dono check (
    (dono_tipo = 'incorporadora' and incorporadora_id is not null and parceiro_id is null)
    or (dono_tipo = 'parceiro' and parceiro_id is not null and incorporadora_id is null)
  )
);

comment on table public.chave_pix_alteracao is
  'Toda troca de chave Pix (incorporadora, proprietário PF, corretor), gravada por gatilho. Base dos avisos de troca de chave.';

create index if not exists chave_pix_alteracao_incorporadora_idx
  on public.chave_pix_alteracao (incorporadora_id, created_at desc) where incorporadora_id is not null;
create index if not exists chave_pix_alteracao_parceiro_idx
  on public.chave_pix_alteracao (parceiro_id, created_at desc) where parceiro_id is not null;

alter table public.chave_pix_alteracao enable row level security;

-- Só leitura, e só a Trilha por enquanto (o dono passa a ler no ciclo 3).
-- Ninguém escreve pela sessão: quem grava é o gatilho.
revoke all on public.chave_pix_alteracao from anon, authenticated;
grant select on public.chave_pix_alteracao to authenticated;
grant all    on public.chave_pix_alteracao to service_role;

drop policy if exists chave_pix_alteracao_admin_le on public.chave_pix_alteracao;
create policy chave_pix_alteracao_admin_le on public.chave_pix_alteracao
  for select to authenticated using (public.eh_admin_trilha());


-- ----------------------------------------------------------------------------
-- PARTE 2 · Registrar a troca e avisar a Trilha
--
-- Uma função só para as três tabelas. A ficha do vendedor e o cadastro do PF
-- costumam mudar no MESMO salvar (a ficha atualiza o cadastro): o histórico
-- ganha duas linhas, que são dois fatos, mas o sino ganha UM aviso — a chave
-- do aviso é a mesma troca (dono + antes → depois + dia).
-- ----------------------------------------------------------------------------

create or replace function public.registrar_troca_chave_pix(
  p_dono_tipo     text,
  p_dono_id       uuid,
  p_origem        text,
  p_negocio_id    uuid,
  p_antiga        text,
  p_nova          text,
  p_tipo_antigo   text,
  p_tipo_novo     text
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_quem        uuid := auth.uid();
  v_quem_nome   text;
  v_papel       text;
  v_rotulo      text;   -- como o papel aparece no texto ("proprietário" em vez de "incorporadora")
  v_dono_nome   text;
  v_link        text;
  v_quando      text := to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI');
begin
  select c.nome,
         case c.tipo when 'trilha_admin' then 'trilha' else c.tipo::text end
    into v_quem_nome, v_papel
    from public.conta c where c.id = v_quem;
  v_papel := coalesce(v_papel, 'sistema');

  -- O proprietário PF tem conta do tipo incorporadora; no texto, ele é proprietário.
  v_rotulo := case
    when v_papel = 'incorporadora' and exists (
           select 1 from public.incorporadora i where i.conta_id = v_quem and i.tipo = 'proprietario_pf')
      then 'proprietário'
    when v_papel = 'parceiro' then 'corretor'
    else v_papel
  end;

  if p_dono_tipo = 'incorporadora' then
    select i.nome,
           case i.tipo when 'proprietario_pf' then '/proprietarios/' else '/incorporadoras/' end || i.id
      into v_dono_nome, v_link
      from public.incorporadora i where i.id = p_dono_id;
  else
    select p.nome, '/parceiros/' || p.id
      into v_dono_nome, v_link
      from public.parceiro p where p.id = p_dono_id;
  end if;

  insert into public.chave_pix_alteracao (
    dono_tipo, incorporadora_id, parceiro_id, origem, negocio_id,
    chave_antiga, chave_nova, tipo_antigo, tipo_novo, alterado_por, alterado_por_papel
  ) values (
    p_dono_tipo,
    case when p_dono_tipo = 'incorporadora' then p_dono_id end,
    case when p_dono_tipo = 'parceiro'      then p_dono_id end,
    p_origem, p_negocio_id,
    p_antiga, p_nova, p_tipo_antigo, p_tipo_novo, v_quem, v_papel
  );

  insert into public.aviso (chave, tipo, gravidade, titulo, texto, link)
  values (
    'pix:' || p_dono_tipo || ':' || p_dono_id || ':'
      || md5(coalesce(p_antiga, '') || '>' || coalesce(p_nova, '')) || ':'
      || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
    'chave_pix',
    -- Troca feita pela própria Trilha é informação; feita por outro, atenção.
    case when v_papel = 'trilha' then 'info' else 'atencao' end,
    'Chave Pix alterada: ' || coalesce(v_dono_nome, 'cadastro sem nome'),
    'De ' || coalesce(p_antiga || coalesce(' (' || p_tipo_antigo || ')', ''), 'sem chave')
      || ' para ' || coalesce(p_nova || coalesce(' (' || p_tipo_novo || ')', ''), 'sem chave') || '.'
      || E'\nAlterada ' || coalesce('por ' || v_quem_nome || ' (' || v_rotulo || ')', 'fora do painel') || ' em ' || v_quando || '.'
      || E'\nConfira antes do próximo repasse.',
    v_link
  )
  on conflict (chave) do nothing;
end; $$;

comment on function public.registrar_troca_chave_pix(text, uuid, text, uuid, text, text, text, text) is
  'Grava a troca de chave Pix no histórico e avisa a Trilha no sino. Chamada só pelos gatilhos de troca de chave.';

revoke all on function public.registrar_troca_chave_pix(text, uuid, text, uuid, text, text, text, text)
  from public, anon, authenticated;


-- Texto em branco e nulo são a mesma coisa: "sem chave".
create or replace function public.chave_pix_normalizada(p text)
returns text language sql immutable as $$
  select nullif(btrim(p), '');
$$;


-- ---- incorporadora e proprietário PF ---------------------------------------

create or replace function public.incorporadora_troca_chave_pix()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.chave_pix_normalizada(old.chave_pix) is distinct from public.chave_pix_normalizada(new.chave_pix)
     or old.chave_pix_tipo is distinct from new.chave_pix_tipo then
    perform public.registrar_troca_chave_pix(
      'incorporadora', new.id, 'incorporadora', null,
      public.chave_pix_normalizada(old.chave_pix), public.chave_pix_normalizada(new.chave_pix),
      old.chave_pix_tipo::text, new.chave_pix_tipo::text
    );
  end if;
  return new;
end; $$;

drop trigger if exists incorporadora_troca_chave_pix on public.incorporadora;
create trigger incorporadora_troca_chave_pix
  after update of chave_pix, chave_pix_tipo on public.incorporadora
  for each row execute function public.incorporadora_troca_chave_pix();


-- ---- corretor e Parceiro Trilha --------------------------------------------

create or replace function public.parceiro_troca_chave_pix()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.chave_pix_normalizada(old.chave_pix) is distinct from public.chave_pix_normalizada(new.chave_pix)
     or old.chave_pix_tipo is distinct from new.chave_pix_tipo then
    perform public.registrar_troca_chave_pix(
      'parceiro', new.id, 'parceiro', null,
      public.chave_pix_normalizada(old.chave_pix), public.chave_pix_normalizada(new.chave_pix),
      old.chave_pix_tipo::text, new.chave_pix_tipo::text
    );
  end if;
  return new;
end; $$;

drop trigger if exists parceiro_troca_chave_pix on public.parceiro;
create trigger parceiro_troca_chave_pix
  after update of chave_pix, chave_pix_tipo on public.parceiro
  for each row execute function public.parceiro_troca_chave_pix();


-- ---- ficha do vendedor PF (a chave que o repasse usa) ----------------------
-- Na criação, compara com o cadastro do PF: a ficha nasce no fechamento e,
-- se vier com chave diferente da cadastrada, o repasse vai para outra conta.

create or replace function public.ficha_vendedor_troca_chave_pix()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_pf        uuid;
  v_antiga    text;
begin
  select n.incorporadora_id into v_pf from public.negocio n where n.id = new.negocio_id;
  if v_pf is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    select public.chave_pix_normalizada(i.chave_pix) into v_antiga
      from public.incorporadora i where i.id = v_pf;
  else
    v_antiga := public.chave_pix_normalizada(old.chave_pix);
  end if;

  if v_antiga is distinct from public.chave_pix_normalizada(new.chave_pix) then
    perform public.registrar_troca_chave_pix(
      'incorporadora', v_pf, 'ficha_vendedor', new.negocio_id,
      v_antiga, public.chave_pix_normalizada(new.chave_pix), null, null
    );
  end if;
  return new;
end; $$;

drop trigger if exists ficha_vendedor_troca_chave_pix on public.ficha_vendedor;
create trigger ficha_vendedor_troca_chave_pix
  after insert or update of chave_pix on public.ficha_vendedor
  for each row execute function public.ficha_vendedor_troca_chave_pix();


-- ----------------------------------------------------------------------------
-- Conferência
-- ----------------------------------------------------------------------------

select 'tabela chave_pix_alteracao' as o_que,
       case when to_regclass('public.chave_pix_alteracao') is not null then 'ok' else 'FALTOU' end as situacao
union all
select 'gatilho ' || g, case when exists (select 1 from pg_trigger where tgname = g) then 'ok' else 'FALTOU' end
  from unnest(array['incorporadora_troca_chave_pix', 'parceiro_troca_chave_pix', 'ficha_vendedor_troca_chave_pix']) as g
union all
select 'trocas registradas até agora', count(*)::text from public.chave_pix_alteracao;
