-- TEPPEN MEO MVP schema
-- 最終更新: 2026-02-03

-- UUID生成のため
create extension if not exists "pgcrypto";

-- updated_at を自動更新するトリガー
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 基本（ユーザー/組織/店舗）
-- ------------------------------------------------------------

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  address text,
  phone text,
  website text,
  category text,
  business_hours text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stores_org_id_idx on public.stores(org_id);
drop trigger if exists stores_set_updated_at on public.stores;
create trigger stores_set_updated_at
before update on public.stores
for each row execute function public.set_updated_at();

-- Supabase Auth のユーザーに紐づくプロフィール（アプリ側）
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Membership: user ↔ org/store + role/permissions
create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.stores(id) on delete cascade,
  role text not null,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memberships_user_id_idx on public.memberships(user_id);
create index if not exists memberships_org_id_idx on public.memberships(org_id);
create index if not exists memberships_store_id_idx on public.memberships(store_id);
drop trigger if exists memberships_set_updated_at on public.memberships;
create trigger memberships_set_updated_at
before update on public.memberships
for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 投稿
-- ------------------------------------------------------------

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  content text not null,
  status text not null,
  platforms text[] not null default '{}'::text[],
  scheduled_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists posts_store_id_idx on public.posts(store_id);
create index if not exists posts_author_user_id_idx on public.posts(author_user_id);
create index if not exists posts_scheduled_at_idx on public.posts(scheduled_at);
drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at
before update on public.posts
for each row execute function public.set_updated_at();

create table if not exists public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  storage_path text not null,
  mime text,
  size bigint,
  created_at timestamptz not null default now()
);

create index if not exists post_media_post_id_idx on public.post_media(post_id);
create index if not exists post_media_store_id_idx on public.post_media(store_id);

-- ------------------------------------------------------------
-- 外部連携（GBP）
-- ------------------------------------------------------------

create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  provider text not null, -- e.g. 'GBP'
  status text not null default 'DISCONNECTED',
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, provider)
);

create index if not exists integrations_store_id_idx on public.integrations(store_id);
drop trigger if exists integrations_set_updated_at on public.integrations;
create trigger integrations_set_updated_at
before update on public.integrations
for each row execute function public.set_updated_at();

create table if not exists public.gbp_locations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  location_id text not null,
  created_at timestamptz not null default now(),
  unique (store_id, location_id)
);

create index if not exists gbp_locations_store_id_idx on public.gbp_locations(store_id);

-- OAuth資格情報（トークン等）はクライアントから読めない前提で別テーブルに分離
create table if not exists public.integration_credentials (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integrations(id) on delete cascade,
  encrypted_payload text not null, -- 暗号化された資格情報（実装で確定）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id)
);

drop trigger if exists integration_credentials_set_updated_at on public.integration_credentials;
create trigger integration_credentials_set_updated_at
before update on public.integration_credentials
for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 受信箱（MVPはGBPレビュー）
-- ------------------------------------------------------------

create table if not exists public.inbox_threads (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  provider text not null, -- 'GBP'
  external_thread_id text not null,
  status text not null default 'OPEN',
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_thread_id)
);

create index if not exists inbox_threads_store_id_idx on public.inbox_threads(store_id);
drop trigger if exists inbox_threads_set_updated_at on public.inbox_threads;
create trigger inbox_threads_set_updated_at
before update on public.inbox_threads
for each row execute function public.set_updated_at();

create table if not exists public.inbox_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.inbox_threads(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  provider text not null,
  external_message_id text not null,
  sender_name text,
  sender_avatar_url text,
  content text not null,
  received_at timestamptz not null,
  is_replied boolean not null default false,
  reply_content text,
  reply_sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, external_message_id)
);

create index if not exists inbox_messages_thread_id_idx on public.inbox_messages(thread_id);
create index if not exists inbox_messages_store_id_idx on public.inbox_messages(store_id);
create index if not exists inbox_messages_received_at_idx on public.inbox_messages(received_at);

-- ------------------------------------------------------------
-- 監査ログ
-- ------------------------------------------------------------

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  store_id uuid references public.stores(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_org_id_idx on public.audit_logs(org_id);
create index if not exists audit_logs_store_id_idx on public.audit_logs(store_id);
create index if not exists audit_logs_actor_user_id_idx on public.audit_logs(actor_user_id);
create index if not exists audit_logs_created_at_idx on public.audit_logs(created_at);
