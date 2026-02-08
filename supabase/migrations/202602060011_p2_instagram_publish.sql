-- TEPPEN MEO Phase2 ticket P2-02 (Instagram publish integration)
-- 最終更新: 2026-02-07
--
-- 目的:
-- - Instagram投稿の実行結果を履歴化する
-- - REAL/MOCKの実行モードを記録し、障害時の切り分けを容易にする

create table if not exists public.post_publish_logs (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  provider text not null,
  mode text not null check (mode in ('REAL', 'MOCK')),
  status text not null check (status in ('SUCCESS', 'FAILED')),
  message text,
  external_post_id text,
  requested_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists post_publish_logs_post_id_idx on public.post_publish_logs(post_id);
create index if not exists post_publish_logs_store_id_idx on public.post_publish_logs(store_id);
create index if not exists post_publish_logs_provider_idx on public.post_publish_logs(provider);
create index if not exists post_publish_logs_created_at_idx on public.post_publish_logs(created_at);

alter table public.post_publish_logs enable row level security;

drop policy if exists post_publish_logs_select_by_store_access on public.post_publish_logs;
create policy post_publish_logs_select_by_store_access
on public.post_publish_logs
for select
using (public.user_has_store_access(store_id));

drop policy if exists post_publish_logs_insert_by_store_access on public.post_publish_logs;
create policy post_publish_logs_insert_by_store_access
on public.post_publish_logs
for insert
with check (
  public.user_has_store_access(store_id)
  and (
    requested_by_user_id is null
    or requested_by_user_id = auth.uid()
  )
);
