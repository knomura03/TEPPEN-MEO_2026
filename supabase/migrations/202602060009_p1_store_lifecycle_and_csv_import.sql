-- TEPPEN MEO Phase1 ticket P1-08 extension (store lifecycle + CSV bulk create)
-- 最終更新: 2026-02-06
--
-- 目的:
-- - 店舗0件ユーザーがGUIだけで初回店舗を作成できるようにする
-- - USERごとの店舗上限とCSV一括店舗作成ON/OFFを管理できるようにする
-- - USERの店舗アクセスを「所属店舗のみ」に厳格化する

create table if not exists public.org_store_policies (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  default_user_store_limit integer not null default 1 check (default_user_store_limit >= 1),
  allow_user_store_creation boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_store_controls (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  max_stores integer check (max_stores is null or max_stores >= 1),
  allow_csv_store_bulk_create boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index if not exists org_store_policies_org_id_idx on public.org_store_policies(org_id);
create index if not exists user_store_controls_org_id_idx on public.user_store_controls(org_id);
create index if not exists user_store_controls_user_id_idx on public.user_store_controls(user_id);

drop trigger if exists org_store_policies_set_updated_at on public.org_store_policies;
create trigger org_store_policies_set_updated_at
before update on public.org_store_policies
for each row execute function public.set_updated_at();

drop trigger if exists user_store_controls_set_updated_at on public.user_store_controls;
create trigger user_store_controls_set_updated_at
before update on public.user_store_controls
for each row execute function public.set_updated_at();

create or replace function public.actor_can_manage_user_store_control(target_org_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.actor_highest_role_in_org(target_org_id) in ('ADMIN', 'MANAGER')
    and exists (
      select 1
      from public.memberships target_m
      where target_m.org_id = target_org_id
        and target_m.user_id = target_user_id
        and target_m.role = 'USER'
    );
$$;

create or replace function public.effective_user_store_limit(target_org_id uuid, target_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with policy as (
    select osp.default_user_store_limit
    from public.org_store_policies osp
    where osp.org_id = target_org_id
  ),
  control as (
    select usc.max_stores
    from public.user_store_controls usc
    where usc.org_id = target_org_id
      and usc.user_id = target_user_id
  )
  select greatest(
    1,
    coalesce(
      (select max_stores from control),
      (select default_user_store_limit from policy),
      1
    )
  );
$$;

create or replace function public.user_store_count(target_org_id uuid, target_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct m.store_id)::integer
  from public.memberships m
  where m.org_id = target_org_id
    and m.user_id = target_user_id
    and m.role = 'USER'
    and m.store_id is not null;
$$;

create or replace function public.can_user_create_store(target_org_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from public.memberships m
      where m.org_id = target_org_id
        and m.user_id = target_user_id
        and m.role = 'USER'
    )
    and coalesce(
      (
        select osp.allow_user_store_creation
        from public.org_store_policies osp
        where osp.org_id = target_org_id
      ),
      true
    )
    and public.user_store_count(target_org_id, target_user_id)
      < public.effective_user_store_limit(target_org_id, target_user_id);
$$;

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

  -- 既存所属が無いユーザーは、初回ブートストラップとして org + store + membership(USER) を作成。
  if p_org_id is null then
    select m.org_id
    into target_org_id
    from public.memberships m
    where m.user_id = actor_id
    order by
      case m.role
        when 'ADMIN' then 3
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
    on conflict (org_id) do nothing;

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
  on conflict (org_id) do nothing;

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

create or replace function public.bulk_create_stores_for_user(
  target_org_id uuid,
  target_user_id uuid,
  rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  line_no integer;
  row_item record;
  row_count integer := 0;
  current_count integer := 0;
  limit_value integer := 1;
  allow_bulk boolean := false;
  errors jsonb := '[]'::jsonb;
  seen_keys text[] := array[]::text[];
  duplicate_key text;
  store_name text;
  address text;
  phone text;
  category text;
  business_hours text;
  website text;
  created_store_id uuid;
begin
  if actor_id is null then
    raise exception 'unauthenticated';
  end if;

  if target_org_id is null or target_user_id is null then
    return jsonb_build_object(
      'ok', false,
      'created_count', 0,
      'errors', jsonb_build_array(
        jsonb_build_object('line', 1, 'column', 'target_user_id', 'code', 'REQUIRED', 'message', '対象組織または対象ユーザーが未指定です。')
      )
    );
  end if;

  if not public.actor_can_manage_user_store_control(target_org_id, target_user_id) then
    return jsonb_build_object(
      'ok', false,
      'created_count', 0,
      'errors', jsonb_build_array(
        jsonb_build_object('line', 1, 'column', 'target_user_id', 'code', 'FORBIDDEN', 'message', '対象ユーザーの店舗設定を管理する権限がありません。')
      )
    );
  end if;

  select coalesce(usc.allow_csv_store_bulk_create, false)
  into allow_bulk
  from public.user_store_controls usc
  where usc.org_id = target_org_id
    and usc.user_id = target_user_id;

  if not coalesce(allow_bulk, false) then
    return jsonb_build_object(
      'ok', false,
      'created_count', 0,
      'errors', jsonb_build_array(
        jsonb_build_object('line', 1, 'column', 'allow_csv_store_bulk_create', 'code', 'CSV_DISABLED', 'message', 'CSV一括店舗作成がOFFです。')
      )
    );
  end if;

  if rows is null or jsonb_typeof(rows) <> 'array' then
    return jsonb_build_object(
      'ok', false,
      'created_count', 0,
      'errors', jsonb_build_array(
        jsonb_build_object('line', 1, 'column', 'csv', 'code', 'INVALID_PAYLOAD', 'message', 'CSVデータ形式が不正です。')
      )
    );
  end if;

  row_count := jsonb_array_length(rows);
  if row_count = 0 then
    errors := errors || jsonb_build_array(
      jsonb_build_object('line', 1, 'column', 'csv', 'code', 'EMPTY', 'message', 'CSVに有効な行がありません。')
    );
  end if;
  if row_count > 500 then
    errors := errors || jsonb_build_array(
      jsonb_build_object('line', 1, 'column', 'csv', 'code', 'ROW_LIMIT', 'message', 'CSVの行数上限は500件です。')
    );
  end if;

  for row_item in
    select value, ordinality
    from jsonb_array_elements(rows) with ordinality
  loop
    line_no := row_item.ordinality + 1;

    if jsonb_typeof(row_item.value) <> 'object' then
      errors := errors || jsonb_build_array(
        jsonb_build_object('line', line_no, 'column', 'row', 'code', 'INVALID_ROW', 'message', '行データ形式が不正です。')
      );
      continue;
    end if;

    store_name := nullif(trim(coalesce(row_item.value->>'store_name', '')), '');
    address := nullif(trim(coalesce(row_item.value->>'address', '')), '');
    phone := nullif(trim(coalesce(row_item.value->>'phone', '')), '');
    category := nullif(trim(coalesce(row_item.value->>'category', '')), '');
    business_hours := nullif(trim(coalesce(row_item.value->>'business_hours', '')), '');
    website := nullif(trim(coalesce(row_item.value->>'website', '')), '');

    if store_name is null then
      errors := errors || jsonb_build_array(
        jsonb_build_object('line', line_no, 'column', 'store_name', 'code', 'REQUIRED', 'message', 'store_name は必須です。')
      );
    end if;
    if address is null then
      errors := errors || jsonb_build_array(
        jsonb_build_object('line', line_no, 'column', 'address', 'code', 'REQUIRED', 'message', 'address は必須です。')
      );
    end if;
    if phone is null then
      errors := errors || jsonb_build_array(
        jsonb_build_object('line', line_no, 'column', 'phone', 'code', 'REQUIRED', 'message', 'phone は必須です。')
      );
    end if;
    if category is null then
      errors := errors || jsonb_build_array(
        jsonb_build_object('line', line_no, 'column', 'category', 'code', 'REQUIRED', 'message', 'category は必須です。')
      );
    end if;

    if website is not null and website !~* '^https?://[^[:space:]]+$' then
      errors := errors || jsonb_build_array(
        jsonb_build_object('line', line_no, 'column', 'website', 'code', 'INVALID_URL', 'message', 'website は http:// または https:// で始まるURL形式で入力してください。')
      );
    end if;

    if store_name is not null and phone is not null then
      duplicate_key := lower(store_name) || '||' || phone;
      if duplicate_key = any(seen_keys) then
        errors := errors || jsonb_build_array(
          jsonb_build_object('line', line_no, 'column', 'store_name', 'code', 'DUPLICATE_IN_CSV', 'message', '同一CSV内で store_name + phone が重複しています。')
        );
      else
        seen_keys := array_append(seen_keys, duplicate_key);
      end if;

      if exists (
        select 1
        from public.stores s
        where s.org_id = target_org_id
          and lower(s.name) = lower(store_name)
          and coalesce(s.phone, '') = phone
      ) then
        errors := errors || jsonb_build_array(
          jsonb_build_object('line', line_no, 'column', 'store_name', 'code', 'DUPLICATE_EXISTING', 'message', '既存店舗と store_name + phone が重複しています。')
        );
      end if;
    end if;
  end loop;

  if jsonb_array_length(errors) = 0 then
    current_count := public.user_store_count(target_org_id, target_user_id);
    limit_value := public.effective_user_store_limit(target_org_id, target_user_id);
    if current_count + row_count > limit_value then
      errors := errors || jsonb_build_array(
        jsonb_build_object(
          'line', 1,
          'column', 'max_stores',
          'code', 'STORE_LIMIT_EXCEEDED',
          'message', format('上限を超えています。現在 %s / 上限 %s / 追加要求 %s', current_count, limit_value, row_count)
        )
      );
    end if;
  end if;

  if jsonb_array_length(errors) > 0 then
    return jsonb_build_object(
      'ok', false,
      'created_count', 0,
      'errors', errors
    );
  end if;

  for row_item in
    select value, ordinality
    from jsonb_array_elements(rows) with ordinality
  loop
    store_name := nullif(trim(coalesce(row_item.value->>'store_name', '')), '');
    address := nullif(trim(coalesce(row_item.value->>'address', '')), '');
    phone := nullif(trim(coalesce(row_item.value->>'phone', '')), '');
    category := nullif(trim(coalesce(row_item.value->>'category', '')), '');
    business_hours := nullif(trim(coalesce(row_item.value->>'business_hours', '')), '');
    website := nullif(trim(coalesce(row_item.value->>'website', '')), '');

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
      store_name,
      address,
      phone,
      website,
      category,
      business_hours
    )
    returning id into created_store_id;

    insert into public.memberships (
      user_id,
      org_id,
      store_id,
      role
    )
    values (
      target_user_id,
      target_org_id,
      created_store_id,
      'USER'
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'created_count', row_count,
    'errors', '[]'::jsonb
  );
end;
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
        m.role in ('ADMIN', 'MANAGER')
        or (m.role = 'USER' and m.store_id = target_store_id)
      )
  );
$$;

alter table public.org_store_policies enable row level security;
alter table public.user_store_controls enable row level security;

drop policy if exists org_store_policies_select_by_org_scope on public.org_store_policies;
create policy org_store_policies_select_by_org_scope
on public.org_store_policies
for select
using (public.user_has_org_access(org_id));

drop policy if exists org_store_policies_update_by_org_admin on public.org_store_policies;
create policy org_store_policies_update_by_org_admin
on public.org_store_policies
for update
using (public.actor_is_org_admin(org_id))
with check (public.actor_is_org_admin(org_id));

drop policy if exists org_store_policies_insert_by_org_admin on public.org_store_policies;
create policy org_store_policies_insert_by_org_admin
on public.org_store_policies
for insert
with check (public.actor_is_org_admin(org_id));

drop policy if exists user_store_controls_select_by_scope on public.user_store_controls;
create policy user_store_controls_select_by_scope
on public.user_store_controls
for select
using (
  user_id = auth.uid()
  or public.actor_can_manage_user_store_control(org_id, user_id)
);

drop policy if exists user_store_controls_insert_by_manager on public.user_store_controls;
create policy user_store_controls_insert_by_manager
on public.user_store_controls
for insert
with check (public.actor_can_manage_user_store_control(org_id, user_id));

drop policy if exists user_store_controls_update_by_manager on public.user_store_controls;
create policy user_store_controls_update_by_manager
on public.user_store_controls
for update
using (public.actor_can_manage_user_store_control(org_id, user_id))
with check (public.actor_can_manage_user_store_control(org_id, user_id));

drop policy if exists user_store_controls_delete_by_manager on public.user_store_controls;
create policy user_store_controls_delete_by_manager
on public.user_store_controls
for delete
using (public.actor_can_manage_user_store_control(org_id, user_id));

drop policy if exists stores_select_by_membership on public.stores;
create policy stores_select_by_membership
on public.stores
for select
using (
  exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.org_id = stores.org_id
      and (
        m.role in ('ADMIN', 'MANAGER')
        or (m.role = 'USER' and m.store_id = stores.id)
      )
  )
);

drop policy if exists stores_update_by_membership on public.stores;
create policy stores_update_by_membership
on public.stores
for update
using (
  exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.org_id = stores.org_id
      and (
        m.role in ('ADMIN', 'MANAGER')
        or (m.role = 'USER' and m.store_id = stores.id)
      )
  )
)
with check (
  exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.org_id = stores.org_id
      and (
        m.role in ('ADMIN', 'MANAGER')
        or (m.role = 'USER' and m.store_id = stores.id)
      )
  )
);

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
        m.role in ('ADMIN', 'MANAGER')
        or (
          m.role = 'USER'
          and public.can_user_create_store(stores.org_id, auth.uid())
        )
      )
  )
);
