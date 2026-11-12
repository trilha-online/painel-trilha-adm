-- ----------------------------------------------------------------------------
-- A unidade acompanha o negócio · nov/2026
--
-- O gatilho `negocio_seque_o_checklist` já faz o negócio virar trilha quando
-- a última tarefa fecha, e já gera as parcelas. O que ele NUNCA fez foi mexer
-- no imóvel.
--
-- O efeito ficou invisível porque `em_trilha` só aparece em leitura no
-- sistema — contador, rótulo e lista suspensa. Ninguém nunca escreveu esse
-- status, em lugar nenhum. Resultado: o Ap. 815 está em trilha ativa desde
-- outubro, com 25 parcelas e 2 pagas, marcado como "em negociação"; e o
-- contador "Em Trilha" da tela de empreendimentos é sempre zero.
--
-- Duas partes: o gatilho passa a mover a unidade, e as unidades que já estão
-- em trilha são corrigidas.
--
-- Aditivo e seguro de rodar mais de uma vez.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- PARTE 1 · O gatilho
--
-- Mesma função de antes, com duas linhas a mais. O movimento da unidade é
-- incondicional, igual ao do negócio logo acima dele: se a última tarefa
-- fechou, a unidade ESTÁ em trilha — não é preferência, é fato. E se uma
-- tarefa for reaberta, ela volta a ser negociação pelo mesmo motivo.
--
-- É também o que `cancelar_negocio()` já faz: manda a unidade para o destino
-- sem perguntar em que estado ela estava.
-- ----------------------------------------------------------------------------

create or replace function public.negocio_seque_o_checklist()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_falta   boolean;
  v_status  public.negocio_status;
  v_imovel  uuid;
begin
  select status, imovel_id into v_status, v_imovel
    from public.negocio where id = new.negocio_id;

  if v_status not in ('em_fechamento', 'em_jornada') then return null; end if;

  select exists (
    select 1 from public.checklist_item i
    where i.negocio_id = new.negocio_id and i.status not in ('concluido', 'nao_se_aplica')
  ) into v_falta;

  if not v_falta and v_status = 'em_fechamento' then
    update public.negocio
       set status = 'em_jornada', jornada_inicio = coalesce(jornada_inicio, now())
     where id = new.negocio_id;

    update public.imovel set status = 'em_trilha' where id = v_imovel;

    perform public.gerar_parcelas(new.negocio_id);

  elsif v_falta and v_status = 'em_jornada' then
    update public.negocio set status = 'em_fechamento' where id = new.negocio_id;

    update public.imovel set status = 'em_negociacao' where id = v_imovel;
  end if;

  return null;
end; $$;

comment on function public.negocio_seque_o_checklist() is
  'Fechou a ultima tarefa: o negocio vira trilha, a unidade vai para em_trilha e as parcelas sao geradas. Reabriu uma tarefa: os dois voltam. Sem delete de proposito — num AFTER DELETE o new e nulo.';


-- ----------------------------------------------------------------------------
-- PARTE 2 · Arrumar o que já está no ar
--
-- Toda unidade de negócio que já passou do fechamento e não está marcada
-- como em trilha. `em_quitacao` e `quitado` entram junto: são estágios
-- DEPOIS da jornada, e a unidade segue sendo da Trilha.
--
-- `cancelado` fica de fora: lá a unidade já foi para o destino que a Trilha
-- escolheu no cancelamento, e não se mexe nisso.
-- ----------------------------------------------------------------------------

update public.imovel i
   set status = 'em_trilha'
  from public.negocio n
 where n.imovel_id = i.id
   and n.status in ('em_jornada', 'em_quitacao', 'quitado')
   and i.status <> 'em_trilha';


-- ----------------------------------------------------------------------------
-- Conferência
-- ----------------------------------------------------------------------------

select 'gatilho move a unidade' as o_que,
       case when pg_get_functiondef('public.negocio_seque_o_checklist()'::regprocedure) like '%em_trilha%'
            then 'ok' else 'FALTOU' end as situacao
union all
select 'unidade em trilha fora de em_trilha (tem que ser 0)',
       count(*)::text
  from public.imovel i join public.negocio n on n.imovel_id = i.id
 where n.status in ('em_jornada', 'em_quitacao', 'quitado') and i.status <> 'em_trilha'
union all
select 'unidades por status',
       status || ': ' || count(*) from public.imovel group by status;

-- Cada negócio vivo com a situação da unidade dele. As duas colunas têm de
-- contar a mesma história.
select n.status as negocio, i.identificacao, i.status as unidade, e.nome as empreendimento
  from public.negocio n
  join public.imovel i on i.id = n.imovel_id
  join public.empreendimento e on e.id = i.empreendimento_id
 where n.status <> 'cancelado'
 order by n.status, e.nome, i.identificacao;
