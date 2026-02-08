-- TEPPEN MEO Phase0 foundation migration
-- 最終更新: 2026-02-06
--
-- 目的:
-- - provider_catalog / provider_capabilities / provider_configurations / provider_secrets / feature_flags を追加
-- - provider追加・機能公開制御・Secrets管理の基盤を作る
-- - RLSを追加してADMINのみ変更可能にする
--
-- 前提:
-- - supabase/schema.sql と supabase/rls.sql が適用済みであること

create extension if not exists "pgcrypto";

create table if not exists public.provider_catalog (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  provider_key text not null,
  display_name text not null,
  provider_kind text not null check (provider_kind in ('NATIVE', 'GENERIC')),
  auth_kind text not null check (auth_kind in ('OAUTH2', 'API_KEY', 'WEBHOOK', 'NONE')),
  default_visibility text not null default 'ADMIN_ONLY'
    check (default_visibility in ('HIDDEN', 'ADMIN_ONLY', 'ENABLED')),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, provider_key)
);

create table if not exists public.provider_capabilities (
  id uuid primary key default gen_random_uuid(),
  provider_catalog_id uuid not null references public.provider_catalog(id) on delete cascade,
  can_connect boolean not null default true,
  can_sync_inbox boolean not null default true,
  can_publish boolean not null default false,
  can_reply boolean not null default false,
  can_fetch_metrics boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_catalog_id)
);

create table if not exists public.provider_configurations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  provider_catalog_id uuid not null references public.provider_catalog(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  has_gui_config boolean not null default false,
  connection_status text not null default 'DISCONNECTED'
    check (connection_status in ('CONNECTED', 'DISCONNECTED', 'ERROR')),
  last_tested_at timestamptz,
  last_error text,
  secret_updated_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, provider_catalog_id)
);

create table if not exists public.provider_secrets (
  id uuid primary key default gen_random_uuid(),
  provider_configuration_id uuid not null references public.provider_configurations(id) on delete cascade,
  encrypted_secret text not null,
  key_version text not null default 'v1',
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_configuration_id)
);

create table if not exists public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.stores(id) on delete cascade,
  feature_key text not null,
  state text not null check (state in ('HIDDEN', 'ADMIN_ONLY', 'ENABLED')),
  note text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists provider_catalog_org_id_idx on public.provider_catalog(org_id);
create index if not exists provider_catalog_key_idx on public.provider_catalog(provider_key);
create index if not exists provider_capabilities_catalog_id_idx on public.provider_capabilities(provider_catalog_id);
create index if not exists provider_configurations_store_id_idx on public.provider_configurations(store_id);
create index if not exists provider_configurations_catalog_id_idx on public.provider_configurations(provider_catalog_id);
create index if not exists provider_secrets_provider_configuration_id_idx on public.provider_secrets(provider_configuration_id);
create index if not exists feature_flags_org_id_idx on public.feature_flags(org_id);
create index if not exists feature_flags_store_id_idx on public.feature_flags(store_id);
create index if not exists feature_flags_feature_key_idx on public.feature_flags(feature_key);
alter table public.feature_flags
  drop constraint if exists feature_flags_org_id_store_id_feature_key_key;
create unique index if not exists feature_flags_org_feature_key_unique_idx
  on public.feature_flags(org_id, feature_key)
  where store_id is null;
create unique index if not exists feature_flags_store_feature_key_unique_idx
  on public.feature_flags(org_id, store_id, feature_key)
  where store_id is not null;

drop trigger if exists provider_catalog_set_updated_at on public.provider_catalog;
create trigger provider_catalog_set_updated_at
before update on public.provider_catalog
for each row execute function public.set_updated_at();

drop trigger if exists provider_capabilities_set_updated_at on public.provider_capabilities;
create trigger provider_capabilities_set_updated_at
before update on public.provider_capabilities
for each row execute function public.set_updated_at();

drop trigger if exists provider_configurations_set_updated_at on public.provider_configurations;
create trigger provider_configurations_set_updated_at
before update on public.provider_configurations
for each row execute function public.set_updated_at();

drop trigger if exists provider_secrets_set_updated_at on public.provider_secrets;
create trigger provider_secrets_set_updated_at
before update on public.provider_secrets
for each row execute function public.set_updated_at();

drop trigger if exists feature_flags_set_updated_at on public.feature_flags;
create trigger feature_flags_set_updated_at
before update on public.feature_flags
for each row execute function public.set_updated_at();

insert into public.provider_catalog (
  org_id,
  provider_key,
  display_name,
  provider_kind,
  auth_kind,
  default_visibility
)
select
  org.id,
  seed.provider_key,
  seed.display_name,
  seed.provider_kind,
  seed.auth_kind,
  'ADMIN_ONLY'
from public.organizations org
cross join (
  values
    ('GBP', 'Google Business Profile', 'NATIVE', 'OAUTH2'),
    ('INSTAGRAM', 'Instagram', 'NATIVE', 'OAUTH2'),
    ('FACEBOOK', 'Facebook', 'NATIVE', 'OAUTH2')
) as seed(provider_key, display_name, provider_kind, auth_kind)
on conflict (org_id, provider_key) do nothing;

insert into public.provider_capabilities (
  provider_catalog_id,
  can_connect,
  can_sync_inbox,
  can_publish,
  can_reply,
  can_fetch_metrics
)
select
  catalog.id,
  true,
  true,
  catalog.provider_key in ('INSTAGRAM', 'FACEBOOK'),
  catalog.provider_key in ('GBP', 'FACEBOOK'),
  catalog.provider_key in ('GBP', 'INSTAGRAM', 'FACEBOOK')
from public.provider_catalog catalog
left join public.provider_capabilities capability
  on capability.provider_catalog_id = catalog.id
where capability.id is null;

create or replace function public.actor_is_org_admin(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.actor_highest_role_in_org(target_org_id) = 'ADMIN';
$$;

create or replace function public.actor_is_store_admin(target_store_id uuid)
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
      and public.actor_is_org_admin(s.org_id)
  );
$$;

create or replace function public.provider_catalog_org(target_provider_catalog_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select pc.org_id
  from public.provider_catalog pc
  where pc.id = target_provider_catalog_id;
$$;

create or replace function public.provider_catalog_belongs_to_store(target_provider_catalog_id uuid, target_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.provider_catalog pc
    join public.stores s on s.id = target_store_id
    where pc.id = target_provider_catalog_id
      and pc.org_id = s.org_id
  );
$$;

alter table public.provider_catalog enable row level security;
alter table public.provider_capabilities enable row level security;
alter table public.provider_configurations enable row level security;
alter table public.provider_secrets enable row level security;
alter table public.feature_flags enable row level security;

drop policy if exists provider_catalog_select_by_org_scope on public.provider_catalog;
create policy provider_catalog_select_by_org_scope
on public.provider_catalog
for select
using (public.user_has_org_access(org_id));

drop policy if exists provider_catalog_insert_by_org_admin on public.provider_catalog;
create policy provider_catalog_insert_by_org_admin
on public.provider_catalog
for insert
with check (public.actor_is_org_admin(org_id));

drop policy if exists provider_catalog_update_by_org_admin on public.provider_catalog;
create policy provider_catalog_update_by_org_admin
on public.provider_catalog
for update
using (public.actor_is_org_admin(org_id))
with check (public.actor_is_org_admin(org_id));

drop policy if exists provider_catalog_delete_by_org_admin on public.provider_catalog;
create policy provider_catalog_delete_by_org_admin
on public.provider_catalog
for delete
using (public.actor_is_org_admin(org_id));

drop policy if exists provider_capabilities_select_by_org_scope on public.provider_capabilities;
create policy provider_capabilities_select_by_org_scope
on public.provider_capabilities
for select
using (public.user_has_org_access(public.provider_catalog_org(provider_catalog_id)));

drop policy if exists provider_capabilities_insert_by_org_admin on public.provider_capabilities;
create policy provider_capabilities_insert_by_org_admin
on public.provider_capabilities
for insert
with check (public.actor_is_org_admin(public.provider_catalog_org(provider_catalog_id)));

drop policy if exists provider_capabilities_update_by_org_admin on public.provider_capabilities;
create policy provider_capabilities_update_by_org_admin
on public.provider_capabilities
for update
using (public.actor_is_org_admin(public.provider_catalog_org(provider_catalog_id)))
with check (public.actor_is_org_admin(public.provider_catalog_org(provider_catalog_id)));

drop policy if exists provider_capabilities_delete_by_org_admin on public.provider_capabilities;
create policy provider_capabilities_delete_by_org_admin
on public.provider_capabilities
for delete
using (public.actor_is_org_admin(public.provider_catalog_org(provider_catalog_id)));

drop policy if exists provider_configurations_select_by_store_scope on public.provider_configurations;
create policy provider_configurations_select_by_store_scope
on public.provider_configurations
for select
using (public.user_has_store_access(store_id));

drop policy if exists provider_configurations_insert_by_store_admin on public.provider_configurations;
create policy provider_configurations_insert_by_store_admin
on public.provider_configurations
for insert
with check (
  public.actor_is_store_admin(store_id)
  and public.provider_catalog_belongs_to_store(provider_catalog_id, store_id)
);

drop policy if exists provider_configurations_update_by_store_admin on public.provider_configurations;
create policy provider_configurations_update_by_store_admin
on public.provider_configurations
for update
using (public.actor_is_store_admin(store_id))
with check (
  public.actor_is_store_admin(store_id)
  and public.provider_catalog_belongs_to_store(provider_catalog_id, store_id)
);

drop policy if exists provider_configurations_delete_by_store_admin on public.provider_configurations;
create policy provider_configurations_delete_by_store_admin
on public.provider_configurations
for delete
using (public.actor_is_store_admin(store_id));

drop policy if exists provider_secrets_deny_all on public.provider_secrets;
create policy provider_secrets_deny_all
on public.provider_secrets
for all
using (false)
with check (false);

drop policy if exists feature_flags_select_by_scope on public.feature_flags;
create policy feature_flags_select_by_scope
on public.feature_flags
for select
using (
  public.user_has_org_access(org_id)
  and (
    store_id is null
    or public.user_has_store_access(store_id)
  )
);

drop policy if exists feature_flags_insert_by_org_admin on public.feature_flags;
create policy feature_flags_insert_by_org_admin
on public.feature_flags
for insert
with check (
  public.actor_is_org_admin(org_id)
  and (
    store_id is null
    or public.actor_is_store_admin(store_id)
  )
);

drop policy if exists feature_flags_update_by_org_admin on public.feature_flags;
create policy feature_flags_update_by_org_admin
on public.feature_flags
for update
using (
  public.actor_is_org_admin(org_id)
  and (
    store_id is null
    or public.actor_is_store_admin(store_id)
  )
)
with check (
  public.actor_is_org_admin(org_id)
  and (
    store_id is null
    or public.actor_is_store_admin(store_id)
  )
);

drop policy if exists feature_flags_delete_by_org_admin on public.feature_flags;
create policy feature_flags_delete_by_org_admin
on public.feature_flags
for delete
using (
  public.actor_is_org_admin(org_id)
  and (
    store_id is null
    or public.actor_is_store_admin(store_id)
  )
);
