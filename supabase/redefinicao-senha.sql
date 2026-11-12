-- ----------------------------------------------------------------------------
-- Redefinição de senha pelo próprio usuário · nov/2026
--
-- Até aqui, quem esquecia a senha dependia da Trilha trocá-la na ficha de
-- acesso. Agora a pessoa pede na tela de login ("Esqueci minha senha") e
-- recebe um link no WhatsApp do cadastro — o mesmo caminho do convite de
-- primeiro acesso. Decisão da Elena (12/nov): WhatsApp, não e-mail; o painel
-- não tem provedor de e-mail.
--
-- Esta tabela guarda os pedidos. Três regras moram nela:
--
--   1. O TOKEN NUNCA É GRAVADO, só o hash (sha256). Quem lê o banco — um
--      admin, um backup, um dump — não consegue montar o link e entrar na
--      conta de ninguém. Pelo mesmo motivo o link NÃO passa pela fila
--      `mensagem`: ali o texto fica gravado e legível para a Trilha.
--   2. VALE UMA VEZ E POR POUCO TEMPO: `expira_em` (1 hora, decidido no app)
--      e `usado_em`. Só o pedido MAIS RECENTE de cada conta vale: pedir de
--      novo mata o link anterior sem apagar o histórico, que é o que limita
--      quantos pedidos cabem por hora.
--   3. NINGUÉM ALCANÇA PELA SESSÃO. RLS ligado e nenhuma policy: só a chave de
--      servidor lê e escreve, nas actions de `app/actions/senha.ts`.
--
-- Aditivo e seguro de rodar mais de uma vez.
-- ----------------------------------------------------------------------------

create table if not exists public.redefinicao_senha (
  id          uuid primary key default gen_random_uuid(),
  conta_id    uuid not null references public.conta (id) on delete cascade,
  token_hash  text not null unique,
  expira_em   timestamptz not null,
  usado_em    timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists redefinicao_senha_conta_idx
  on public.redefinicao_senha (conta_id, created_at desc);

comment on table public.redefinicao_senha is
  'Pedidos de senha nova ("Esqueci minha senha"). Guarda so o hash do token. Vale uma vez, por pouco tempo, e so o pedido mais recente da conta. Sem policy: so a chave de servidor.';
comment on column public.redefinicao_senha.token_hash is
  'sha256 do token que vai no link. O token em si nao e gravado em lugar nenhum.';
comment on column public.redefinicao_senha.usado_em is
  'Quando a senha nova foi definida com este link. Preenchido = link queimado.';

alter table public.redefinicao_senha enable row level security;

-- O Supabase dá permissão de tabela para `anon` e `authenticated` por padrão.
-- Sem policy o RLS já barra, mas tirar a permissão fecha a porta duas vezes:
-- se alguém criar uma policy por engano um dia, ela não vale sozinha.
revoke all on public.redefinicao_senha from anon, authenticated;


-- ----------------------------------------------------------------------------
-- Conferência
-- ----------------------------------------------------------------------------

select 'tabela redefinicao_senha' as o_que,
       case when to_regclass('public.redefinicao_senha') is not null then 'ok' else 'FALTOU' end as situacao
union all
select 'RLS ligado',
       case when (select relrowsecurity from pg_class where oid = 'public.redefinicao_senha'::regclass)
            then 'ok' else 'FALTOU' end
union all
select 'policies (tem que ser 0)',
       count(*)::text from pg_policy where polrelid = 'public.redefinicao_senha'::regclass
union all
select 'authenticated sem acesso',
       case when has_table_privilege('authenticated', 'public.redefinicao_senha', 'select')
            then 'AINDA LÊ' else 'ok' end
union all
select 'anon sem acesso',
       case when has_table_privilege('anon', 'public.redefinicao_senha', 'select')
            then 'AINDA LÊ' else 'ok' end;
