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
  approval_status text not null default 'NONE'
    check (approval_status in ('NONE', 'PENDING', 'APPROVED', 'REJECTED')),
  submitted_for_approval_at timestamptz,
  approved_at timestamptz,
  approved_by_user_id uuid references auth.users(id) on delete set null,
  rejected_at timestamptz,
  rejected_by_user_id uuid references auth.users(id) on delete set null,
  rejection_reason text,
  platforms text[] not null default '{}'::text[],
  scheduled_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists posts_store_id_idx on public.posts(store_id);
create index if not exists posts_author_user_id_idx on public.posts(author_user_id);
create index if not exists posts_scheduled_at_idx on public.posts(scheduled_at);
create index if not exists posts_approval_status_idx on public.posts(approval_status);
create index if not exists posts_submitted_for_approval_at_idx on public.posts(submitted_for_approval_at);
drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at
before update on public.posts
for each row execute function public.set_updated_at();

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

create table if not exists public.post_approval_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action_type text not null
    check (action_type in ('SUBMIT', 'APPROVE', 'REJECT', 'COMMENT')),
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists post_approval_comments_post_id_idx on public.post_approval_comments(post_id);
create index if not exists post_approval_comments_created_at_idx on public.post_approval_comments(created_at);

create table if not exists public.brand_kits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  tone_guide text,
  banned_words text[] not null default '{}'::text[],
  recommended_hashtags text[] not null default '{}'::text[],
  default_signature text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id)
);

create table if not exists public.post_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  body text not null,
  default_platforms text[] not null default '{}'::text[],
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, title)
);

create index if not exists brand_kits_org_id_idx on public.brand_kits(org_id);
create index if not exists post_templates_org_id_idx on public.post_templates(org_id);
create index if not exists post_templates_active_idx on public.post_templates(is_active);
create index if not exists post_templates_platforms_gin_idx on public.post_templates using gin (default_platforms);

drop trigger if exists brand_kits_set_updated_at on public.brand_kits;
create trigger brand_kits_set_updated_at
before update on public.brand_kits
for each row execute function public.set_updated_at();

drop trigger if exists post_templates_set_updated_at on public.post_templates;
create trigger post_templates_set_updated_at
before update on public.post_templates
for each row execute function public.set_updated_at();

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
      and m.role in ('ADMIN', 'MANAGER')
  );
end;
$$;

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

create table if not exists public.rank_keywords (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  keyword text not null,
  note text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rank_keywords_keyword_len_check check (char_length(keyword) between 1 and 80)
);

create index if not exists rank_keywords_store_id_idx on public.rank_keywords(store_id);
create index if not exists rank_keywords_active_idx on public.rank_keywords(is_active);
create unique index if not exists rank_keywords_store_keyword_unique_idx
  on public.rank_keywords(store_id, lower(keyword));

drop trigger if exists rank_keywords_set_updated_at on public.rank_keywords;
create trigger rank_keywords_set_updated_at
before update on public.rank_keywords
for each row execute function public.set_updated_at();

create table if not exists public.rank_collection_runs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  trigger_type text not null default 'MANUAL' check (trigger_type in ('MANUAL', 'SCHEDULED')),
  mode text not null default 'MOCK' check (mode in ('REAL', 'MOCK')),
  status text not null default 'RUNNING' check (status in ('RUNNING', 'SUCCESS', 'FAILED')),
  message text,
  requested_by_user_id uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists rank_collection_runs_store_id_idx on public.rank_collection_runs(store_id);
create index if not exists rank_collection_runs_created_at_idx on public.rank_collection_runs(created_at);

create table if not exists public.rank_collection_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.rank_collection_runs(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  rank_keyword_id uuid not null references public.rank_keywords(id) on delete cascade,
  keyword text not null,
  position integer,
  mode text not null default 'MOCK' check (mode in ('REAL', 'MOCK')),
  status text not null default 'SUCCESS' check (status in ('SUCCESS', 'FAILED')),
  message text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint rank_collection_results_position_check check (position is null or position >= 1)
);

create index if not exists rank_collection_results_run_id_idx on public.rank_collection_results(run_id);
create index if not exists rank_collection_results_store_id_idx on public.rank_collection_results(store_id);
create index if not exists rank_collection_results_keyword_id_idx on public.rank_collection_results(rank_keyword_id);
create index if not exists rank_collection_results_created_at_idx on public.rank_collection_results(created_at);
create unique index if not exists rank_collection_results_run_keyword_unique_idx
  on public.rank_collection_results(run_id, rank_keyword_id);

create table if not exists public.competitor_targets (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  note text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint competitor_targets_name_len_check check (char_length(name) between 1 and 120)
);

create index if not exists competitor_targets_store_id_idx on public.competitor_targets(store_id);
create index if not exists competitor_targets_active_idx on public.competitor_targets(is_active);
create unique index if not exists competitor_targets_store_name_unique_idx
  on public.competitor_targets(store_id, lower(name));

drop trigger if exists competitor_targets_set_updated_at on public.competitor_targets;
create trigger competitor_targets_set_updated_at
before update on public.competitor_targets
for each row execute function public.set_updated_at();

create table if not exists public.competitor_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.rank_collection_runs(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  competitor_target_id uuid not null references public.competitor_targets(id) on delete cascade,
  competitor_name text not null,
  map_rank integer,
  review_count integer not null default 0,
  rating numeric(2,1),
  mode text not null default 'MOCK' check (mode in ('REAL', 'MOCK')),
  status text not null default 'SUCCESS' check (status in ('SUCCESS', 'FAILED')),
  message text,
  raw jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint competitor_metric_snapshots_map_rank_check check (map_rank is null or map_rank >= 1),
  constraint competitor_metric_snapshots_review_count_check check (review_count >= 0),
  constraint competitor_metric_snapshots_rating_check check (rating is null or (rating >= 0 and rating <= 5))
);

create index if not exists competitor_metric_snapshots_run_id_idx on public.competitor_metric_snapshots(run_id);
create index if not exists competitor_metric_snapshots_store_id_idx on public.competitor_metric_snapshots(store_id);
create index if not exists competitor_metric_snapshots_target_id_idx on public.competitor_metric_snapshots(competitor_target_id);
create index if not exists competitor_metric_snapshots_collected_at_idx on public.competitor_metric_snapshots(collected_at);
create unique index if not exists competitor_metric_snapshots_run_target_unique_idx
  on public.competitor_metric_snapshots(run_id, competitor_target_id);

create table if not exists public.nap_consistency_runs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  trigger_type text not null default 'MANUAL' check (trigger_type in ('MANUAL', 'SCHEDULED')),
  status text not null default 'RUNNING' check (status in ('RUNNING', 'SUCCESS', 'FAILED')),
  message text,
  summary jsonb not null default '{}'::jsonb,
  requested_by_user_id uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists nap_consistency_runs_store_id_idx on public.nap_consistency_runs(store_id);
create index if not exists nap_consistency_runs_created_at_idx on public.nap_consistency_runs(created_at);

create table if not exists public.nap_consistency_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.nap_consistency_runs(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  provider_catalog_id uuid references public.provider_catalog(id) on delete set null,
  provider_key text not null,
  provider_name text not null,
  expected_name text,
  expected_address text,
  expected_phone text,
  observed_name text,
  observed_address text,
  observed_phone text,
  name_match boolean,
  address_match boolean,
  phone_match boolean,
  status text not null default 'MISSING' check (status in ('MATCH', 'MISMATCH', 'MISSING')),
  mismatch_fields text[] not null default '{}'::text[],
  message text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists nap_consistency_results_run_id_idx on public.nap_consistency_results(run_id);
create index if not exists nap_consistency_results_store_id_idx on public.nap_consistency_results(store_id);
create index if not exists nap_consistency_results_provider_key_idx on public.nap_consistency_results(provider_key);
create index if not exists nap_consistency_results_created_at_idx on public.nap_consistency_results(created_at);
create unique index if not exists nap_consistency_results_run_provider_unique_idx
  on public.nap_consistency_results(run_id, provider_key);

create table if not exists public.nap_alerts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  provider_catalog_id uuid references public.provider_catalog(id) on delete set null,
  provider_key text not null,
  provider_name text not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'ACKED', 'RESOLVED')),
  last_result_status text not null default 'MISSING' check (last_result_status in ('MATCH', 'MISMATCH', 'MISSING')),
  mismatch_fields text[] not null default '{}'::text[],
  last_run_id uuid references public.nap_consistency_runs(id) on delete set null,
  last_result_id uuid references public.nap_consistency_results(id) on delete set null,
  first_detected_at timestamptz not null default now(),
  opened_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by_user_id uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  resolved_by_user_id uuid references auth.users(id) on delete set null,
  note text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, provider_key)
);

create index if not exists nap_alerts_store_id_idx on public.nap_alerts(store_id);
create index if not exists nap_alerts_status_idx on public.nap_alerts(status);
create index if not exists nap_alerts_last_detected_at_idx on public.nap_alerts(last_detected_at);
create index if not exists nap_alerts_updated_at_idx on public.nap_alerts(updated_at);

drop trigger if exists nap_alerts_set_updated_at on public.nap_alerts;
create trigger nap_alerts_set_updated_at
before update on public.nap_alerts
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

create table if not exists public.post_publish_logs (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  provider text not null,
  mode text not null check (mode in ('REAL', 'MOCK')),
  status text not null check (status in ('SUCCESS', 'FAILED')),
  message text,
  external_post_id text,
  requested_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists post_publish_logs_post_id_idx on public.post_publish_logs(post_id);
create index if not exists post_publish_logs_store_id_idx on public.post_publish_logs(store_id);
create index if not exists post_publish_logs_provider_idx on public.post_publish_logs(provider);
create index if not exists post_publish_logs_created_at_idx on public.post_publish_logs(created_at);

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
  reply_draft_content text,
  reply_draft_status text
    check (reply_draft_status in ('PENDING_APPROVAL', 'APPROVED', 'DISMISSED')),
  reply_draft_generated_at timestamptz,
  reply_draft_approved_at timestamptz,
  tags text[] not null default '{}'::text[],
  assigned_user_id uuid references auth.users(id) on delete set null,
  due_at timestamptz,
  sla_status text not null default 'ON_TRACK'
    check (sla_status in ('ON_TRACK', 'AT_RISK', 'OVERDUE', 'COMPLETED')),
  created_at timestamptz not null default now(),
  unique (provider, external_message_id)
);

create index if not exists inbox_messages_thread_id_idx on public.inbox_messages(thread_id);
create index if not exists inbox_messages_store_id_idx on public.inbox_messages(store_id);
create index if not exists inbox_messages_received_at_idx on public.inbox_messages(received_at);
create index if not exists inbox_messages_reply_draft_status_idx on public.inbox_messages(reply_draft_status);
create index if not exists inbox_messages_assigned_user_id_idx on public.inbox_messages(assigned_user_id);
create index if not exists inbox_messages_due_at_idx on public.inbox_messages(due_at);
create index if not exists inbox_messages_sla_status_idx on public.inbox_messages(sla_status);
create index if not exists inbox_messages_tags_gin_idx on public.inbox_messages using gin (tags);

create table if not exists public.inbox_reply_logs (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.inbox_messages(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  provider text not null,
  mode text not null check (mode in ('REAL', 'MOCK')),
  status text not null check (status in ('SUCCESS', 'FAILED')),
  message text,
  external_reply_id text,
  requested_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists inbox_reply_logs_message_id_idx on public.inbox_reply_logs(message_id);
create index if not exists inbox_reply_logs_store_id_idx on public.inbox_reply_logs(store_id);
create index if not exists inbox_reply_logs_provider_idx on public.inbox_reply_logs(provider);
create index if not exists inbox_reply_logs_created_at_idx on public.inbox_reply_logs(created_at);

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

-- ------------------------------------------------------------
-- Phase0 foundation: providers / feature flags / configs
-- ------------------------------------------------------------

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

create index if not exists provider_catalog_org_id_idx on public.provider_catalog(org_id);
create index if not exists provider_catalog_key_idx on public.provider_catalog(provider_key);
drop trigger if exists provider_catalog_set_updated_at on public.provider_catalog;
create trigger provider_catalog_set_updated_at
before update on public.provider_catalog
for each row execute function public.set_updated_at();

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

create index if not exists provider_capabilities_catalog_id_idx
  on public.provider_capabilities(provider_catalog_id);
drop trigger if exists provider_capabilities_set_updated_at on public.provider_capabilities;
create trigger provider_capabilities_set_updated_at
before update on public.provider_capabilities
for each row execute function public.set_updated_at();

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

create index if not exists provider_configurations_store_id_idx
  on public.provider_configurations(store_id);
create index if not exists provider_configurations_catalog_id_idx
  on public.provider_configurations(provider_catalog_id);
drop trigger if exists provider_configurations_set_updated_at on public.provider_configurations;
create trigger provider_configurations_set_updated_at
before update on public.provider_configurations
for each row execute function public.set_updated_at();

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

create index if not exists provider_secrets_provider_configuration_id_idx
  on public.provider_secrets(provider_configuration_id);
drop trigger if exists provider_secrets_set_updated_at on public.provider_secrets;
create trigger provider_secrets_set_updated_at
before update on public.provider_secrets
for each row execute function public.set_updated_at();

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

create index if not exists feature_flags_org_id_idx on public.feature_flags(org_id);
create index if not exists feature_flags_store_id_idx on public.feature_flags(store_id);
create index if not exists feature_flags_feature_key_idx on public.feature_flags(feature_key);
create unique index if not exists feature_flags_org_feature_key_unique_idx
  on public.feature_flags(org_id, feature_key)
  where store_id is null;
create unique index if not exists feature_flags_store_feature_key_unique_idx
  on public.feature_flags(org_id, store_id, feature_key)
  where store_id is not null;
drop trigger if exists feature_flags_set_updated_at on public.feature_flags;
create trigger feature_flags_set_updated_at
before update on public.feature_flags
for each row execute function public.set_updated_at();

-- 初期provider（既存組織向け）
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

-- ------------------------------------------------------------
-- Phase1 foundation: surveys
-- ------------------------------------------------------------

create table if not exists public.surveys (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  title text not null,
  description text,
  review_redirect_url text,
  positive_threshold integer not null default 4 check (positive_threshold between 2 and 5),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  public_token text unique,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists surveys_store_id_idx on public.surveys(store_id);
create index if not exists surveys_author_user_id_idx on public.surveys(author_user_id);
create index if not exists surveys_status_idx on public.surveys(status);
create index if not exists surveys_public_token_idx on public.surveys(public_token);
create unique index if not exists surveys_published_single_per_author_idx
  on public.surveys(author_user_id)
  where status = 'PUBLISHED';
drop trigger if exists surveys_set_updated_at on public.surveys;
create trigger surveys_set_updated_at
before update on public.surveys
for each row execute function public.set_updated_at();

create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  branch_type text not null check (branch_type in ('POSITIVE', 'NEGATIVE')),
  comment text,
  source text not null default 'PUBLIC_URL',
  created_at timestamptz not null default now()
);

create index if not exists survey_responses_survey_id_idx on public.survey_responses(survey_id);
create index if not exists survey_responses_created_at_idx on public.survey_responses(created_at);

create table if not exists public.survey_events (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys(id) on delete cascade,
  event_type text not null check (event_type in ('VIEW', 'REDIRECT_CLICK')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists survey_events_survey_id_idx on public.survey_events(survey_id);
create index if not exists survey_events_event_type_idx on public.survey_events(event_type);
create index if not exists survey_events_created_at_idx on public.survey_events(created_at);

create or replace function public.is_published_survey(target_survey_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.surveys s
    where s.id = target_survey_id
      and s.status = 'PUBLISHED'
      and s.public_token is not null
  );
$$;
