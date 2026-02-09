-- TEPPEN MEO Phase4 migration (RBAC: SUPERVISOR + contract plan admin GUI)
-- 最終更新: 2026-02-09
--
-- 目的:
-- - ロールを ADMIN -> SUPERVISOR -> MANAGER -> USER に再編する
-- - 既存の memberships.role='MANAGER'（旧: 代理店）を SUPERVISOR に移行する
-- - 既存RLS/関数の "ADMIN/MANAGER" 前提を新ロール階層へ差し替える（forward-only）
--
-- 注意:
-- - 本migrationは "既存のMANAGER=代理店" を前提に全件 SUPERVISOR へ更新します
-- - 新しい顧客側ロールは MANAGER として新規に作成されます（本migrationでは作成しません）

-- ------------------------------------------------------------
-- 1) Data migration: old MANAGER -> SUPERVISOR
-- ------------------------------------------------------------
update public.memberships
set role = 'SUPERVISOR'
where role = 'MANAGER';

do $$
begin
  if not exists (
    select 1
    from public.audit_logs al
    where al.action = 'ROLE_MIGRATION_MANAGER_TO_SUPERVISOR'
  ) then
    insert into public.audit_logs (
      action,
      target_type,
      target_id,
      payload
    )
    values (
      'ROLE_MIGRATION_MANAGER_TO_SUPERVISOR',
      'memberships',
      'memberships.role',
      jsonb_build_object(
        'from', 'MANAGER',
        'to', 'SUPERVISOR',
        'applied_at', now()
      )
    );
  end if;
end $$;

-- ------------------------------------------------------------
-- 2) RBAC helpers (SECURITY DEFINER)
-- ------------------------------------------------------------
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
          and m.role = 'SUPERVISOR'
      ) then 'SUPERVISOR'
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
          and m.role = 'USER'
      ) then 'USER'
      else null
    end;
$$;

create or replace function public.actor_is_internal()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.role in ('ADMIN', 'SUPERVISOR')
  );
$$;

create or replace function public.actor_is_org_admin(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.actor_highest_role_in_org(target_org_id) in ('ADMIN', 'SUPERVISOR');
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
      when 'SUPERVISOR' then target_membership_role in ('MANAGER', 'USER')
      when 'MANAGER' then target_membership_role = 'USER'
      else false
    end;
$$;

create or replace function public.actor_can_manage_store_groups(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.actor_highest_role_in_org(target_org_id) in ('ADMIN', 'SUPERVISOR', 'MANAGER');
$$;

create or replace function public.actor_can_manage_user_store_control(target_org_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.actor_highest_role_in_org(target_org_id) in ('ADMIN', 'SUPERVISOR')
    and exists (
      select 1
      from public.memberships target_m
      where target_m.org_id = target_org_id
        and target_m.user_id = target_user_id
        and target_m.role = 'USER'
    );
$$;

create or replace function public.user_has_store_access(target_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    join public.stores s on s.id = target_store_id
    where m.user_id = auth.uid()
      and m.org_id = s.org_id
      and (
        m.role in ('ADMIN', 'SUPERVISOR', 'MANAGER')
        or (m.role = 'USER' and m.store_id = target_store_id)
      )
  );
$$;

-- OAuth common foundation helper (P2-01)
create or replace function public.actor_can_manage_store_integration(target_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.stores s
    where s.id = target_store_id
      and public.user_has_store_access(target_store_id)
      and public.actor_highest_role_in_org(s.org_id) in ('ADMIN', 'SUPERVISOR', 'MANAGER')
  );
$$;

-- Brand assets helper (P2-05)
create or replace function public.actor_can_manage_brand_assets(target_org_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  return exists (
    select 1
    from public.memberships m
    where m.org_id = target_org_id
      and m.user_id = auth.uid()
      and m.role in ('ADMIN', 'SUPERVISOR', 'MANAGER')
  );
end;
$$;

-- Post approval workflow (P1-06)
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
      when 'ADMIN' then 4
      when 'SUPERVISOR' then 3
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

  -- Approve/reject requires MANAGER or above (>=2)
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

-- ------------------------------------------------------------
-- 3) RLS policy adjustments (forward-only overrides)
-- ------------------------------------------------------------

-- profiles: org operator can list managed users
drop policy if exists profiles_select_by_org_admin_manager on public.profiles;
create policy profiles_select_by_org_admin_manager
on public.profiles
for select
using (
  exists (
    select 1
    from public.memberships m_actor
    join public.memberships m_target
      on m_target.user_id = profiles.id
     and m_target.org_id = m_actor.org_id
    where m_actor.user_id = auth.uid()
      and public.actor_can_manage_membership(m_actor.org_id, m_target.role)
  )
);

-- stores: update to new role hierarchy
drop policy if exists stores_select_by_membership on public.stores;
create policy stores_select_by_membership
on public.stores
for select
using (public.user_has_store_access(id));

drop policy if exists stores_update_by_membership on public.stores;
create policy stores_update_by_membership
on public.stores
for update
using (public.user_has_store_access(id))
with check (public.user_has_store_access(id));

drop policy if exists stores_insert_by_org_scope on public.stores;
create policy stores_insert_by_org_scope
on public.stores
for insert
with check (
  exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.org_id = stores.org_id
      and (
        m.role in ('ADMIN', 'SUPERVISOR', 'MANAGER')
        or (
          m.role = 'USER'
          and public.can_user_create_store(stores.org_id, auth.uid())
        )
      )
  )
);

-- audit_logs: internal roles can view plan/audit history
alter table public.audit_logs enable row level security;
drop policy if exists audit_logs_select_internal on public.audit_logs;
create policy audit_logs_select_internal
on public.audit_logs
for select
to authenticated
using (
  public.actor_is_internal()
  and (
    org_id is null
    or public.actor_is_org_admin(org_id)
  )
);

