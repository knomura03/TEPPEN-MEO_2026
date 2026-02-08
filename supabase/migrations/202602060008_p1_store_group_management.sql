-- TEPPEN MEO Phase1 ticket P1-08 (store group management)
-- 最終更新: 2026-02-06
--
-- 目的:
-- - 店舗をグルーピングするCRUD基盤を追加する
-- - グループ単位の一括運用（P1-09）に向けた権限制御を先行整備する

create table if not exists public.store_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);

create index if not exists store_groups_org_id_idx on public.store_groups(org_id);
create index if not exists store_groups_name_idx on public.store_groups(name);

drop trigger if exists store_groups_set_updated_at on public.store_groups;
create trigger store_groups_set_updated_at
before update on public.store_groups
for each row execute function public.set_updated_at();

create table if not exists public.store_group_stores (
  id uuid primary key default gen_random_uuid(),
  store_group_id uuid not null references public.store_groups(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (store_group_id, store_id)
);

create index if not exists store_group_stores_group_id_idx on public.store_group_stores(store_group_id);
create index if not exists store_group_stores_store_id_idx on public.store_group_stores(store_id);

create or replace function public.actor_can_manage_store_groups(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.actor_highest_role_in_org(target_org_id) in ('ADMIN', 'MANAGER');
$$;

create or replace function public.store_group_org(target_store_group_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select sg.org_id
  from public.store_groups sg
  where sg.id = target_store_group_id;
$$;

create or replace function public.store_belongs_to_org(target_store_id uuid, target_org_id uuid)
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
      and s.org_id = target_org_id
  );
$$;

alter table public.store_groups enable row level security;

drop policy if exists store_groups_select_by_org_scope on public.store_groups;
create policy store_groups_select_by_org_scope
on public.store_groups
for select
using (public.user_has_org_access(org_id));

drop policy if exists store_groups_insert_by_org_manager on public.store_groups;
create policy store_groups_insert_by_org_manager
on public.store_groups
for insert
with check (public.actor_can_manage_store_groups(org_id));

drop policy if exists store_groups_update_by_org_manager on public.store_groups;
create policy store_groups_update_by_org_manager
on public.store_groups
for update
using (public.actor_can_manage_store_groups(org_id))
with check (public.actor_can_manage_store_groups(org_id));

drop policy if exists store_groups_delete_by_org_manager on public.store_groups;
create policy store_groups_delete_by_org_manager
on public.store_groups
for delete
using (public.actor_can_manage_store_groups(org_id));

alter table public.store_group_stores enable row level security;

drop policy if exists store_group_stores_select_by_org_scope on public.store_group_stores;
create policy store_group_stores_select_by_org_scope
on public.store_group_stores
for select
using (
  exists (
    select 1
    from public.store_groups sg
    where sg.id = store_group_id
      and public.user_has_org_access(sg.org_id)
      and public.user_has_store_access(store_id)
  )
);

drop policy if exists store_group_stores_insert_by_org_manager on public.store_group_stores;
create policy store_group_stores_insert_by_org_manager
on public.store_group_stores
for insert
with check (
  exists (
    select 1
    from public.store_groups sg
    where sg.id = store_group_id
      and public.actor_can_manage_store_groups(sg.org_id)
      and public.store_belongs_to_org(store_id, sg.org_id)
      and public.user_has_store_access(store_id)
  )
);

drop policy if exists store_group_stores_delete_by_org_manager on public.store_group_stores;
create policy store_group_stores_delete_by_org_manager
on public.store_group_stores
for delete
using (
  exists (
    select 1
    from public.store_groups sg
    where sg.id = store_group_id
      and public.actor_can_manage_store_groups(sg.org_id)
      and public.user_has_store_access(store_id)
  )
);
