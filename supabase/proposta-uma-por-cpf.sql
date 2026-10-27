-- ----------------------------------------------------------------------------
-- Uma proposta aberta por CPF · out/2026
--
-- Regra decidida pelo Matheus em 27/out: enquanto um comprador tiver proposta
-- ABERTA, o simulador não aceita outra para o mesmo CPF — de nenhum corretor.
--
--   aberta  = enviada · em_analise · aceita (aceita é negócio andando)
--   libera  = recusada · invalidada · cancelada
--
-- A Trilha passa por cima: proposta com origem = 'trilha' (negociação aberta
-- pelo painel) não é barrada. Serve, por exemplo, para o comprador que quer
-- uma segunda unidade.
--
-- Por que gatilho e não índice único parcial: o índice barraria também a
-- proposta da Trilha, e a exceção é parte da regra.
--
-- Por que a trava mora no banco, se a action também confere: a action dá a
-- mensagem amigável antes de cadastrar corretor e mandar convite; o banco é
-- quem garante. Dois envios ao mesmo tempo para o mesmo CPF passam juntos
-- pela conferência da action — aqui não, porque o gatilho tranca a linha do
-- comprador e o segundo espera o primeiro terminar.
--
-- errcode TRL01: código próprio, para a action reconhecer este caso sem
-- confundir com o 23505 (unidade já negociada).
--
-- Aditivo e seguro de rodar mais de uma vez. Não mexe em proposta existente.
-- ----------------------------------------------------------------------------

create or replace function public.comprador_tem_proposta_aberta(p_comprador uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.proposta
     where comprador_id = p_comprador
       and status in ('enviada', 'em_analise', 'aceita')
  );
$$;

comment on function public.comprador_tem_proposta_aberta(uuid) is
  'O comprador tem proposta enviada, em análise ou aceita? Recusada, invalidada e cancelada não contam.';

-- Só o servidor pergunta isso; ninguém de fora precisa saber se um CPF tem
-- proposta.
revoke all on function public.comprador_tem_proposta_aberta(uuid) from public, anon, authenticated;
grant execute on function public.comprador_tem_proposta_aberta(uuid) to service_role;


create or replace function public.proposta_trava_cpf()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.origem = 'trilha' then
    return new;
  end if;

  -- Tranca o comprador até o fim da transação: dois envios simultâneos para
  -- o mesmo CPF passam a acontecer um depois do outro, e o segundo enxerga a
  -- proposta do primeiro.
  perform 1 from public.comprador where id = new.comprador_id for update;

  if public.comprador_tem_proposta_aberta(new.comprador_id) then
    raise exception 'Já existe uma proposta em análise para este CPF. Aguarde a resposta da Trilha ou fale com a equipe.'
      using errcode = 'TRL01';
  end if;

  return new;
end; $$;

drop trigger if exists proposta_trava_cpf on public.proposta;
create trigger proposta_trava_cpf
  before insert on public.proposta
  for each row execute function public.proposta_trava_cpf();

comment on function public.proposta_trava_cpf() is
  'Recusa proposta do simulador para comprador que já tem proposta aberta. Proposta da Trilha (origem trilha) passa.';


-- ----------------------------------------------------------------------------
-- Conferência
-- ----------------------------------------------------------------------------

select 'função comprador_tem_proposta_aberta' as o_que,
       case when exists (select 1 from pg_proc where proname = 'comprador_tem_proposta_aberta')
            then 'ok' else 'FALTOU' end as situacao
union all
select 'gatilho proposta_trava_cpf',
       case when exists (select 1 from pg_trigger where tgname = 'proposta_trava_cpf')
            then 'ok' else 'FALTOU' end;

-- Informativo: CPFs que JÁ têm mais de uma proposta aberta (de antes da
-- regra). O gatilho não mexe nelas; só impede a próxima. Vazio é o esperado.
select c.nome, c.cpf, count(*) as propostas_abertas
  from public.proposta p
  join public.comprador c on c.id = p.comprador_id
 where p.status in ('enviada', 'em_analise', 'aceita')
 group by c.id, c.nome, c.cpf
having count(*) > 1
 order by count(*) desc;
