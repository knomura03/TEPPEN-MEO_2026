-- P7: 管理ユニット導入 + ユーザー作成時のグループ/店舗必須化に向けたRBAC基盤
-- 目的:
-- - SUPERVISOR の管理範囲を管理ユニット単位に制限する
-- - organizations を必ず management_unit に所属させる
-- - 既存データを安全にバックフィルする

-- ------------------------------------------------------------
-- 1) 管理ユニットテーブル
-- ------------------------------------------------------------

create table if not exists public.management_units (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists management_units_set_updated_at on public.management_units;
create trigger management_units_set_updated_at
before update on public.management_units
for each row execute function public.set_updated_at();

create table if not exists public.management_unit_supervisors (
  id uuid primary key default gen_random_uuid(),
  management_unit_id uuid not null references public.management_units(id) on delete cascade,
  supervisor_user_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supervisor_user_id),
  unique (management_unit_id, supervisor_user_id)
);

drop trigger if exists management_unit_supervisors_set_updated_at on public.management_unit_supervisors;
create trigger management_unit_supervisors_set_updated_at
before update on public.management_unit_supervisors
for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 2) organizations に management_unit_id を追加 + バックフィル
-- ------------------------------------------------------------

alter table public.organizations
  add column if not exists management_unit_id uuid references public.management_units(id) on delete restrict;

with admin_unit as (
  insert into public.management_units (name)
  values ('ADMIN直轄')
  on conflict (name) do update
    set name = excluded.name
  returning id
), fallback_unit as (
  select id from admin_unit
  union all
  select id
  from public.management_units
  where name = 'ADMIN直轄'
  limit 1
)
update public.organizations o
set management_unit_id = (select id from fallback_unit limit 1)
where o.management_unit_id is null;

with fallback_unit as (
  select id
  from public.management_units
  where name = 'ADMIN直轄'
  order by created_at asc
  limit 1
)
insert into public.management_unit_supervisors (management_unit_id, supervisor_user_id)
select
  (select id from fallback_unit),
  m.user_id
from public.memberships m
where m.role = 'SUPERVISOR'
  and (select id from fallback_unit) is not null
on conflict (supervisor_user_id) do nothing;

alter table public.organizations
  alter column management_unit_id set not null;

create index if not exists organizations_management_unit_id_idx
  on public.organizations(management_unit_id);

create index if not exists management_unit_supervisors_management_unit_idx
  on public.management_unit_supervisors(management_unit_id);

-- ------------------------------------------------------------
-- 3) helper functions
-- ------------------------------------------------------------

create or replace function public.actor_is_platform_admin()
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
      and m.role = 'ADMIN'
  );
$$;

create or replace function public.actor_is_platform_supervisor()
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
      and m.role = 'SUPERVISOR'
  );
$$;

create or replace function public.actor_management_unit_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select mus.management_unit_id
  from public.management_unit_supervisors mus
  where mus.supervisor_user_id = auth.uid()
  order by mus.created_at asc
  limit 1;
$$;

create or replace function public.actor_can_access_management_unit(target_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.actor_is_platform_admin()
    or (
      public.actor_is_platform_supervisor()
      and public.actor_management_unit_id() = target_unit_id
    );
$$;

create or replace function public.actor_can_access_org(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organizations o
    where o.id = target_org_id
      and (
        public.actor_is_platform_admin()
        or (
          public.actor_is_platform_supervisor()
          and o.management_unit_id = public.actor_management_unit_id()
        )
        or exists (
          select 1
          from public.memberships m
          where m.user_id = auth.uid()
            and m.org_id = target_org_id
            and m.role in ('MANAGER', 'USER')
        )
      )
  );
$$;

create or replace function public.actor_highest_role_in_org(target_org_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with target_org as (
    select o.id, o.management_unit_id
    from public.organizations o
    where o.id = target_org_id
  )
  select
    case
      when public.actor_is_platform_admin() then 'ADMIN'
      when exists (
        select 1
        from target_org o
        where public.actor_is_platform_supervisor()
          and o.management_unit_id = public.actor_management_unit_id()
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

create or replace function public.user_has_org_access(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.actor_can_access_org(target_org_id);
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
    from public.stores s
    where s.id = target_store_id
      and (
        public.actor_highest_role_in_org(s.org_id) in ('ADMIN', 'SUPERVISOR', 'MANAGER')
        or exists (
          select 1
          from public.memberships m
          where m.user_id = auth.uid()
            and m.org_id = s.org_id
            and m.role = 'USER'
            and m.store_id = target_store_id
        )
      )
  );
$$;

-- ------------------------------------------------------------
-- 4) 管理ユニットのRLS（ADMINのみ可視/CRUD）
-- ------------------------------------------------------------

alter table public.management_units enable row level security;
alter table public.management_unit_supervisors enable row level security;

drop policy if exists management_units_select_admin_only on public.management_units;
create policy management_units_select_admin_only
on public.management_units
for select
using (public.actor_is_platform_admin());

drop policy if exists management_units_insert_admin_only on public.management_units;
create policy management_units_insert_admin_only
on public.management_units
for insert
with check (public.actor_is_platform_admin());

drop policy if exists management_units_update_admin_only on public.management_units;
create policy management_units_update_admin_only
on public.management_units
for update
using (public.actor_is_platform_admin())
with check (public.actor_is_platform_admin());

drop policy if exists management_units_delete_admin_only on public.management_units;
create policy management_units_delete_admin_only
on public.management_units
for delete
using (public.actor_is_platform_admin());

drop policy if exists management_unit_supervisors_select_admin_only on public.management_unit_supervisors;
create policy management_unit_supervisors_select_admin_only
on public.management_unit_supervisors
for select
using (public.actor_is_platform_admin());

drop policy if exists management_unit_supervisors_insert_admin_only on public.management_unit_supervisors;
create policy management_unit_supervisors_insert_admin_only
on public.management_unit_supervisors
for insert
with check (public.actor_is_platform_admin());

drop policy if exists management_unit_supervisors_update_admin_only on public.management_unit_supervisors;
create policy management_unit_supervisors_update_admin_only
on public.management_unit_supervisors
for update
using (public.actor_is_platform_admin())
with check (public.actor_is_platform_admin());

drop policy if exists management_unit_supervisors_delete_admin_only on public.management_unit_supervisors;
create policy management_unit_supervisors_delete_admin_only
on public.management_unit_supervisors
for delete
using (public.actor_is_platform_admin());

-- ------------------------------------------------------------
-- 5) create_store_for_actor を再定義（management_unit_id 対応）
-- ------------------------------------------------------------

create or replace function public.create_store_for_actor(
  p_store_name text,
  p_address text default null,
  p_phone text default null,
  p_category text default null,
  p_business_hours text default null,
  p_website text default null,
  p_org_id uuid default null,
  p_org_name text default null
)
returns table (
  id uuid,
  org_id uuid,
  name text,
  address text,
  phone text,
  website text,
  category text,
  business_hours text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  target_org_id uuid;
  actor_role text;
  created_store public.stores%rowtype;
  current_count integer := 0;
  limit_value integer := 1;
  default_plan_id uuid;
  org_plan_id uuid;
  target_plan_id uuid;
  actor_management_unit uuid;
  fallback_management_unit uuid;
begin
  if actor_id is null then
    raise exception 'unauthenticated';
  end if;

  if nullif(trim(coalesce(p_store_name, '')), '') is null then
    raise exception 'STORE_NAME_REQUIRED';
  end if;

  select bp.id
  into default_plan_id
  from public.billing_plans bp
  where bp.code = 'FREE'
  order by bp.created_at asc
  limit 1;

  if default_plan_id is null then
    insert into public.billing_plans (
      code,
      name,
      amount_monthly,
      currency,
      is_active,
      description,
      feature_rules,
      sns_connection_limit
    )
    values ('FREE', 'Free', 0, 'JPY', true, 'Default free plan', '{}'::jsonb, 3)
    returning id into default_plan_id;
  end if;

  select public.actor_management_unit_id() into actor_management_unit;

  select mu.id
  into fallback_management_unit
  from public.management_units mu
  where mu.name = 'ADMIN直轄'
  order by mu.created_at asc
  limit 1;

  if fallback_management_unit is null then
    insert into public.management_units (name)
    values ('ADMIN直轄')
    on conflict (name) do update
      set name = excluded.name
    returning id into fallback_management_unit;
  end if;

  if p_org_id is null then
    select m.org_id
    into target_org_id
    from public.memberships m
    where m.user_id = actor_id
    order by
      case m.role
        when 'ADMIN' then 4
        when 'SUPERVISOR' then 3
        when 'MANAGER' then 2
        when 'USER' then 1
        else 0
      end desc,
      m.created_at asc
    limit 1;
  else
    target_org_id := p_org_id;
  end if;

  if target_org_id is null then
    insert into public.organizations(name, management_unit_id)
    values (
      coalesce(
        nullif(trim(coalesce(p_org_name, '')), ''),
        'TEPPEN MEO 新規組織'
      ),
      coalesce(actor_management_unit, fallback_management_unit)
    )
    returning id into target_org_id;

    insert into public.org_store_policies (org_id, default_user_store_limit, allow_user_store_creation, updated_by)
    values (target_org_id, 1, true, actor_id)
    on conflict on constraint org_store_policies_pkey do nothing;

    insert into public.stores (
      org_id,
      name,
      address,
      phone,
      website,
      category,
      business_hours
    )
    values (
      target_org_id,
      trim(p_store_name),
      nullif(trim(coalesce(p_address, '')), ''),
      nullif(trim(coalesce(p_phone, '')), ''),
      nullif(trim(coalesce(p_website, '')), ''),
      nullif(trim(coalesce(p_category, '')), ''),
      nullif(trim(coalesce(p_business_hours, '')), '')
    )
    returning * into created_store;

    insert into public.memberships (user_id, org_id, store_id, role)
    values (actor_id, target_org_id, created_store.id, 'USER');

    insert into public.store_subscriptions (store_id, billing_plan_id, status)
    values (created_store.id, default_plan_id, 'ACTIVE')
    on conflict (store_id) do nothing;

    return query
      select
        created_store.id,
        created_store.org_id,
        created_store.name,
        created_store.address,
        created_store.phone,
        created_store.website,
        created_store.category,
        created_store.business_hours;
    return;
  end if;

  if not public.user_has_org_access(target_org_id) then
    raise exception 'ORG_ACCESS_DENIED';
  end if;

  actor_role := public.actor_highest_role_in_org(target_org_id);
  if actor_role is null then
    raise exception 'ORG_MEMBERSHIP_REQUIRED';
  end if;

  insert into public.org_store_policies (org_id, default_user_store_limit, allow_user_store_creation, updated_by)
  values (target_org_id, 1, true, actor_id)
  on conflict on constraint org_store_policies_pkey do nothing;

  if actor_role = 'USER' then
    if not public.can_user_create_store(target_org_id, actor_id) then
      current_count := public.user_store_count(target_org_id, actor_id);
      limit_value := public.effective_user_store_limit(target_org_id, actor_id);
      raise exception 'STORE_LIMIT_EXCEEDED'
      using detail = format(
        'current=%s limit=%s shortage=%s',
        current_count,
        limit_value,
        greatest(current_count + 1 - limit_value, 0)
      );
    end if;
  end if;

  insert into public.stores (
    org_id,
    name,
    address,
    phone,
    website,
    category,
    business_hours
  )
  values (
    target_org_id,
    trim(p_store_name),
    nullif(trim(coalesce(p_address, '')), ''),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_website, '')), ''),
    nullif(trim(coalesce(p_category, '')), ''),
    nullif(trim(coalesce(p_business_hours, '')), '')
  )
  returning * into created_store;

  if actor_role = 'USER' then
    if not exists (
      select 1
      from public.memberships m
      where m.user_id = actor_id
        and m.org_id = target_org_id
        and m.role = 'USER'
        and m.store_id = created_store.id
    ) then
      insert into public.memberships (user_id, org_id, store_id, role)
      values (actor_id, target_org_id, created_store.id, 'USER');
    end if;
  end if;

  select os.billing_plan_id
  into org_plan_id
  from public.org_subscriptions os
  where os.org_id = target_org_id
    and os.billing_plan_id is not null
  order by os.created_at asc
  limit 1;

  target_plan_id := coalesce(org_plan_id, default_plan_id);

  if target_plan_id is not null then
    insert into public.store_subscriptions (store_id, billing_plan_id, status)
    values (created_store.id, target_plan_id, 'ACTIVE')
    on conflict (store_id) do nothing;
  end if;

  return query
    select
      created_store.id,
      created_store.org_id,
      created_store.name,
      created_store.address,
      created_store.phone,
      created_store.website,
      created_store.category,
      created_store.business_hours;
end;
$$;
