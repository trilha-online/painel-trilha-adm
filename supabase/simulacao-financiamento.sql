-- ----------------------------------------------------------------------------
-- Simulação de financiamento e aprovação de crédito · nov/2026
-- ----------------------------------------------------------------------------
-- Rode DEPOIS de todas as anteriores. Rodar inteiro no SQL Editor.
--
-- Um documento novo do comprador: a simulação que o banco faz para quem vai
-- financiar o saldo no fim da Trilha, com as condições aproximadas de
-- pagamento (e a aprovação de crédito, quando houver).
--
-- DECIDIDO COM A ELENA (4/nov):
--
--   * É DOCUMENTO DO COMPRADOR, na etapa "Documentação do comprador", como
--     os outros. Por isso `ator = 'parceiro'`, o que já traz junto tudo o que
--     vale para os documentos do comprador, sem regra nova:
--       - anexa o corretor principal do negócio OU a Trilha
--         (`pode_escrever_arquivo_tarefa`); na venda direta aparece "Trilha";
--       - a incorporadora vê que foi entregue, mas não abre o arquivo
--         (`pode_ler_arquivo_tarefa`); o corretor observador também não;
--       - o primeiro anexo conclui, aceita vários arquivos, remover o último
--         reabre (`arquivo_move_documento`); cada anexo marca comprador/cônjuge.
--   * Formatos: os do bucket `fechamento`, iguais aos outros documentos —
--     PDF, JPG e PNG (e também WEBP/HEIC, para foto de celular). Até 10 MB
--     por arquivo; foto grande é comprimida no navegador antes de subir.
--   * Sem validade e não interna (o comprador vê a tarefa na página dele).
--   * `pede_conjuge = false`: com cônjuge na ficha, o grupo "Cônjuge" aparece
--     como "opcional", não como "falta anexar" — a simulação costuma sair
--     num documento só para o casal.
--   * Entra também nos negócios EM FECHAMENTO hoje (pendente).
--
-- ⚠️ NÃO entra em negócio que já virou trilha (`em_jornada` em diante). O
-- gatilho `checklist_item_fecha_negocio` devolve para `em_fechamento` todo
-- negócio em jornada que ganhar tarefa pendente — inserir ali desmancharia
-- uma trilha com parcelas correndo. Cancelado também fica de fora.
--
-- Num negócio em fechamento que já passou do nível 1, a tarefa nova reabre o
-- nível 1: as tarefas pendentes dos níveis seguintes voltam a aparecer como
-- "Libera depois de…" até alguém anexar a simulação ou a Trilha dispensar a
-- tarefa (Não se aplica, com motivo). Nada já concluído é desfeito, e nenhum
-- WhatsApp de nível é reenviado (`nivel_avisado` só avança).
--
-- `aceitar_proposta` NÃO precisa mudar: ela já copia da receita todas as
-- colunas (`instrucoes`, `pede_conjuge` inclusive) de toda linha ativa sem
-- `vendedor`, que é o caso desta.
--
-- Pode rodar mais de uma vez sem duplicar nada.
-- ----------------------------------------------------------------------------


-- ----------------------------------------------------------------------------
-- PARTE 1 · A receita (vale para todo negócio novo)
-- ----------------------------------------------------------------------------
-- Ordem 7: última da etapa, depois do Extrato do Banco Central.

insert into public.checklist_modelo
  (etapa, etapa_ordem, ordem, titulo, ator, tipo, exige_validade, interna, pede_conjuge, instrucoes)
values
  ('Documentação do comprador', 1, 7, 'Simulação de financiamento e aprovação de crédito',
   'parceiro', 'documento', false, false, false,
   'Simulação feita no banco em que o comprador pretende financiar o saldo no fim da Trilha, com as condições aproximadas de pagamento. Se já houver aprovação de crédito, anexe também. Aceita PDF, JPG ou PNG, mais de um arquivo.')
on conflict (etapa, titulo) do nothing;


-- ----------------------------------------------------------------------------
-- PARTE 2 · Os negócios em fechamento hoje
-- ----------------------------------------------------------------------------

insert into public.checklist_item
  (negocio_id, etapa, etapa_ordem, ordem, titulo, ator, tipo, exige_validade, interna,
   instrucoes, pede_conjuge)
select n.id, m.etapa, m.etapa_ordem, m.ordem, m.titulo, m.ator, m.tipo,
       m.exige_validade, m.interna, m.instrucoes, m.pede_conjuge
from public.negocio n
cross join public.checklist_modelo m
where n.status = 'em_fechamento'
  and m.etapa  = 'Documentação do comprador'
  and m.titulo = 'Simulação de financiamento e aprovação de crédito'
  and m.ativo
  and not exists (
    select 1 from public.checklist_item i
    where i.negocio_id = n.id
      and i.etapa  = m.etapa
      and i.titulo = m.titulo
  );


-- ----------------------------------------------------------------------------
-- Conferência
-- ----------------------------------------------------------------------------

select 'tarefa na receita' as item,
       (select count(*)::text from public.checklist_modelo
         where etapa = 'Documentação do comprador'
           and titulo = 'Simulação de financiamento e aprovação de crédito') || ' de 1' as situacao
union all
select 'negócios em fechamento com a tarefa',
       (select count(distinct i.negocio_id)::text from public.checklist_item i
          join public.negocio n on n.id = i.negocio_id
         where n.status = 'em_fechamento'
           and i.titulo = 'Simulação de financiamento e aprovação de crédito')
       || ' de ' ||
       (select count(*)::text from public.negocio where status = 'em_fechamento')
union all
-- Na primeira rodada tem que dar 0. Depois, pode crescer de forma legítima:
-- negócio novo que nasceu com a tarefa, concluiu e virou trilha.
select 'trilhas (em jornada em diante) com a tarefa',
       (select count(distinct i.negocio_id)::text from public.checklist_item i
          join public.negocio n on n.id = i.negocio_id
         where n.status in ('em_jornada', 'em_quitacao', 'quitado')
           and i.titulo = 'Simulação de financiamento e aprovação de crédito');
