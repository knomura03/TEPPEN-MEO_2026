-- Management unit branding (service name / logo)
-- 最終更新: 2026-02-15

create table if not exists public.management_unit_branding (
  management_unit_id uuid primary key references public.management_units(id) on delete cascade,
  service_name text not null default 'TEPPEN MEO',
  logo_path text null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at_management_unit_branding on public.management_unit_branding;
create trigger set_updated_at_management_unit_branding
before update on public.management_unit_branding
for each row execute function public.set_updated_at();

alter table public.management_unit_branding enable row level security;

drop policy if exists management_unit_branding_select on public.management_unit_branding;
create policy management_unit_branding_select
on public.management_unit_branding
for select
to authenticated
using (
  public.actor_is_platform_admin()
  or exists (
    select 1
    from public.organizations o
    where o.management_unit_id = management_unit_branding.management_unit_id
      and public.actor_can_access_org(o.id)
  )
);

drop policy if exists management_unit_branding_insert_admin on public.management_unit_branding;
create policy management_unit_branding_insert_admin
on public.management_unit_branding
for insert
to authenticated
with check (public.actor_is_platform_admin());

drop policy if exists management_unit_branding_update_admin on public.management_unit_branding;
create policy management_unit_branding_update_admin
on public.management_unit_branding
for update
to authenticated
using (public.actor_is_platform_admin())
with check (public.actor_is_platform_admin());

drop policy if exists management_unit_branding_delete_admin on public.management_unit_branding;
create policy management_unit_branding_delete_admin
on public.management_unit_branding
for delete
to authenticated
using (public.actor_is_platform_admin());

insert into public.management_unit_branding (management_unit_id, service_name)
select mu.id, 'TEPPEN MEO'
from public.management_units mu
on conflict (management_unit_id) do nothing;

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'branding') then
    insert into storage.buckets (id, name, public)
    values ('branding', 'branding', true);
  end if;
end $$;

do $$
begin
  begin
    drop policy if exists branding_insert_admin on storage.objects;
    create policy branding_insert_admin
    on storage.objects
    for insert
    with check (
      bucket_id = 'branding'
      and auth.role() = 'authenticated'
      and public.actor_is_platform_admin()
    );
  exception
    when insufficient_privilege then
      raise notice 'storage.objects branding insert policy skipped: insufficient_privilege';
  end;

  begin
    drop policy if exists branding_update_admin on storage.objects;
    create policy branding_update_admin
    on storage.objects
    for update
    using (
      bucket_id = 'branding'
      and auth.role() = 'authenticated'
      and public.actor_is_platform_admin()
    )
    with check (
      bucket_id = 'branding'
      and auth.role() = 'authenticated'
      and public.actor_is_platform_admin()
    );
  exception
    when insufficient_privilege then
      raise notice 'storage.objects branding update policy skipped: insufficient_privilege';
  end;

  begin
    drop policy if exists branding_delete_admin on storage.objects;
    create policy branding_delete_admin
    on storage.objects
    for delete
    using (
      bucket_id = 'branding'
      and auth.role() = 'authenticated'
      and public.actor_is_platform_admin()
    );
  exception
    when insufficient_privilege then
      raise notice 'storage.objects branding delete policy skipped: insufficient_privilege';
  end;
end $$;

