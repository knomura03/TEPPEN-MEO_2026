-- TEPPEN MEO Phase3 ticket P3-02 (daily rank collection job)
-- 最終更新: 2026-02-08
--
-- 目的:
-- - 順位収集の実行履歴と結果を保存し、日次収集と再実行を可能にする
-- - 収集結果はP3-04（ダッシュボード）で可視化する前提の基盤とする

create table if not exists public.rank_collection_runs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  trigger_type text not null default 'MANUAL' check (trigger_type in ('MANUAL', 'SCHEDULED')),
  mode text not null default 'MOCK' check (mode in ('REAL', 'MOCK')),
  status text not null default 'RUNNING' check (status in ('RUNNING', 'SUCCESS', 'FAILED')),
  message text,
  requested_by_user_id uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists rank_collection_runs_store_id_idx on public.rank_collection_runs(store_id);
create index if not exists rank_collection_runs_created_at_idx on public.rank_collection_runs(created_at);

alter table public.rank_collection_runs enable row level security;

drop policy if exists rank_collection_runs_select_by_store_scope on public.rank_collection_runs;
create policy rank_collection_runs_select_by_store_scope
on public.rank_collection_runs
for select
using (public.user_has_store_access(store_id));

drop policy if exists rank_collection_runs_insert_by_store_scope on public.rank_collection_runs;
create policy rank_collection_runs_insert_by_store_scope
on public.rank_collection_runs
for insert
with check (
  public.user_has_store_access(store_id)
  and (requested_by_user_id is null or requested_by_user_id = auth.uid())
);

drop policy if exists rank_collection_runs_update_by_store_scope on public.rank_collection_runs;
create policy rank_collection_runs_update_by_store_scope
on public.rank_collection_runs
for update
using (
  public.user_has_store_access(store_id)
  and (requested_by_user_id is null or requested_by_user_id = auth.uid())
)
with check (
  public.user_has_store_access(store_id)
  and (requested_by_user_id is null or requested_by_user_id = auth.uid())
);

grant select, insert, update on public.rank_collection_runs to authenticated;

create table if not exists public.rank_collection_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.rank_collection_runs(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  rank_keyword_id uuid not null references public.rank_keywords(id) on delete cascade,
  keyword text not null,
  position integer,
  mode text not null default 'MOCK' check (mode in ('REAL', 'MOCK')),
  status text not null default 'SUCCESS' check (status in ('SUCCESS', 'FAILED')),
  message text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint rank_collection_results_position_check check (position is null or position >= 1)
);

create index if not exists rank_collection_results_run_id_idx on public.rank_collection_results(run_id);
create index if not exists rank_collection_results_store_id_idx on public.rank_collection_results(store_id);
create index if not exists rank_collection_results_keyword_id_idx on public.rank_collection_results(rank_keyword_id);
create index if not exists rank_collection_results_created_at_idx on public.rank_collection_results(created_at);
create unique index if not exists rank_collection_results_run_keyword_unique_idx
  on public.rank_collection_results(run_id, rank_keyword_id);

alter table public.rank_collection_results enable row level security;

drop policy if exists rank_collection_results_select_by_store_scope on public.rank_collection_results;
create policy rank_collection_results_select_by_store_scope
on public.rank_collection_results
for select
using (public.user_has_store_access(store_id));

drop policy if exists rank_collection_results_insert_by_store_scope on public.rank_collection_results;
create policy rank_collection_results_insert_by_store_scope
on public.rank_collection_results
for insert
with check (public.user_has_store_access(store_id));

grant select, insert on public.rank_collection_results to authenticated;
