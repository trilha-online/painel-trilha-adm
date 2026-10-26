-- ----------------------------------------------------------------------------
-- A conta protegida · out/2026
--
-- Irmão de `admins-trilha.sql`, que criou a tela de administradores. Aquele
-- arquivo garantiu que a Trilha nunca fique SEM admin; este garante que UM
-- admin em particular — o tech@trilha.online — não possa ser derrubado por
-- ninguém que entre pelo painel.
--
-- Por que uma coluna e não o e-mail no código:
--
-- Se a trava procurasse pelo texto 'tech@trilha.online', bastaria trocar o
-- e-mail da conta para destravá-la — e trocar e-mail é operação comum, que a
-- tela já oferece. A marca precisa estar na LINHA, não no conteúdo de um
-- campo que se edita.
--
-- A própria marca é blindada: o gatilho recusa `protegido = false`. Então
-- nem a tela, nem a chave de servidor, nem uma action com bug conseguem
-- desligar a proteção. Só alguém com acesso ao SQL Editor, à mão, de
-- propósito — e aí já é uma decisão tomada, não um clique errado.
--
-- O que a proteção NÃO impede: trocar nome, e-mail de login e senha da conta.
-- Isso continua liberado porque é manutenção legítima do acesso principal.
--
-- Aditivo e seguro de rodar mais de uma vez.
-- ⚠️ Rode `admins-trilha.sql` ANTES deste: a coluna `ativo` vem de lá.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- PARTE 1 · A marca
-- ----------------------------------------------------------------------------

alter table public.conta
  add column if not exists protegido boolean not null default false;

comment on column public.conta.protegido is
  'Conta que nao pode ser desativada, apagada nem ter o tipo trocado pelo painel. Marca o acesso principal da Trilha. A propria coluna e blindada pelo gatilho conta_protegida: so sai disso por SQL manual.';

-- O acesso principal de hoje. Por e-mail apenas AQUI, uma vez — daqui para
-- frente quem manda é a coluna.
update public.conta
   set protegido = true
 where tipo = 'trilha_admin'
   and lower(email) = 'tech@trilha.online'
   and not protegido;


-- ----------------------------------------------------------------------------
-- PARTE 2 · O gatilho
--
-- errcode 23514 de propósito: é o código cuja mensagem o app repassa
-- literalmente para a tela, então a frase daqui é a frase que a pessoa lê.
-- ----------------------------------------------------------------------------

create or replace function public.conta_guarda_protegida()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not old.protegido then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception
      'Esta e a conta principal da Trilha e nao pode ser apagada.'
      using errcode = '23514';
  end if;

  if not new.protegido then
    raise exception
      'A protecao da conta principal da Trilha nao pode ser removida pelo painel.'
      using errcode = '23514';
  end if;

  if not new.ativo then
    raise exception
      'Esta e a conta principal da Trilha e nao pode ser desativada.'
      using errcode = '23514';
  end if;

  if new.tipo is distinct from old.tipo then
    raise exception
      'A conta principal da Trilha tem de continuar sendo administradora.'
      using errcode = '23514';
  end if;

  return new;
end; $$;

-- Dois gatilhos na mesma tabela, de propósito: um cuida de "nunca ficar sem
-- admin" e o outro de "esta conta em particular". Disparam em ordem de nome,
-- então `conta_protegida` vem antes de `conta_ultimo_admin` — e é a mensagem
-- mais específica que a pessoa lê quando as duas se aplicam.
drop trigger if exists conta_protegida on public.conta;
create trigger conta_protegida
  before update or delete on public.conta
  for each row execute function public.conta_guarda_protegida();

comment on function public.conta_guarda_protegida() is
  'Impede apagar, desativar, trocar de tipo ou desproteger uma conta marcada como protegida. Vale tambem para delete no painel do Supabase e para o cascade de auth.users. Trocar nome, email e senha continua liberado.';


-- ----------------------------------------------------------------------------
-- Conferência
-- ----------------------------------------------------------------------------

select 'coluna conta.protegido' as o_que,
       case when exists (
              select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'conta' and column_name = 'protegido'
            ) then 'ok' else 'FALTOU' end as situacao
union all
select 'gatilho conta_protegida',
       case when exists (select 1 from pg_trigger where tgname = 'conta_protegida')
            then 'ok' else 'FALTOU' end
union all
select 'contas protegidas',
       count(*)::text from public.conta where protegido;

-- Deve aparecer o tech@trilha.online, protegido e ativo.
select nome, email, tipo, ativo, protegido
  from public.conta
 where protegido
 order by created_at;
