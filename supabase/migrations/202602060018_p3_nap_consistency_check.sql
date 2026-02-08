-- TEPPEN MEO Phase3 ticket P3-05 (NAP consistency check)
-- 最終更新: 2026-02-08
--
-- 目的:
-- - 店舗NAP（name/address/phone）と媒体設定値の整合性をrun単位で記録する
-- - 不整合（MISMATCH）/未設定（MISSING）を可視化できる基盤を作る

create table if not exists public.nap_consistency_runs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  trigger_type text not null default 'MANUAL' check (trigger_type in ('MANUAL', 'SCHEDULED')),
  status text not null default 'RUNNING' check (status in ('RUNNING', 'SUCCESS', 'FAILED')),
  message text,
  summary jsonb not null default '{}'::jsonb,
  requested_by_user_id uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists nap_consistency_runs_store_id_idx on public.nap_consistency_runs(store_id);
create index if not exists nap_consistency_runs_created_at_idx on public.nap_consistency_runs(created_at);

alter table public.nap_consistency_runs enable row level security;

drop policy if exists nap_consistency_runs_select_by_store_scope on public.nap_consistency_runs;
create policy nap_consistency_runs_select_by_store_scope
on public.nap_consistency_runs
for select
using (public.user_has_store_access(store_id));

drop policy if exists nap_consistency_runs_insert_by_store_scope on public.nap_consistency_runs;
create policy nap_consistency_runs_insert_by_store_scope
on public.nap_consistency_runs
for insert
with check (
  public.user_has_store_access(store_id)
  and (requested_by_user_id is null or requested_by_user_id = auth.uid())
);

drop policy if exists nap_consistency_runs_update_by_store_scope on public.nap_consistency_runs;
create policy nap_consistency_runs_update_by_store_scope
on public.nap_consistency_runs
for update
using (
  public.user_has_store_access(store_id)
  and (requested_by_user_id is null or requested_by_user_id = auth.uid())
)
with check (
  public.user_has_store_access(store_id)
  and (requested_by_user_id is null or requested_by_user_id = auth.uid())
);

grant select, insert, update on public.nap_consistency_runs to authenticated;

create table if not exists public.nap_consistency_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.nap_consistency_runs(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  provider_catalog_id uuid references public.provider_catalog(id) on delete set null,
  provider_key text not null,
  provider_name text not null,
  expected_name text,
  expected_address text,
  expected_phone text,
  observed_name text,
  observed_address text,
  observed_phone text,
  name_match boolean,
  address_match boolean,
  phone_match boolean,
  status text not null default 'MISSING' check (status in ('MATCH', 'MISMATCH', 'MISSING')),
  mismatch_fields text[] not null default '{}'::text[],
  message text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists nap_consistency_results_run_id_idx on public.nap_consistency_results(run_id);
create index if not exists nap_consistency_results_store_id_idx on public.nap_consistency_results(store_id);
create index if not exists nap_consistency_results_provider_key_idx on public.nap_consistency_results(provider_key);
create index if not exists nap_consistency_results_created_at_idx on public.nap_consistency_results(created_at);
create unique index if not exists nap_consistency_results_run_provider_unique_idx
  on public.nap_consistency_results(run_id, provider_key);

alter table public.nap_consistency_results enable row level security;

drop policy if exists nap_consistency_results_select_by_store_scope on public.nap_consistency_results;
create policy nap_consistency_results_select_by_store_scope
on public.nap_consistency_results
for select
using (public.user_has_store_access(store_id));

drop policy if exists nap_consistency_results_insert_by_store_scope on public.nap_consistency_results;
create policy nap_consistency_results_insert_by_store_scope
on public.nap_consistency_results
for insert
with check (public.user_has_store_access(store_id));

grant select, insert on public.nap_consistency_results to authenticated;
