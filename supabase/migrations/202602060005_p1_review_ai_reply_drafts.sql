-- TEPPEN MEO Phase1 ticket P1-05 (review AI reply drafts)
-- 最終更新: 2026-02-06
--
-- 目的:
-- - 口コミAI返信案を保存する
-- - 承認前保留ステータスを保持する

alter table public.inbox_messages
  add column if not exists reply_draft_content text;

alter table public.inbox_messages
  add column if not exists reply_draft_status text;

alter table public.inbox_messages
  add column if not exists reply_draft_generated_at timestamptz;

alter table public.inbox_messages
  add column if not exists reply_draft_approved_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inbox_messages_reply_draft_status_check'
      and conrelid = 'public.inbox_messages'::regclass
  ) then
    alter table public.inbox_messages
      add constraint inbox_messages_reply_draft_status_check
      check (reply_draft_status in ('PENDING_APPROVAL', 'APPROVED', 'DISMISSED') or reply_draft_status is null);
  end if;
end $$;

create index if not exists inbox_messages_reply_draft_status_idx
  on public.inbox_messages(reply_draft_status);
