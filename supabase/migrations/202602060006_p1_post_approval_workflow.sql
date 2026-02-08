-- TEPPEN MEO Phase1 ticket P1-06 (post approval workflow)
-- 最終更新: 2026-02-06
--
-- 目的:
-- - 投稿の承認申請フロー（作成→承認→公開準備）を追加
-- - 承認/差し戻しの状態を永続化する
-- - USERの自己承認をDBトリガーで防止する

alter table public.posts
  add column if not exists approval_status text not null default 'NONE';

alter table public.posts
  add column if not exists submitted_for_approval_at timestamptz;

alter table public.posts
  add column if not exists approved_at timestamptz;

alter table public.posts
  add column if not exists approved_by_user_id uuid references auth.users(id) on delete set null;

alter table public.posts
  add column if not exists rejected_at timestamptz;

alter table public.posts
  add column if not exists rejected_by_user_id uuid references auth.users(id) on delete set null;

alter table public.posts
  add column if not exists rejection_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'posts_approval_status_check'
      and conrelid = 'public.posts'::regclass
  ) then
    alter table public.posts
      add constraint posts_approval_status_check
      check (approval_status in ('NONE', 'PENDING', 'APPROVED', 'REJECTED'));
  end if;
end $$;

create index if not exists posts_approval_status_idx on public.posts(approval_status);
create index if not exists posts_submitted_for_approval_at_idx on public.posts(submitted_for_approval_at);

create or replace function public.enforce_post_approval_workflow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_org_id uuid;
  role_rank integer := 0;
begin
  if auth.uid() is null then
    return new;
  end if;

  select s.org_id into target_org_id
  from public.stores s
  where s.id = new.store_id;

  if target_org_id is null then
    return new;
  end if;

  select coalesce(max(
    case m.role
      when 'ADMIN' then 3
      when 'MANAGER' then 2
      when 'USER' then 1
      else 0
    end
  ), 0)
  into role_rank
  from public.memberships m
  where m.user_id = auth.uid()
    and m.org_id = target_org_id;

  if role_rank = 0 then
    raise exception 'store membership not found';
  end if;

  if new.approval_status in ('APPROVED', 'REJECTED') and role_rank < 2 then
    raise exception 'approval action requires manager role';
  end if;

  if tg_op = 'INSERT' and role_rank = 1 and new.approval_status = 'NONE' then
    new.approval_status := 'PENDING';
    new.submitted_for_approval_at := coalesce(new.submitted_for_approval_at, now());
  end if;

  if new.approval_status = 'PENDING' then
    new.submitted_for_approval_at := coalesce(new.submitted_for_approval_at, now());
    new.approved_at := null;
    new.approved_by_user_id := null;
    new.rejected_at := null;
    new.rejected_by_user_id := null;
    new.rejection_reason := null;
  elsif new.approval_status = 'APPROVED' then
    new.approved_at := coalesce(new.approved_at, now());
    new.rejected_at := null;
    new.rejected_by_user_id := null;
    new.rejection_reason := null;
  elsif new.approval_status = 'REJECTED' then
    new.rejected_at := coalesce(new.rejected_at, now());
    new.approved_at := null;
    new.approved_by_user_id := null;
  end if;

  return new;
end;
$$;

drop trigger if exists posts_enforce_approval_workflow on public.posts;
create trigger posts_enforce_approval_workflow
before insert or update on public.posts
for each row execute function public.enforce_post_approval_workflow();
