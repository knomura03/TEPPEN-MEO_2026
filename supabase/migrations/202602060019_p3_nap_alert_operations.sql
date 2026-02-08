-- TEPPEN MEO Phase3 ticket P3-06 (NAP alert operations)
-- 最終更新: 2026-02-08
--
-- 目的:
-- - NAP整合性チェック（P3-05）の結果からアラートを永続化し、運用（ACK/RESOLVE）できるようにする
-- - 1店舗×媒体(provider_key)あたり1件の「現行アラート」を管理する（履歴はnap_consistency_resultsが担保）

create table if not exists public.nap_alerts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  provider_catalog_id uuid references public.provider_catalog(id) on delete set null,
  provider_key text not null,
  provider_name text not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'ACKED', 'RESOLVED')),
  last_result_status text not null default 'MISSING' check (last_result_status in ('MATCH', 'MISMATCH', 'MISSING')),
  mismatch_fields text[] not null default '{}'::text[],
  last_run_id uuid references public.nap_consistency_runs(id) on delete set null,
  last_result_id uuid references public.nap_consistency_results(id) on delete set null,
  first_detected_at timestamptz not null default now(),
  opened_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by_user_id uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  resolved_by_user_id uuid references auth.users(id) on delete set null,
  note text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, provider_key)
);

create index if not exists nap_alerts_store_id_idx on public.nap_alerts(store_id);
create index if not exists nap_alerts_status_idx on public.nap_alerts(status);
create index if not exists nap_alerts_last_detected_at_idx on public.nap_alerts(last_detected_at);
create index if not exists nap_alerts_updated_at_idx on public.nap_alerts(updated_at);

drop trigger if exists nap_alerts_set_updated_at on public.nap_alerts;
create trigger nap_alerts_set_updated_at
before update on public.nap_alerts
for each row execute function public.set_updated_at();

alter table public.nap_alerts enable row level security;

drop policy if exists nap_alerts_select_by_store_scope on public.nap_alerts;
create policy nap_alerts_select_by_store_scope
on public.nap_alerts
for select
using (public.user_has_store_access(store_id));

drop policy if exists nap_alerts_insert_by_store_scope on public.nap_alerts;
create policy nap_alerts_insert_by_store_scope
on public.nap_alerts
for insert
with check (public.user_has_store_access(store_id));

drop policy if exists nap_alerts_update_by_store_scope on public.nap_alerts;
create policy nap_alerts_update_by_store_scope
on public.nap_alerts
for update
using (public.user_has_store_access(store_id))
with check (public.user_has_store_access(store_id));

grant select, insert, update on public.nap_alerts to authenticated;
