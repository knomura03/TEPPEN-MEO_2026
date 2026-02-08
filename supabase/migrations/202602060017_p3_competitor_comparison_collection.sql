-- TEPPEN MEO Phase3 ticket P3-03 (competitor comparison collection)
-- 最終更新: 2026-02-08
--
-- 目的:
-- - 競合ターゲットを店舗ごとに管理する
-- - 日次収集runに紐づく競合指標（順位/口コミ数/評価）を時系列保存する

create table if not exists public.competitor_targets (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  note text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint competitor_targets_name_len_check check (char_length(name) between 1 and 120)
);

create index if not exists competitor_targets_store_id_idx on public.competitor_targets(store_id);
create index if not exists competitor_targets_active_idx on public.competitor_targets(is_active);
create unique index if not exists competitor_targets_store_name_unique_idx
  on public.competitor_targets(store_id, lower(name));

drop trigger if exists competitor_targets_set_updated_at on public.competitor_targets;
create trigger competitor_targets_set_updated_at
before update on public.competitor_targets
for each row execute function public.set_updated_at();

alter table public.competitor_targets enable row level security;

drop policy if exists competitor_targets_select_by_store_scope on public.competitor_targets;
create policy competitor_targets_select_by_store_scope
on public.competitor_targets
for select
using (public.user_has_store_access(store_id));

drop policy if exists competitor_targets_insert_by_store_scope on public.competitor_targets;
create policy competitor_targets_insert_by_store_scope
on public.competitor_targets
for insert
with check (public.user_has_store_access(store_id));

drop policy if exists competitor_targets_update_by_store_scope on public.competitor_targets;
create policy competitor_targets_update_by_store_scope
on public.competitor_targets
for update
using (public.user_has_store_access(store_id))
with check (public.user_has_store_access(store_id));

drop policy if exists competitor_targets_delete_by_store_scope on public.competitor_targets;
create policy competitor_targets_delete_by_store_scope
on public.competitor_targets
for delete
using (public.user_has_store_access(store_id));

grant select, insert, update, delete on public.competitor_targets to authenticated;

create table if not exists public.competitor_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.rank_collection_runs(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  competitor_target_id uuid not null references public.competitor_targets(id) on delete cascade,
  competitor_name text not null,
  map_rank integer,
  review_count integer not null default 0,
  rating numeric(2,1),
  mode text not null default 'MOCK' check (mode in ('REAL', 'MOCK')),
  status text not null default 'SUCCESS' check (status in ('SUCCESS', 'FAILED')),
  message text,
  raw jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint competitor_metric_snapshots_map_rank_check check (map_rank is null or map_rank >= 1),
  constraint competitor_metric_snapshots_review_count_check check (review_count >= 0),
  constraint competitor_metric_snapshots_rating_check check (rating is null or (rating >= 0 and rating <= 5))
);

create index if not exists competitor_metric_snapshots_run_id_idx on public.competitor_metric_snapshots(run_id);
create index if not exists competitor_metric_snapshots_store_id_idx on public.competitor_metric_snapshots(store_id);
create index if not exists competitor_metric_snapshots_target_id_idx on public.competitor_metric_snapshots(competitor_target_id);
create index if not exists competitor_metric_snapshots_collected_at_idx on public.competitor_metric_snapshots(collected_at);
create unique index if not exists competitor_metric_snapshots_run_target_unique_idx
  on public.competitor_metric_snapshots(run_id, competitor_target_id);

alter table public.competitor_metric_snapshots enable row level security;

drop policy if exists competitor_metric_snapshots_select_by_store_scope on public.competitor_metric_snapshots;
create policy competitor_metric_snapshots_select_by_store_scope
on public.competitor_metric_snapshots
for select
using (public.user_has_store_access(store_id));

drop policy if exists competitor_metric_snapshots_insert_by_store_scope on public.competitor_metric_snapshots;
create policy competitor_metric_snapshots_insert_by_store_scope
on public.competitor_metric_snapshots
for insert
with check (public.user_has_store_access(store_id));

grant select, insert on public.competitor_metric_snapshots to authenticated;
