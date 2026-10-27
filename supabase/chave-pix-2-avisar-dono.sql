-- ----------------------------------------------------------------------------
-- Troca de chave Pix · ciclo 2 · out/2026
--
-- O dono da chave passa a ser avisado por WhatsApp quando a chave dele muda
-- (ciclo 1 avisava só a Trilha, no sino). Quem manda é o código
-- (`lib/chave-pix.ts`), porque os textos moram em `lib/notificacoes.ts`; o
-- banco só guarda se o dono já foi avisado daquela troca.
--
-- Um arquivo curto de propósito: uma coluna e um índice.
--
-- As trocas que JÁ existem (as do teste do ciclo 1) são dadas como avisadas,
-- para a primeira rotina não disparar WhatsApp sobre troca antiga.
--
-- Aditivo e seguro de rodar mais de uma vez.
-- ⚠️ Rode `chave-pix-1-historico.sql` antes: a tabela vem de lá.
-- ----------------------------------------------------------------------------

alter table public.chave_pix_alteracao
  add column if not exists dono_avisado_em timestamptz;

comment on column public.chave_pix_alteracao.dono_avisado_em is
  'Quando o dono da chave foi avisado (WhatsApp enfileirado). Nulo = ainda falta avisar. Preenchido também quando não há telefone para avisar.';

create index if not exists chave_pix_alteracao_dono_pendente_idx
  on public.chave_pix_alteracao (created_at)
  where dono_avisado_em is null;

-- Só na primeira vez que este arquivo roda: depois disso, toda troca nova
-- nasce com a coluna nula e espera o aviso. A marca é a própria ausência de
-- linhas avisadas — rodar de novo não apaga a fila de quem ainda falta avisar.
update public.chave_pix_alteracao
   set dono_avisado_em = created_at
 where dono_avisado_em is null
   and not exists (select 1 from public.chave_pix_alteracao where dono_avisado_em is not null);


-- ----------------------------------------------------------------------------
-- Conferência
-- ----------------------------------------------------------------------------

select 'coluna dono_avisado_em' as o_que,
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'chave_pix_alteracao'
                            and column_name = 'dono_avisado_em')
            then 'ok' else 'FALTOU' end as situacao
union all
select 'trocas esperando aviso ao dono (0 na primeira vez que roda)',
       count(*)::text from public.chave_pix_alteracao where dono_avisado_em is null;
