-- TEPPEN MEO Phase4 foundation migration (billing + PWA)
-- 最終更新: 2026-02-09
--
-- 目的:
-- - 課金基盤テーブル（plan / subscription / invoice / usage event）を追加する
-- - PWAインストール記録テーブルを追加する
-- - Phase監査（Phase4 DB存在監査）が要求する列を満たす

create table if not exists public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  amount_monthly integer not null check (amount_monthly >= 0),
  currency text not null default 'JPY',
  is_active boolean not null default true,
  description text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.org_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  billing_plan_id uuid references public.billing_plans(id) on delete set null,
  status text not null default 'ACTIVE'
    check (status in ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'INCOMPLETE', 'PAUSED')),
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  org_subscription_id uuid not null references public.org_subscriptions(id) on delete cascade,
  status text not null default 'OPEN' check (status in ('DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE')),
  amount_total integer not null check (amount_total >= 0),
  amount_paid integer not null default 0 check (amount_paid >= 0),
  currency text not null default 'JPY',
  invoice_url text,
  period_start timestamptz,
  period_end timestamptz,
  issued_at timestamptz not null default now(),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.subscription_usage_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  feature_key text not null,
  quantity integer not null default 1,
  unit text not null default 'COUNT',
  occurred_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.pwa_installations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null default 'web',
  app_version text,
  installed_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, platform)
);

create index if not exists billing_plans_is_active_idx
  on public.billing_plans(is_active);
create index if not exists org_subscriptions_org_id_idx
  on public.org_subscriptions(org_id);
create index if not exists org_subscriptions_status_idx
  on public.org_subscriptions(status);
create index if not exists billing_invoices_org_subscription_id_idx
  on public.billing_invoices(org_subscription_id);
create index if not exists billing_invoices_status_idx
  on public.billing_invoices(status);
create index if not exists subscription_usage_events_org_id_idx
  on public.subscription_usage_events(org_id);
create index if not exists subscription_usage_events_feature_key_idx
  on public.subscription_usage_events(feature_key);
create index if not exists pwa_installations_user_id_idx
  on public.pwa_installations(user_id);

drop trigger if exists billing_plans_set_updated_at on public.billing_plans;
create trigger billing_plans_set_updated_at
before update on public.billing_plans
for each row execute function public.set_updated_at();

drop trigger if exists org_subscriptions_set_updated_at on public.org_subscriptions;
create trigger org_subscriptions_set_updated_at
before update on public.org_subscriptions
for each row execute function public.set_updated_at();

create or replace function public.org_subscription_org(target_org_subscription_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select os.org_id
  from public.org_subscriptions os
  where os.id = target_org_subscription_id
$$;

alter table public.billing_plans enable row level security;
alter table public.org_subscriptions enable row level security;
alter table public.billing_invoices enable row level security;
alter table public.subscription_usage_events enable row level security;
alter table public.pwa_installations enable row level security;

drop policy if exists billing_plans_select_authenticated on public.billing_plans;
create policy billing_plans_select_authenticated
on public.billing_plans
for select
to authenticated
using (true);

drop policy if exists billing_plans_mutate_admin_only on public.billing_plans;
create policy billing_plans_mutate_admin_only
on public.billing_plans
for all
to authenticated
using (false)
with check (false);

drop policy if exists org_subscriptions_select_by_org_scope on public.org_subscriptions;
create policy org_subscriptions_select_by_org_scope
on public.org_subscriptions
for select
using (public.user_has_org_access(org_id));

drop policy if exists org_subscriptions_insert_by_org_admin on public.org_subscriptions;
create policy org_subscriptions_insert_by_org_admin
on public.org_subscriptions
for insert
with check (public.actor_is_org_admin(org_id));

drop policy if exists org_subscriptions_update_by_org_admin on public.org_subscriptions;
create policy org_subscriptions_update_by_org_admin
on public.org_subscriptions
for update
using (public.actor_is_org_admin(org_id))
with check (public.actor_is_org_admin(org_id));

drop policy if exists org_subscriptions_delete_by_org_admin on public.org_subscriptions;
create policy org_subscriptions_delete_by_org_admin
on public.org_subscriptions
for delete
using (public.actor_is_org_admin(org_id));

drop policy if exists billing_invoices_select_by_org_scope on public.billing_invoices;
create policy billing_invoices_select_by_org_scope
on public.billing_invoices
for select
using (public.user_has_org_access(public.org_subscription_org(org_subscription_id)));

drop policy if exists billing_invoices_insert_by_org_admin on public.billing_invoices;
create policy billing_invoices_insert_by_org_admin
on public.billing_invoices
for insert
with check (public.actor_is_org_admin(public.org_subscription_org(org_subscription_id)));

drop policy if exists billing_invoices_update_by_org_admin on public.billing_invoices;
create policy billing_invoices_update_by_org_admin
on public.billing_invoices
for update
using (public.actor_is_org_admin(public.org_subscription_org(org_subscription_id)))
with check (public.actor_is_org_admin(public.org_subscription_org(org_subscription_id)));

drop policy if exists billing_invoices_delete_by_org_admin on public.billing_invoices;
create policy billing_invoices_delete_by_org_admin
on public.billing_invoices
for delete
using (public.actor_is_org_admin(public.org_subscription_org(org_subscription_id)));

drop policy if exists subscription_usage_events_select_by_org_scope on public.subscription_usage_events;
create policy subscription_usage_events_select_by_org_scope
on public.subscription_usage_events
for select
using (public.user_has_org_access(org_id));

drop policy if exists subscription_usage_events_insert_by_org_admin on public.subscription_usage_events;
create policy subscription_usage_events_insert_by_org_admin
on public.subscription_usage_events
for insert
with check (public.actor_is_org_admin(org_id));

drop policy if exists subscription_usage_events_update_by_org_admin on public.subscription_usage_events;
create policy subscription_usage_events_update_by_org_admin
on public.subscription_usage_events
for update
using (public.actor_is_org_admin(org_id))
with check (public.actor_is_org_admin(org_id));

drop policy if exists subscription_usage_events_delete_by_org_admin on public.subscription_usage_events;
create policy subscription_usage_events_delete_by_org_admin
on public.subscription_usage_events
for delete
using (public.actor_is_org_admin(org_id));

drop policy if exists pwa_installations_select_self_or_org_admin on public.pwa_installations;
create policy pwa_installations_select_self_or_org_admin
on public.pwa_installations
for select
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.memberships m
    where m.user_id = pwa_installations.user_id
      and public.actor_is_org_admin(m.org_id)
  )
);

drop policy if exists pwa_installations_insert_self_or_org_admin on public.pwa_installations;
create policy pwa_installations_insert_self_or_org_admin
on public.pwa_installations
for insert
with check (
  auth.uid() = user_id
  or exists (
    select 1
    from public.memberships m
    where m.user_id = pwa_installations.user_id
      and public.actor_is_org_admin(m.org_id)
  )
);

drop policy if exists pwa_installations_update_self_or_org_admin on public.pwa_installations;
create policy pwa_installations_update_self_or_org_admin
on public.pwa_installations
for update
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.memberships m
    where m.user_id = pwa_installations.user_id
      and public.actor_is_org_admin(m.org_id)
  )
)
with check (
  auth.uid() = user_id
  or exists (
    select 1
    from public.memberships m
    where m.user_id = pwa_installations.user_id
      and public.actor_is_org_admin(m.org_id)
  )
);

drop policy if exists pwa_installations_delete_self_or_org_admin on public.pwa_installations;
create policy pwa_installations_delete_self_or_org_admin
on public.pwa_installations
for delete
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.memberships m
    where m.user_id = pwa_installations.user_id
      and public.actor_is_org_admin(m.org_id)
  )
);

grant select on public.billing_plans to authenticated;
grant select, insert, update, delete on public.org_subscriptions to authenticated;
grant select, insert, update, delete on public.billing_invoices to authenticated;
grant select, insert, update, delete on public.subscription_usage_events to authenticated;
grant select, insert, update, delete on public.pwa_installations to authenticated;

insert into public.billing_plans (
  code,
  name,
  amount_monthly,
  currency,
  is_active,
  description
)
values
  ('FREE', 'Free', 0, 'JPY', true, '監査・検証用のデフォルトプラン'),
  ('STANDARD', 'Standard', 9800, 'JPY', true, '標準プラン'),
  ('PRO', 'Pro', 29800, 'JPY', true, '上位プラン')
on conflict (code) do nothing;
