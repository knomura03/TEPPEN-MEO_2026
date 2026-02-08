-- TEPPEN MEO Phase2 ticket P2-03 (Facebook publish / reply integration)
-- 最終更新: 2026-02-07
--
-- 目的:
-- - Facebook返信の実行結果を履歴化する
-- - 投稿履歴（post_publish_logs）と同じ粒度で reply 履歴を残す

create table if not exists public.inbox_reply_logs (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.inbox_messages(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  provider text not null,
  mode text not null check (mode in ('REAL', 'MOCK')),
  status text not null check (status in ('SUCCESS', 'FAILED')),
  message text,
  external_reply_id text,
  requested_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists inbox_reply_logs_message_id_idx on public.inbox_reply_logs(message_id);
create index if not exists inbox_reply_logs_store_id_idx on public.inbox_reply_logs(store_id);
create index if not exists inbox_reply_logs_provider_idx on public.inbox_reply_logs(provider);
create index if not exists inbox_reply_logs_created_at_idx on public.inbox_reply_logs(created_at);

alter table public.inbox_reply_logs enable row level security;

drop policy if exists inbox_reply_logs_select_by_store_access on public.inbox_reply_logs;
create policy inbox_reply_logs_select_by_store_access
on public.inbox_reply_logs
for select
using (public.user_has_store_access(store_id));

drop policy if exists inbox_reply_logs_insert_by_store_access on public.inbox_reply_logs;
create policy inbox_reply_logs_insert_by_store_access
on public.inbox_reply_logs
for insert
with check (
  public.user_has_store_access(store_id)
  and (
    requested_by_user_id is null
    or requested_by_user_id = auth.uid()
  )
);
