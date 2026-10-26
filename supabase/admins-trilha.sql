-- ----------------------------------------------------------------------------
-- Administradores da Trilha · out/2026
--
-- Hoje existe um admin só (tech@trilha.online) e ele nasceu de um insert
-- manual. Isto abre a porta para cadastrar os sócios pelo painel.
--
-- O que muda no banco é pequeno de propósito: ser admin JÁ É uma linha em
-- `conta` com tipo = 'trilha_admin'. Não há tabela nova, não há papel novo.
-- Falta só poder DESLIGAR um acesso sem apagar o histórico de quem fez o quê.
--
-- Três partes:
--   1. a coluna `ativo` na conta
--   2. `eh_admin_trilha()` passa a exigir `ativo` — é aqui que o desligamento
--      pega efeito, no banco, para todas as policies de uma vez
--   3. uma trava para a Trilha nunca ficar sem nenhum admin ativo
--
-- Aditivo e seguro de rodar mais de uma vez.
--
-- ⚠️ ORDEM IMPORTA: rode este SQL ANTES de publicar o código novo. O app
-- passa a ler a coluna `ativo` na consulta da sessão; publicar primeiro faria
-- toda consulta de sessão falhar e ninguém entraria.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- PARTE 1 · A coluna
-- ----------------------------------------------------------------------------

alter table public.conta
  add column if not exists ativo boolean not null default true;

comment on column public.conta.ativo is
  'Acesso ligado. Por enquanto só é CONFERIDO para admin da Trilha, em eh_admin_trilha(): o parceiro tem o próprio parceiro.ativo e a incorporadora não tem desligamento. Nasce true, inclusive nas contas que já existiam.';


-- ----------------------------------------------------------------------------
-- PARTE 2 · Desativar passa a valer no banco
--
-- `eh_admin_trilha()` é a função mais usada do sistema: quase toda policy de
-- RLS chama ela. Acrescentar `and ativo` aqui desliga o admin em TODAS as
-- tabelas de uma vez — não existe tela esquecida, porque não é a tela que
-- decide. Por isso o desligamento mora nesta função e não no código.
-- ----------------------------------------------------------------------------

create or replace function public.eh_admin_trilha()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conta
    where id = auth.uid() and tipo = 'trilha_admin' and ativo
  );
$$;

comment on function public.eh_admin_trilha() is
  'Quem pergunta é admin ativo da Trilha? Exige ativo desde out/2026: desmarcar a coluna tira o acesso em todas as policies ao mesmo tempo.';


-- ----------------------------------------------------------------------------
-- PARTE 3 · Nunca ficar sem admin
--
-- Perder a condição de admin ativo acontece de três jeitos — trocar o tipo,
-- desmarcar `ativo` e apagar a linha — e os três passam por este gatilho. A
-- trava fica no BANCO, não na action, porque a conta também pode ser mexida
-- pelo painel do Supabase e pelo cascade de auth.users.
--
-- errcode 23514 de propósito: é o código que o app repassa literalmente para
-- a tela, então a frase daqui é a frase que a pessoa lê.
-- ----------------------------------------------------------------------------

create or replace function public.conta_guarda_ultimo_admin()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_perdeu    boolean;
  v_restantes integer;
begin
  if tg_op = 'DELETE' then
    v_perdeu := old.tipo = 'trilha_admin' and old.ativo;
  else
    v_perdeu := (old.tipo = 'trilha_admin' and old.ativo)
            and not (new.tipo = 'trilha_admin' and new.ativo);
  end if;

  if v_perdeu then
    select count(*) into v_restantes
      from public.conta
     where tipo = 'trilha_admin' and ativo and id <> old.id;

    if v_restantes = 0 then
      raise exception
        'Este e o unico administrador ativo da Trilha. Cadastre outro antes de desativar ou remover este.'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end; $$;

drop trigger if exists conta_ultimo_admin on public.conta;
create trigger conta_ultimo_admin
  before update or delete on public.conta
  for each row execute function public.conta_guarda_ultimo_admin();

comment on function public.conta_guarda_ultimo_admin() is
  'Impede que a ultima conta de admin ativo seja desativada, trocada de tipo ou apagada. Vale tambem para delete feito no painel do Supabase e para o cascade de auth.users.';


-- ----------------------------------------------------------------------------
-- Conferência
-- ----------------------------------------------------------------------------

select 'coluna conta.ativo' as o_que,
       case when exists (
              select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'conta' and column_name = 'ativo'
            ) then 'ok' else 'FALTOU' end as situacao
union all
select 'eh_admin_trilha() exige ativo',
       case when pg_get_functiondef('public.eh_admin_trilha()'::regprocedure) like '%ativo%'
            then 'ok' else 'FALTOU' end
union all
select 'trava do ultimo admin',
       case when exists (select 1 from pg_trigger where tgname = 'conta_ultimo_admin')
            then 'ok' else 'FALTOU' end
union all
select 'admins ativos agora',
       count(*)::text from public.conta where tipo = 'trilha_admin' and ativo;

-- Quem é admin hoje. Todos devem aparecer com ativo = true.
select nome, email, ativo, created_at
  from public.conta
 where tipo = 'trilha_admin'
 order by created_at;
