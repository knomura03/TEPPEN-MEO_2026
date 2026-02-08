-- TEPPEN MEO Phase1 ticket P1-07 (post rejection comment history)
-- 最終更新: 2026-02-06
--
-- 目的:
-- - 差し戻しコメントを履歴として保持する
-- - 承認申請/承認/差し戻し/コメント追加の時系列を確認可能にする

create table if not exists public.post_approval_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action_type text not null check (action_type in ('SUBMIT', 'APPROVE', 'REJECT', 'COMMENT')),
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists post_approval_comments_post_id_idx on public.post_approval_comments(post_id);
create index if not exists post_approval_comments_created_at_idx on public.post_approval_comments(created_at);

alter table public.post_approval_comments enable row level security;

drop policy if exists post_approval_comments_select_by_store_access on public.post_approval_comments;
create policy post_approval_comments_select_by_store_access
on public.post_approval_comments
for select
using (
  exists (
    select 1
    from public.posts p
    where p.id = post_id
      and public.user_has_store_access(p.store_id)
  )
);

drop policy if exists post_approval_comments_insert_by_store_access on public.post_approval_comments;
create policy post_approval_comments_insert_by_store_access
on public.post_approval_comments
for insert
with check (
  exists (
    select 1
    from public.posts p
    where p.id = post_id
      and public.user_has_store_access(p.store_id)
  )
);
