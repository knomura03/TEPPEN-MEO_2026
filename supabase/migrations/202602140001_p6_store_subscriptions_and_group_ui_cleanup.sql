-- P6: グループ表記統一に向けた店舗単位プラン基盤
-- 目的:
-- - 契約プランの割当単位を org から store に拡張する
-- - 既存 stores を店舗プランへバックフィルする
-- - 新規店舗作成時に必ず store_subscriptions が作成されるようにする

-- ------------------------------------------------------------
-- 1) FREE プランを保証
-- ------------------------------------------------------------

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
values (
  'FREE',
  'Free',
  0,
  'JPY',
  true,
  'Default free plan',
  '{}'::jsonb,
  3
)
on conflict (code) do update
set is_active = true,
    updated_at = now();

-- ------------------------------------------------------------
-- 2) 店舗単位契約テーブル
-- ------------------------------------------------------------

create table if not exists public.store_subscriptions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  billing_plan_id uuid not null references public.billing_plans(id) on delete restrict,
  status text not null default 'ACTIVE'
    check (status in ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'INCOMPLETE', 'PAUSED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id)
);

create table if not exists public.store_subscription_plan_schedules (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  billing_plan_id uuid not null references public.billing_plans(id) on delete restrict,
  status text not null default 'SCHEDULED'
    check (status in ('SCHEDULED', 'APPLIED', 'CANCELED')),
  effective_at timestamptz not null,
  applied_at timestamptz,
  canceled_at timestamptz,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists store_subscription_plan_schedules_store_effective_idx
  on public.store_subscription_plan_schedules(store_id, status, effective_at desc);

drop trigger if exists store_subscriptions_set_updated_at on public.store_subscriptions;
create trigger store_subscriptions_set_updated_at
before update on public.store_subscriptions
for each row execute function public.set_updated_at();

drop trigger if exists store_subscription_plan_schedules_set_updated_at on public.store_subscription_plan_schedules;
create trigger store_subscription_plan_schedules_set_updated_at
before update on public.store_subscription_plan_schedules
for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 3) helper: 店舗プラン管理権限
-- ------------------------------------------------------------

create or replace function public.actor_can_manage_store_subscription(target_store_id uuid)
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
      and public.actor_highest_role_in_org(s.org_id) in ('ADMIN', 'SUPERVISOR')
  );
$$;

-- ------------------------------------------------------------
-- 4) RLS
-- ------------------------------------------------------------

alter table public.store_subscriptions enable row level security;
alter table public.store_subscription_plan_schedules enable row level security;

drop policy if exists store_subscriptions_select_by_store_scope on public.store_subscriptions;
create policy store_subscriptions_select_by_store_scope
on public.store_subscriptions
for select
using (public.user_has_store_access(store_id));

drop policy if exists store_subscriptions_insert_by_store_admin on public.store_subscriptions;
create policy store_subscriptions_insert_by_store_admin
on public.store_subscriptions
for insert
with check (public.actor_can_manage_store_subscription(store_id));

drop policy if exists store_subscriptions_update_by_store_admin on public.store_subscriptions;
create policy store_subscriptions_update_by_store_admin
on public.store_subscriptions
for update
using (public.actor_can_manage_store_subscription(store_id))
with check (public.actor_can_manage_store_subscription(store_id));

drop policy if exists store_subscriptions_delete_by_store_admin on public.store_subscriptions;
create policy store_subscriptions_delete_by_store_admin
on public.store_subscriptions
for delete
using (public.actor_can_manage_store_subscription(store_id));

drop policy if exists store_subscription_plan_schedules_select_by_store_scope on public.store_subscription_plan_schedules;
create policy store_subscription_plan_schedules_select_by_store_scope
on public.store_subscription_plan_schedules
for select
using (public.user_has_store_access(store_id));

drop policy if exists store_subscription_plan_schedules_insert_by_store_admin on public.store_subscription_plan_schedules;
create policy store_subscription_plan_schedules_insert_by_store_admin
on public.store_subscription_plan_schedules
for insert
with check (public.actor_can_manage_store_subscription(store_id));

drop policy if exists store_subscription_plan_schedules_update_by_store_admin on public.store_subscription_plan_schedules;
create policy store_subscription_plan_schedules_update_by_store_admin
on public.store_subscription_plan_schedules
for update
using (public.actor_can_manage_store_subscription(store_id))
with check (public.actor_can_manage_store_subscription(store_id));

drop policy if exists store_subscription_plan_schedules_delete_by_store_admin on public.store_subscription_plan_schedules;
create policy store_subscription_plan_schedules_delete_by_store_admin
on public.store_subscription_plan_schedules
for delete
using (public.actor_can_manage_store_subscription(store_id));

-- ------------------------------------------------------------
-- 5) 既存 store をバックフィル
-- ------------------------------------------------------------

with free_plan as (
  select bp.id
  from public.billing_plans bp
  where bp.code = 'FREE'
  order by bp.created_at asc
  limit 1
),
source_rows as (
  select
    s.id as store_id,
    coalesce(
      (
        select os.billing_plan_id
        from public.org_subscriptions os
        where os.org_id = s.org_id
          and os.billing_plan_id is not null
        order by os.created_at asc
        limit 1
      ),
      (select id from free_plan)
    ) as billing_plan_id
  from public.stores s
)
insert into public.store_subscriptions (store_id, billing_plan_id, status)
select
  sr.store_id,
  sr.billing_plan_id,
  'ACTIVE'
from source_rows sr
where sr.billing_plan_id is not null
on conflict (store_id) do nothing;

-- ------------------------------------------------------------
-- 6) create_store_for_actor を置換（新規店舗に必ず店舗プランを付与）
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
    insert into public.organizations(name)
    values (
      coalesce(
        nullif(trim(coalesce(p_org_name, '')), ''),
        'TEPPEN MEO 新規組織'
      )
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
