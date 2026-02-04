-- TEPPEN MEO hotfix: RLS recursion (42P17) on memberships
-- 最終更新: 2026-02-04
--
-- 症状:
-- - 「店舗が未設定」になり、投稿/カレンダー/店舗情報が空に見える
-- - 画面上部に `code=42P17 / infinite recursion detected in policy for relation "memberships"` が出る
--
-- 原因:
-- - memberships のRLSポリシー内で memberships を参照しており、Postgresが再帰と判断してエラーになる
--
-- 使い方:
-- - Supabase → SQL Editor を開き、Role が `postgres` になっていることを確認してから、そのまま実行

begin;

create or replace function public.actor_highest_role_in_org(target_org_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when exists (
        select 1
        from public.memberships m
        where m.user_id = auth.uid()
          and m.org_id = target_org_id
          and m.role = 'ADMIN'
      ) then 'ADMIN'
      when exists (
        select 1
        from public.memberships m
        where m.user_id = auth.uid()
          and m.org_id = target_org_id
          and m.role = 'MANAGER'
      ) then 'MANAGER'
      when exists (
        select 1
        from public.memberships m
        where m.user_id = auth.uid()
          and m.org_id = target_org_id
      ) then 'USER'
      else null
    end;
$$;

create or replace function public.actor_can_manage_membership(target_org_id uuid, target_membership_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    case public.actor_highest_role_in_org(target_org_id)
      when 'ADMIN' then true
      when 'MANAGER' then target_membership_role = 'USER'
      else false
    end;
$$;

drop policy if exists memberships_select_by_org_admin_manager on public.memberships;
create policy memberships_select_by_org_admin_manager
on public.memberships
for select
using (public.actor_can_manage_membership(org_id, role));

drop policy if exists memberships_delete_by_org_admin_manager on public.memberships;
create policy memberships_delete_by_org_admin_manager
on public.memberships
for delete
using (
  memberships.user_id <> auth.uid()
  and public.actor_can_manage_membership(org_id, role)
);

commit;

