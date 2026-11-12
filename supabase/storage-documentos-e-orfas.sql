-- ----------------------------------------------------------------------------
-- O bucket `documentos` e as funções órfãs · nov/2026
--
-- Uma auditoria comparou o banco de produção com os arquivos desta pasta e
-- achou coisas que existem só lá: três policies no bucket `documentos` e seis
-- funções. Nenhum arquivo daqui as cria.
--
-- São restos do PRIMEIRO desenho do sistema, de antes do schema atual. Elas
-- falam de tabelas que nunca existiram neste banco — `parte`, `pessoa`,
-- `tarefa` — e foram escritas direto no painel do Supabase. O schema foi
-- refeito, as tabelas ficaram com outros nomes, e ninguém voltou para limpar.
--
-- O estado de cada uma:
--
--   is_admin_trilha()         QUEBRADA. Compara conta.tipo com 'admin_trilha';
--                             o valor do enum é 'trilha_admin'. As palavras
--                             estão trocadas, então ela nem devolve false:
--                             levanta "invalid input value for enum".
--   participa_negocio(uuid)   QUEBRADA. Consulta a tabela `parte`, que não
--                             existe. Chama a de cima, que também estoura.
--   progresso_negocio(uuid)   QUEBRADA. Consulta a tabela `tarefa`.
--   sou_responsavel_pessoa()  QUEBRADA. Consulta a tabela `parte`.
--   minha_incorporadora()     FUNCIONA — e é a mais perigosa das seis. É uma
--                             cópia de `minha_incorporadora_id()` SEM o
--                             `and ativo`. Qualquer policy futura que a use
--                             por engano desfaz, em silêncio, a regra de
--                             vendedor desativado.
--   valor_projetado()         FUNCIONA — e é uma SEGUNDA fórmula do reajuste
--                             de 0,42%. O sistema tem uma conta só, em
--                             `src/lib/pagamento.ts`, com espelho na coluna
--                             gerada `imovel.valor_reajustado`. Uma terceira
--                             cópia esquecida num canto do banco é como as
--                             três deixam de bater.
--
-- As duas quebradas que ESTÃO EM USO guardam o bucket da minuta. Hoje não
-- aparece porque a rota `/minuta` lê pela chave de servidor, que ignora RLS —
-- mas são permissões podres esperando o dia em que alguém ler aquele bucket
-- pelo caminho normal.
--
-- Aditivo e seguro de rodar mais de uma vez.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- PARTE 1 · A regra de verdade do bucket `documentos`
--
-- O que o bucket guarda hoje é UM arquivo fixo: `minuta-contrato.pdf`, o
-- modelo do contrato. Ele não é por negócio, não tem pasta por pessoa, e a
-- única porta é a rota `/minuta`, que confere o token do negócio ou a sessão
-- e devolve um link assinado de 5 minutos — tudo pela chave de servidor.
--
-- As policies antigas descreviam outro desenho, com uma pasta por negócio.
-- Esse desenho não existe. A regra honesta é a mais simples: o bucket é da
-- Trilha. Ninguém mais o alcança pela sessão, e ninguém precisa.
--
-- Os documentos POR NEGÓCIO ficam no outro bucket, `fechamento`, cujas três
-- policies estão em `arquivos-fechamento.sql` e continuam valendo.
-- ----------------------------------------------------------------------------

drop policy if exists docs_admin            on storage.objects;
drop policy if exists docs_participa_select on storage.objects;
drop policy if exists docs_participa_insert on storage.objects;

drop policy if exists documentos_trilha on storage.objects;
create policy documentos_trilha on storage.objects
  for all to authenticated
  using      (bucket_id = 'documentos' and public.eh_admin_trilha())
  with check (bucket_id = 'documentos' and public.eh_admin_trilha());


-- ----------------------------------------------------------------------------
-- PARTE 2 · As seis órfãs
--
-- Ordem importa: as policies que as chamavam saíram na Parte 1. `drop
-- function if exists` sem `cascade` de propósito — se alguma ainda estiver
-- presa a algo que eu não vi, o banco recusa e o erro aparece, em vez de
-- levar junto o que estava pendurado nela.
-- ----------------------------------------------------------------------------

drop function if exists public.participa_negocio(uuid);
drop function if exists public.sou_responsavel_pessoa(uuid);
drop function if exists public.progresso_negocio(uuid);
drop function if exists public.is_admin_trilha();
drop function if exists public.minha_incorporadora();
drop function if exists public.valor_projetado(numeric, integer);


-- ----------------------------------------------------------------------------
-- Conferência
-- ----------------------------------------------------------------------------

select 'policies do bucket documentos' as o_que,
       string_agg(polname, ', ' order by polname) as situacao
  from pg_policy
 where polrelid = 'storage.objects'::regclass
   and coalesce(pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)) like '%documentos%'
union all
select 'policies do bucket fechamento (nao mexidas)',
       string_agg(polname, ', ' order by polname)
  from pg_policy
 where polrelid = 'storage.objects'::regclass and polname like 'fechamento%'
union all
select 'orfas restantes (tem que ser vazio)',
       coalesce(string_agg(proname, ', ' order by proname), '(nenhuma)')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('is_admin_trilha','minha_incorporadora','participa_negocio',
                     'progresso_negocio','sou_responsavel_pessoa','valor_projetado')
union all
select 'as funcoes certas continuam la',
       string_agg(proname, ', ' order by proname)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('eh_admin_trilha','minha_incorporadora_id',
                     'minha_incorporadora_como_parceiro','meu_parceiro_id');
