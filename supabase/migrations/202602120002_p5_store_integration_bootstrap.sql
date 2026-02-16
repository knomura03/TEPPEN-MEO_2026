-- P5: store作成時の連携設定自動初期化
-- 目的:
-- - stores 作成時に provider_configurations / integrations を自動作成
-- - 既存storeの欠落レコードを一括補完

create or replace function public.bootstrap_store_provider_integrations(
  target_store_id uuid,
  actor_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_org_id uuid;
begin
  select s.org_id
  into target_org_id
  from public.stores s
  where s.id = target_store_id;

  if target_org_id is null then
    return;
  end if;

  insert into public.provider_configurations (
    store_id,
    provider_catalog_id,
    config,
    has_gui_config,
    connection_status,
    created_by,
    updated_by
  )
  select
    target_store_id,
    pc.id,
    '{}'::jsonb,
    false,
    'DISCONNECTED',
    actor_user_id,
    actor_user_id
  from public.provider_catalog pc
  where pc.org_id = target_org_id
    and pc.is_active = true
  on conflict (store_id, provider_catalog_id) do nothing;

  insert into public.integrations (
    store_id,
    provider,
    status,
    last_sync_at,
    last_error
  )
  select
    target_store_id,
    upper(pc.provider_key),
    'DISCONNECTED',
    now(),
    null
  from public.provider_catalog pc
  where pc.org_id = target_org_id
    and pc.is_active = true
  on conflict (store_id, provider) do nothing;
end;
$$;

create or replace function public.bootstrap_store_provider_integrations_on_store_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.bootstrap_store_provider_integrations(new.id, auth.uid());
  return new;
end;
$$;

drop trigger if exists stores_bootstrap_provider_integrations on public.stores;
create trigger stores_bootstrap_provider_integrations
after insert on public.stores
for each row execute function public.bootstrap_store_provider_integrations_on_store_insert();

do $$
declare
  store_row record;
begin
  for store_row in
    select s.id
    from public.stores s
  loop
    perform public.bootstrap_store_provider_integrations(store_row.id, null);
  end loop;
end;
$$;
