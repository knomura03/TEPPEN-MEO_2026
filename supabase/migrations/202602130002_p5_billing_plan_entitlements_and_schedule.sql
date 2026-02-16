-- P5: 契約プラン拡張（機能制限 / SNS連携本数 / 予約切替）

alter table public.billing_plans
  add column if not exists feature_rules jsonb not null default '{}'::jsonb;

alter table public.billing_plans
  add column if not exists sns_connection_limit integer not null default 3;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'billing_plans_sns_connection_limit_check'
  ) then
    alter table public.billing_plans
      add constraint billing_plans_sns_connection_limit_check
      check (sns_connection_limit >= 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'billing_plans_feature_rules_object_check'
  ) then
    alter table public.billing_plans
      add constraint billing_plans_feature_rules_object_check
      check (jsonb_typeof(feature_rules) = 'object');
  end if;
end $$;

create table if not exists public.org_subscription_plan_schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
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

create index if not exists org_subscription_plan_schedules_org_effective_idx
  on public.org_subscription_plan_schedules(org_id, status, effective_at desc);

drop trigger if exists org_subscription_plan_schedules_set_updated_at on public.org_subscription_plan_schedules;
create trigger org_subscription_plan_schedules_set_updated_at
before update on public.org_subscription_plan_schedules
for each row execute function public.set_updated_at();

alter table public.org_subscription_plan_schedules enable row level security;

drop policy if exists org_subscription_plan_schedules_select_by_org_scope on public.org_subscription_plan_schedules;
create policy org_subscription_plan_schedules_select_by_org_scope
on public.org_subscription_plan_schedules
for select
using (public.user_has_org_access(org_id));

drop policy if exists org_subscription_plan_schedules_insert_by_org_admin on public.org_subscription_plan_schedules;
create policy org_subscription_plan_schedules_insert_by_org_admin
on public.org_subscription_plan_schedules
for insert
with check (public.actor_is_org_admin(org_id));

drop policy if exists org_subscription_plan_schedules_update_by_org_admin on public.org_subscription_plan_schedules;
create policy org_subscription_plan_schedules_update_by_org_admin
on public.org_subscription_plan_schedules
for update
using (public.actor_is_org_admin(org_id))
with check (public.actor_is_org_admin(org_id));

drop policy if exists org_subscription_plan_schedules_delete_by_org_admin on public.org_subscription_plan_schedules;
create policy org_subscription_plan_schedules_delete_by_org_admin
on public.org_subscription_plan_schedules
for delete
using (public.actor_is_org_admin(org_id));
