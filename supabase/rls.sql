-- TEPPEN MEO MVP RLS policies (skeleton)
-- 最終更新: 2026-02-03

-- 重要:
-- - ここでは「storeスコープで見える/見えない」を最優先にした最小ポリシーを定義します
-- - より細かい権限（canManageUsers など）は後続で段階的に追加します

-- ------------------------------------------------------------
-- Helper: storeアクセス判定
-- ------------------------------------------------------------

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
      and (m.store_id is null or m.store_id = target_store_id)
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

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
using (id = auth.uid())
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
      and (m.store_id is null or m.store_id = id)
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
      and (m.store_id is null or m.store_id = id)
  )
)
with check (
  exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.org_id = org_id
      and (m.store_id is null or m.store_id = id)
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
-- integrations / gbp_locations / inbox
-- selectは許可（状態表示のため）。書き込みは原則サーバー側で実施。
-- ------------------------------------------------------------

alter table public.integrations enable row level security;
drop policy if exists integrations_select_by_store_access on public.integrations;
create policy integrations_select_by_store_access
on public.integrations
for select
using (public.user_has_store_access(store_id));

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
-- Storage: post-media bucket
-- ------------------------------------------------------------

alter table storage.objects enable row level security;

drop policy if exists storage_post_media_select on storage.objects;
create policy storage_post_media_select
on storage.objects
for select
using (
  bucket_id = 'post-media'
  and auth.role() = 'authenticated'
  and public.user_has_store_access((split_part(name, '/', 1))::uuid)
);

drop policy if exists storage_post_media_insert on storage.objects;
create policy storage_post_media_insert
on storage.objects
for insert
with check (
  bucket_id = 'post-media'
  and auth.role() = 'authenticated'
  and public.user_has_store_access((split_part(name, '/', 1))::uuid)
);

drop policy if exists storage_post_media_delete on storage.objects;
create policy storage_post_media_delete
on storage.objects
for delete
using (
  bucket_id = 'post-media'
  and auth.role() = 'authenticated'
  and public.user_has_store_access((split_part(name, '/', 1))::uuid)
);
