-- TEPPEN MEO Phase5 migration (real data publish / inbox sync / dashboard)
-- 最終更新: 2026-02-12
--
-- 目的:
-- - 予約投稿ジョブの実行効率を上げるためのindexを追加
-- - inbox_messages のupsertキーを store単位で扱えるようにする
-- - 予約投稿の二重実行を防止する advisory lock 関数を追加
-- - 外部投稿自動取得 feature flag を初期化

alter table public.inbox_messages
  drop constraint if exists inbox_messages_provider_external_message_id_key;

alter table public.inbox_messages
  drop constraint if exists inbox_messages_store_provider_external_message_id_key;

alter table public.inbox_messages
  add constraint inbox_messages_store_provider_external_message_id_key
  unique (store_id, provider, external_message_id);

create index if not exists inbox_messages_store_provider_received_at_idx
  on public.inbox_messages(store_id, provider, received_at desc);

alter table public.inbox_threads
  drop constraint if exists inbox_threads_provider_external_thread_id_key;

alter table public.inbox_threads
  drop constraint if exists inbox_threads_store_provider_external_thread_id_key;

alter table public.inbox_threads
  add constraint inbox_threads_store_provider_external_thread_id_key
  unique (store_id, provider, external_thread_id);

create index if not exists posts_scheduler_status_approval_scheduled_idx
  on public.posts(status, approval_status, scheduled_at)
  where status = 'SCHEDULED';

create index if not exists posts_store_status_scheduled_at_idx
  on public.posts(store_id, status, scheduled_at);

create or replace function public.try_lock_post_publish(target_post_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_catalog
as $$
  select pg_try_advisory_xact_lock(hashtextextended(target_post_id::text, 0));
$$;

grant execute on function public.try_lock_post_publish(uuid) to authenticated;
grant execute on function public.try_lock_post_publish(uuid) to service_role;

insert into public.feature_flags (org_id, store_id, feature_key, state, note)
select org.id, null, 'remote_posts_autofetch', 'HIDDEN', '投稿一覧の外部投稿自動取得（5分キャッシュ）'
from public.organizations org
where not exists (
  select 1
  from public.feature_flags ff
  where ff.org_id = org.id
    and ff.store_id is null
    and ff.feature_key = 'remote_posts_autofetch'
);

insert into public.feature_flags (org_id, store_id, feature_key, state, note)
select org.id, null, 'inbox_autosync', 'HIDDEN', '受信箱の自動同期（表示時に同期）'
from public.organizations org
where not exists (
  select 1
  from public.feature_flags ff
  where ff.org_id = org.id
    and ff.store_id is null
    and ff.feature_key = 'inbox_autosync'
);
