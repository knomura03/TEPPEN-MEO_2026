-- TEPPEN MEO MVP RLS policies (skeleton)
-- 最終更新: 2026-02-03

-- 重要:
-- - ここでは「storeスコープで見える/見えない」を最優先にした最小ポリシーを定義します
-- - より細かい権限（canManageUsers など）は後続で段階的に追加します

-- ------------------------------------------------------------
-- Helper: storeアクセス判定
-- ------------------------------------------------------------

-- NOTE:
-- RLSポリシー内で「memberships を参照する memberships のポリシー」を書くと
-- Postgresが再帰（infinite recursion）として検出し、42P17 で全体が壊れます。
-- そのため、memberships を参照する判定は SECURITY DEFINER 関数に寄せて
-- ポリシー側は “同一テーブルを直接参照しない” 形にします。

create or replace function public.actor_highest_role_in_org(target_org_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when exists (
        select 1
        from public.memberships m
        where m.user_id = auth.uid()
          and m.org_id = target_org_id
          and m.role = 'ADMIN'
      ) then 'ADMIN'
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
      ) then 'USER'
      else null
    end;
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
      when 'MANAGER' then target_membership_role = 'USER'
      else false
    end;
$$;

create or replace function public.user_has_store_access(target_store_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.memberships m
    join public.stores s on s.id = target_store_id
    where m.user_id = auth.uid()
      and m.org_id = s.org_id
      and (
        m.role = 'ADMIN'
        or m.store_id is null
        or m.store_id = target_store_id
      )
  );
$$;

create or replace function public.user_has_org_access(target_org_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.org_id = target_org_id
  );
$$;

-- ------------------------------------------------------------
-- profiles
-- ------------------------------------------------------------

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles
for select
using (id = auth.uid());

drop policy if exists profiles_select_by_org_admin_manager on public.profiles;
create policy profiles_select_by_org_admin_manager
on public.profiles
for select
using (
  exists (
    select 1
    from public.memberships m_actor
    join public.memberships m_target
      on m_target.user_id = profiles.id
     and m_target.org_id = m_actor.org_id
    where m_actor.user_id = auth.uid()
      and (
        m_actor.role = 'ADMIN'
        or (m_actor.role = 'MANAGER' and m_target.role = 'USER')
      )
  )
);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
on public.profiles
for insert
with check (id = auth.uid());

-- ------------------------------------------------------------
-- memberships（まずは自分の所属だけ見える）
-- ------------------------------------------------------------

alter table public.memberships enable row level security;

drop policy if exists memberships_select_own on public.memberships;
create policy memberships_select_own
on public.memberships
for select
using (user_id = auth.uid());

drop policy if exists memberships_select_by_org_admin_manager on public.memberships;
create policy memberships_select_by_org_admin_manager
on public.memberships
for select
using (
  public.actor_can_manage_membership(org_id, role)
);

drop policy if exists memberships_delete_by_org_admin_manager on public.memberships;
create policy memberships_delete_by_org_admin_manager
on public.memberships
for delete
using (
  memberships.user_id <> auth.uid()
  and public.actor_can_manage_membership(org_id, role)
);
-- insert/update/delete はMVPではクライアントから許可しない想定
-- （管理機能 or サーバー側で実施。service_role はRLSをバイパス可能）

-- ------------------------------------------------------------
-- organizations
-- ------------------------------------------------------------

alter table public.organizations enable row level security;

drop policy if exists organizations_select_by_membership on public.organizations;
create policy organizations_select_by_membership
on public.organizations
for select
using (public.user_has_org_access(id));

-- ------------------------------------------------------------
-- stores
-- ------------------------------------------------------------

alter table public.stores enable row level security;

drop policy if exists stores_select_by_membership on public.stores;
create policy stores_select_by_membership
on public.stores
for select
using (
  exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.org_id = org_id
      and (
        m.role = 'ADMIN'
        or m.store_id is null
        or m.store_id = id
      )
  )
);

-- update はMVPでは一旦「所属者が更新可能」まで（後で権限フラグで絞る）
drop policy if exists stores_update_by_membership on public.stores;
create policy stores_update_by_membership
on public.stores
for update
using (
  exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.org_id = org_id
      and (
        m.role = 'ADMIN'
        or m.store_id is null
        or m.store_id = id
      )
  )
)
with check (
  exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.org_id = org_id
      and (
        m.role = 'ADMIN'
        or m.store_id is null
        or m.store_id = id
      )
  )
);

-- ------------------------------------------------------------
-- posts
-- ------------------------------------------------------------

alter table public.posts enable row level security;

drop policy if exists posts_select_by_store_access on public.posts;
create policy posts_select_by_store_access
on public.posts
for select
using (public.user_has_store_access(store_id));

drop policy if exists posts_insert_by_store_access on public.posts;
create policy posts_insert_by_store_access
on public.posts
for insert
with check (
  public.user_has_store_access(store_id)
  and author_user_id = auth.uid()
);

drop policy if exists posts_update_by_store_access on public.posts;
create policy posts_update_by_store_access
on public.posts
for update
using (public.user_has_store_access(store_id))
with check (public.user_has_store_access(store_id));

drop policy if exists posts_delete_by_store_access on public.posts;
create policy posts_delete_by_store_access
on public.posts
for delete
using (public.user_has_store_access(store_id));

-- ------------------------------------------------------------
-- post_approval_comments
-- ------------------------------------------------------------

alter table public.post_approval_comments enable row level security;

drop policy if exists post_approval_comments_select_by_store_access on public.post_approval_comments;
create policy post_approval_comments_select_by_store_access
on public.post_approval_comments
for select
using (
  exists (
    select 1
    from public.posts p
    where p.id = post_id
      and public.user_has_store_access(p.store_id)
  )
);

drop policy if exists post_approval_comments_insert_by_store_access on public.post_approval_comments;
create policy post_approval_comments_insert_by_store_access
on public.post_approval_comments
for insert
with check (
  exists (
    select 1
    from public.posts p
    where p.id = post_id
      and public.user_has_store_access(p.store_id)
  )
);

-- ------------------------------------------------------------
-- store_groups / store_group_stores
-- ------------------------------------------------------------

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

-- ------------------------------------------------------------
-- post_media
-- ------------------------------------------------------------

alter table public.post_media enable row level security;

drop policy if exists post_media_select_by_store_access on public.post_media;
create policy post_media_select_by_store_access
on public.post_media
for select
using (public.user_has_store_access(store_id));

drop policy if exists post_media_insert_by_store_access on public.post_media;
create policy post_media_insert_by_store_access
on public.post_media
for insert
with check (public.user_has_store_access(store_id));

drop policy if exists post_media_delete_by_store_access on public.post_media;
create policy post_media_delete_by_store_access
on public.post_media
for delete
using (public.user_has_store_access(store_id));

-- ------------------------------------------------------------
-- post_publish_logs
-- ------------------------------------------------------------

alter table public.post_publish_logs enable row level security;

drop policy if exists post_publish_logs_select_by_store_access on public.post_publish_logs;
create policy post_publish_logs_select_by_store_access
on public.post_publish_logs
for select
using (public.user_has_store_access(store_id));

drop policy if exists post_publish_logs_insert_by_store_access on public.post_publish_logs;
create policy post_publish_logs_insert_by_store_access
on public.post_publish_logs
for insert
with check (
  public.user_has_store_access(store_id)
  and (
    requested_by_user_id is null
    or requested_by_user_id = auth.uid()
  )
);

-- ------------------------------------------------------------
-- integrations / gbp_locations / inbox
-- selectは許可（状態表示のため）。書き込みは原則サーバー側で実施。
-- ------------------------------------------------------------

alter table public.integrations enable row level security;
drop policy if exists integrations_select_by_store_access on public.integrations;
create policy integrations_select_by_store_access
on public.integrations
for select
using (public.user_has_store_access(store_id));

drop policy if exists integrations_insert_by_store_access on public.integrations;
create policy integrations_insert_by_store_access
on public.integrations
for insert
with check (public.user_has_store_access(store_id));

drop policy if exists integrations_update_by_store_access on public.integrations;
create policy integrations_update_by_store_access
on public.integrations
for update
using (public.user_has_store_access(store_id))
with check (public.user_has_store_access(store_id));

alter table public.gbp_locations enable row level security;
drop policy if exists gbp_locations_select_by_store_access on public.gbp_locations;
create policy gbp_locations_select_by_store_access
on public.gbp_locations
for select
using (public.user_has_store_access(store_id));

alter table public.inbox_threads enable row level security;
drop policy if exists inbox_threads_select_by_store_access on public.inbox_threads;
create policy inbox_threads_select_by_store_access
on public.inbox_threads
for select
using (public.user_has_store_access(store_id));

alter table public.inbox_messages enable row level security;
drop policy if exists inbox_messages_select_by_store_access on public.inbox_messages;
create policy inbox_messages_select_by_store_access
on public.inbox_messages
for select
using (public.user_has_store_access(store_id));

drop policy if exists inbox_messages_update_by_store_access on public.inbox_messages;
create policy inbox_messages_update_by_store_access
on public.inbox_messages
for update
using (public.user_has_store_access(store_id))
with check (public.user_has_store_access(store_id));

alter table public.inbox_reply_logs enable row level security;

drop policy if exists inbox_reply_logs_select_by_store_access on public.inbox_reply_logs;
create policy inbox_reply_logs_select_by_store_access
on public.inbox_reply_logs
for select
using (public.user_has_store_access(store_id));

drop policy if exists inbox_reply_logs_insert_by_store_access on public.inbox_reply_logs;
create policy inbox_reply_logs_insert_by_store_access
on public.inbox_reply_logs
for insert
with check (
  public.user_has_store_access(store_id)
  and (
    requested_by_user_id is null
    or requested_by_user_id = auth.uid()
  )
);

-- ------------------------------------------------------------
-- audit_logs（MVPではクライアントからの閲覧はまだ許可しない）
-- ------------------------------------------------------------

alter table public.audit_logs enable row level security;

-- ここは後続で canViewAuditLogs 等に紐づけて許可する

-- ------------------------------------------------------------
-- integration_credentials（クライアントからは読めない）
-- ------------------------------------------------------------

alter table public.integration_credentials enable row level security;

drop policy if exists integration_credentials_deny_all on public.integration_credentials;
create policy integration_credentials_deny_all
on public.integration_credentials
for all
using (false)
with check (false);

-- ------------------------------------------------------------
-- Phase0 foundation helpers
-- ------------------------------------------------------------

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

-- ------------------------------------------------------------
-- provider_catalog
-- ------------------------------------------------------------

alter table public.provider_catalog enable row level security;

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

-- ------------------------------------------------------------
-- provider_capabilities
-- ------------------------------------------------------------

alter table public.provider_capabilities enable row level security;

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

-- ------------------------------------------------------------
-- provider_configurations
-- ------------------------------------------------------------

alter table public.provider_configurations enable row level security;

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

-- ------------------------------------------------------------
-- provider_secrets（クライアントからは常に拒否）
-- ------------------------------------------------------------

alter table public.provider_secrets enable row level security;

drop policy if exists provider_secrets_deny_all on public.provider_secrets;
create policy provider_secrets_deny_all
on public.provider_secrets
for all
using (false)
with check (false);

-- ------------------------------------------------------------
-- feature_flags
-- ------------------------------------------------------------

alter table public.feature_flags enable row level security;

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

-- ------------------------------------------------------------
-- audit_logs（ADMINは所属org/storeのログ閲覧可）
-- ------------------------------------------------------------

drop policy if exists audit_logs_select_by_admin_scope on public.audit_logs;
create policy audit_logs_select_by_admin_scope
on public.audit_logs
for select
using (
  (org_id is not null and public.actor_is_org_admin(org_id))
  or (org_id is null and store_id is not null and public.actor_is_store_admin(store_id))
);

-- ------------------------------------------------------------
-- Phase1: surveys
-- ------------------------------------------------------------

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

alter table public.surveys enable row level security;

drop policy if exists surveys_select_by_store_access on public.surveys;
create policy surveys_select_by_store_access
on public.surveys
for select
using (public.user_has_store_access(store_id));

drop policy if exists surveys_select_public_published on public.surveys;
create policy surveys_select_public_published
on public.surveys
for select
using (
  auth.uid() is null
  and status = 'PUBLISHED'
  and public_token is not null
);

drop policy if exists surveys_insert_by_store_access on public.surveys;
create policy surveys_insert_by_store_access
on public.surveys
for insert
with check (
  public.user_has_store_access(store_id)
  and author_user_id = auth.uid()
);

drop policy if exists surveys_update_by_store_access on public.surveys;
create policy surveys_update_by_store_access
on public.surveys
for update
using (public.user_has_store_access(store_id))
with check (public.user_has_store_access(store_id));

drop policy if exists surveys_delete_by_store_access on public.surveys;
create policy surveys_delete_by_store_access
on public.surveys
for delete
using (public.user_has_store_access(store_id));

alter table public.survey_responses enable row level security;

drop policy if exists survey_responses_select_by_store_access on public.survey_responses;
create policy survey_responses_select_by_store_access
on public.survey_responses
for select
using (
  exists (
    select 1
    from public.surveys s
    where s.id = survey_id
      and public.user_has_store_access(s.store_id)
  )
);

drop policy if exists survey_responses_insert_public on public.survey_responses;
create policy survey_responses_insert_public
on public.survey_responses
for insert
with check (public.is_published_survey(survey_id));

drop policy if exists survey_responses_insert_by_store_access on public.survey_responses;
create policy survey_responses_insert_by_store_access
on public.survey_responses
for insert
with check (
  exists (
    select 1
    from public.surveys s
    where s.id = survey_id
      and public.user_has_store_access(s.store_id)
  )
);

alter table public.survey_events enable row level security;

drop policy if exists survey_events_select_by_store_access on public.survey_events;
create policy survey_events_select_by_store_access
on public.survey_events
for select
using (
  exists (
    select 1
    from public.surveys s
    where s.id = survey_id
      and public.user_has_store_access(s.store_id)
  )
);

drop policy if exists survey_events_insert_public on public.survey_events;
create policy survey_events_insert_public
on public.survey_events
for insert
with check (
  public.is_published_survey(survey_id)
  and event_type in ('VIEW', 'REDIRECT_CLICK')
);

drop policy if exists survey_events_insert_by_store_access on public.survey_events;
create policy survey_events_insert_by_store_access
on public.survey_events
for insert
with check (
  exists (
    select 1
    from public.surveys s
    where s.id = survey_id
      and public.user_has_store_access(s.store_id)
  )
);

-- ------------------------------------------------------------
-- Phase2: template / brand kit
-- ------------------------------------------------------------

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

revoke all on function public.actor_can_manage_brand_assets(uuid) from public;
grant execute on function public.actor_can_manage_brand_assets(uuid) to authenticated;

alter table public.brand_kits enable row level security;

drop policy if exists brand_kits_select_by_org_members on public.brand_kits;
create policy brand_kits_select_by_org_members
on public.brand_kits
for select
using (
  exists (
    select 1
    from public.memberships m
    where m.org_id = brand_kits.org_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists brand_kits_insert_by_manager on public.brand_kits;
create policy brand_kits_insert_by_manager
on public.brand_kits
for insert
with check (public.actor_can_manage_brand_assets(org_id));

drop policy if exists brand_kits_update_by_manager on public.brand_kits;
create policy brand_kits_update_by_manager
on public.brand_kits
for update
using (public.actor_can_manage_brand_assets(org_id))
with check (public.actor_can_manage_brand_assets(org_id));

alter table public.post_templates enable row level security;

drop policy if exists post_templates_select_by_org_members on public.post_templates;
create policy post_templates_select_by_org_members
on public.post_templates
for select
using (
  exists (
    select 1
    from public.memberships m
    where m.org_id = post_templates.org_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists post_templates_insert_by_manager on public.post_templates;
create policy post_templates_insert_by_manager
on public.post_templates
for insert
with check (public.actor_can_manage_brand_assets(org_id));

drop policy if exists post_templates_update_by_manager on public.post_templates;
create policy post_templates_update_by_manager
on public.post_templates
for update
using (public.actor_can_manage_brand_assets(org_id))
with check (public.actor_can_manage_brand_assets(org_id));

drop policy if exists post_templates_delete_by_manager on public.post_templates;
create policy post_templates_delete_by_manager
on public.post_templates
for delete
using (public.actor_can_manage_brand_assets(org_id));

grant select, insert, update on public.brand_kits to authenticated;
grant select, insert, update, delete on public.post_templates to authenticated;

-- ------------------------------------------------------------
-- Phase3 foundation: rank keyword management
-- ------------------------------------------------------------

alter table public.rank_keywords enable row level security;

drop policy if exists rank_keywords_select_by_store_scope on public.rank_keywords;
create policy rank_keywords_select_by_store_scope
on public.rank_keywords
for select
using (public.user_has_store_access(store_id));

drop policy if exists rank_keywords_insert_by_store_scope on public.rank_keywords;
create policy rank_keywords_insert_by_store_scope
on public.rank_keywords
for insert
with check (public.user_has_store_access(store_id));

drop policy if exists rank_keywords_update_by_store_scope on public.rank_keywords;
create policy rank_keywords_update_by_store_scope
on public.rank_keywords
for update
using (public.user_has_store_access(store_id))
with check (public.user_has_store_access(store_id));

drop policy if exists rank_keywords_delete_by_store_scope on public.rank_keywords;
create policy rank_keywords_delete_by_store_scope
on public.rank_keywords
for delete
using (public.user_has_store_access(store_id));

grant select, insert, update, delete on public.rank_keywords to authenticated;

-- ------------------------------------------------------------
-- Phase3: rank daily collection
-- ------------------------------------------------------------

alter table public.rank_collection_runs enable row level security;

drop policy if exists rank_collection_runs_select_by_store_scope on public.rank_collection_runs;
create policy rank_collection_runs_select_by_store_scope
on public.rank_collection_runs
for select
using (public.user_has_store_access(store_id));

drop policy if exists rank_collection_runs_insert_by_store_scope on public.rank_collection_runs;
create policy rank_collection_runs_insert_by_store_scope
on public.rank_collection_runs
for insert
with check (
  public.user_has_store_access(store_id)
  and (requested_by_user_id is null or requested_by_user_id = auth.uid())
);

drop policy if exists rank_collection_runs_update_by_store_scope on public.rank_collection_runs;
create policy rank_collection_runs_update_by_store_scope
on public.rank_collection_runs
for update
using (
  public.user_has_store_access(store_id)
  and (requested_by_user_id is null or requested_by_user_id = auth.uid())
)
with check (
  public.user_has_store_access(store_id)
  and (requested_by_user_id is null or requested_by_user_id = auth.uid())
);

grant select, insert, update on public.rank_collection_runs to authenticated;

alter table public.rank_collection_results enable row level security;

drop policy if exists rank_collection_results_select_by_store_scope on public.rank_collection_results;
create policy rank_collection_results_select_by_store_scope
on public.rank_collection_results
for select
using (public.user_has_store_access(store_id));

drop policy if exists rank_collection_results_insert_by_store_scope on public.rank_collection_results;
create policy rank_collection_results_insert_by_store_scope
on public.rank_collection_results
for insert
with check (public.user_has_store_access(store_id));

grant select, insert on public.rank_collection_results to authenticated;

alter table public.competitor_targets enable row level security;

drop policy if exists competitor_targets_select_by_store_scope on public.competitor_targets;
create policy competitor_targets_select_by_store_scope
on public.competitor_targets
for select
using (public.user_has_store_access(store_id));

drop policy if exists competitor_targets_insert_by_store_scope on public.competitor_targets;
create policy competitor_targets_insert_by_store_scope
on public.competitor_targets
for insert
with check (public.user_has_store_access(store_id));

drop policy if exists competitor_targets_update_by_store_scope on public.competitor_targets;
create policy competitor_targets_update_by_store_scope
on public.competitor_targets
for update
using (public.user_has_store_access(store_id))
with check (public.user_has_store_access(store_id));

drop policy if exists competitor_targets_delete_by_store_scope on public.competitor_targets;
create policy competitor_targets_delete_by_store_scope
on public.competitor_targets
for delete
using (public.user_has_store_access(store_id));

grant select, insert, update, delete on public.competitor_targets to authenticated;

alter table public.competitor_metric_snapshots enable row level security;

drop policy if exists competitor_metric_snapshots_select_by_store_scope on public.competitor_metric_snapshots;
create policy competitor_metric_snapshots_select_by_store_scope
on public.competitor_metric_snapshots
for select
using (public.user_has_store_access(store_id));

drop policy if exists competitor_metric_snapshots_insert_by_store_scope on public.competitor_metric_snapshots;
create policy competitor_metric_snapshots_insert_by_store_scope
on public.competitor_metric_snapshots
for insert
with check (public.user_has_store_access(store_id));

grant select, insert on public.competitor_metric_snapshots to authenticated;

-- ------------------------------------------------------------
-- Storage: post-media bucket
-- ------------------------------------------------------------
-- 注: Supabaseの権限上、storage.objects へのALTER/CREATE POLICYは
-- SQL Editorではエラーになる場合があります（must be owner of table objects）。
-- その場合はGUIでポリシーを作成してください。
