-- Phase5: Fix ambiguous org_id reference in create_store_for_actor()
-- 背景:
-- - returns table の出力列 org_id と ON CONFLICT (org_id) が衝突し、
--   `column reference "org_id" is ambiguous (42702)` が発生する場合がある。
-- 対応:
-- - ON CONFLICT を制約名指定へ切替
-- - ロール順位に SUPERVISOR を追加

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
begin
  if actor_id is null then
    raise exception 'unauthenticated';
  end if;

  if nullif(trim(coalesce(p_store_name, '')), '') is null then
    raise exception 'STORE_NAME_REQUIRED';
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
