-- TEPPEN MEO Phase2 ticket P2-05 (template / brand kit)
-- 最終更新: 2026-02-08
--
-- 目的:
-- - 投稿運用で使うテンプレートとブランドルール（NGワード/推奨ハッシュタグ）を組織単位で管理する
-- - 投稿作成時にテンプレ適用と簡易コンテンツチェックを行えるようにする

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

alter table public.brand_kits enable row level security;
alter table public.post_templates enable row level security;

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

revoke all on function public.actor_can_manage_brand_assets(uuid) from public;
grant execute on function public.actor_can_manage_brand_assets(uuid) to authenticated;

grant select, insert, update on public.brand_kits to authenticated;
grant select, insert, update, delete on public.post_templates to authenticated;
