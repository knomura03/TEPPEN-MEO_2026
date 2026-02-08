-- TEPPEN MEO Phase2 ticket P2-04 (inbox advanced workflow)
-- 最終更新: 2026-02-08
--
-- 目的:
-- - 受信箱メッセージにタグ/担当者/期限/SLAを持たせる
-- - UIでの優先度管理（要注意/期限超過）を可能にする

alter table public.inbox_messages
  add column if not exists tags text[] not null default '{}'::text[],
  add column if not exists assigned_user_id uuid references auth.users(id) on delete set null,
  add column if not exists due_at timestamptz,
  add column if not exists sla_status text not null default 'ON_TRACK';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inbox_messages_sla_status_check'
      and conrelid = 'public.inbox_messages'::regclass
  ) then
    alter table public.inbox_messages
      add constraint inbox_messages_sla_status_check
      check (sla_status in ('ON_TRACK', 'AT_RISK', 'OVERDUE', 'COMPLETED'));
  end if;
end $$;

update public.inbox_messages
set tags = '{}'::text[]
where tags is null;

update public.inbox_messages
set sla_status = case
  when is_replied then 'COMPLETED'
  when due_at is null then 'ON_TRACK'
  when due_at < now() then 'OVERDUE'
  when due_at <= now() + interval '24 hours' then 'AT_RISK'
  else 'ON_TRACK'
end
where sla_status is null or sla_status = '';

create index if not exists inbox_messages_assigned_user_id_idx
  on public.inbox_messages(assigned_user_id);

create index if not exists inbox_messages_due_at_idx
  on public.inbox_messages(due_at);

create index if not exists inbox_messages_sla_status_idx
  on public.inbox_messages(sla_status);

create index if not exists inbox_messages_tags_gin_idx
  on public.inbox_messages
  using gin (tags);
