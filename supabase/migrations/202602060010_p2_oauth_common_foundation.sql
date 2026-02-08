-- TEPPEN MEO Phase2 ticket P2-01 (OAuth common foundation for IG/FB)
-- 最終更新: 2026-02-06
--
-- 目的:
-- - OAuth連携の開始/完了/解除を共通化する
-- - providerごとの個別実装（P2-02/P2-03）に先行して、接続状態遷移を標準化する
-- - integration_credentials の更新をRPC経由に統一する

create table if not exists public.oauth_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  provider text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  state_token text not null unique,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'COMPLETED', 'EXPIRED', 'FAILED', 'DISCONNECTED')),
  authorization_url text,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists oauth_sessions_store_id_idx on public.oauth_sessions(store_id);
create index if not exists oauth_sessions_provider_idx on public.oauth_sessions(provider);
create index if not exists oauth_sessions_actor_user_id_idx on public.oauth_sessions(actor_user_id);
create index if not exists oauth_sessions_expires_at_idx on public.oauth_sessions(expires_at);
drop trigger if exists oauth_sessions_set_updated_at on public.oauth_sessions;
create trigger oauth_sessions_set_updated_at
before update on public.oauth_sessions
for each row execute function public.set_updated_at();

create or replace function public.actor_can_manage_store_integration(target_store_id uuid)
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
      and public.user_has_store_access(target_store_id)
      and public.actor_highest_role_in_org(s.org_id) in ('ADMIN', 'MANAGER')
  );
$$;

create or replace function public.oauth_start_session(
  target_store_id uuid,
  target_provider text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  provider_upper text;
  state_token text;
  expires_at_ts timestamptz;
  authorization_url text;
  target_org_id uuid;
  target_provider_catalog_id uuid;
begin
  if actor_id is null then
    raise exception 'unauthenticated';
  end if;

  provider_upper := upper(trim(coalesce(target_provider, '')));
  if provider_upper = '' then
    raise exception 'PROVIDER_REQUIRED';
  end if;

  if not public.actor_can_manage_store_integration(target_store_id) then
    raise exception 'PERMISSION_DENIED';
  end if;

  select s.org_id
  into target_org_id
  from public.stores s
  where s.id = target_store_id;

  if target_org_id is null then
    raise exception 'STORE_NOT_FOUND';
  end if;

  select catalog.id
  into target_provider_catalog_id
  from public.provider_catalog catalog
  where catalog.org_id = target_org_id
    and upper(catalog.provider_key) = provider_upper
    and catalog.auth_kind = 'OAUTH2'
    and catalog.is_active = true;

  if target_provider_catalog_id is null then
    raise exception 'OAUTH_PROVIDER_NOT_CONFIGURED';
  end if;

  state_token := replace(gen_random_uuid()::text, '-', '');
  expires_at_ts := now() + interval '15 minutes';
  authorization_url := format(
    'https://oauth.mock.teppen.local/%s/authorize?state=%s&store_id=%s',
    lower(provider_upper),
    state_token,
    target_store_id::text
  );

  insert into public.oauth_sessions (
    store_id,
    provider,
    actor_user_id,
    state_token,
    status,
    authorization_url,
    expires_at
  )
  values (
    target_store_id,
    provider_upper,
    actor_id,
    state_token,
    'PENDING',
    authorization_url,
    expires_at_ts
  );

  insert into public.audit_logs (
    org_id,
    store_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    payload
  )
  values (
    target_org_id,
    target_store_id,
    actor_id,
    'oauth_start',
    'integration',
    provider_upper,
    jsonb_build_object('state_token', state_token, 'mode', 'MOCK')
  );

  return jsonb_build_object(
    'state_token', state_token,
    'authorization_url', authorization_url,
    'provider', provider_upper,
    'expires_at', expires_at_ts,
    'mode', 'MOCK'
  );
end;
$$;

create or replace function public.oauth_complete_session(
  target_state_token text,
  auth_code text,
  credential_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  session_row public.oauth_sessions%rowtype;
  provider_upper text;
  integration_id uuid;
  payload_text text;
  target_org_id uuid;
  target_provider_catalog_id uuid;
begin
  if actor_id is null then
    raise exception 'unauthenticated';
  end if;

  if nullif(trim(coalesce(target_state_token, '')), '') is null then
    raise exception 'STATE_REQUIRED';
  end if;

  if nullif(trim(coalesce(auth_code, '')), '') is null then
    raise exception 'AUTH_CODE_REQUIRED';
  end if;

  select *
  into session_row
  from public.oauth_sessions os
  where os.state_token = trim(target_state_token)
  for update;

  if not found then
    raise exception 'STATE_NOT_FOUND';
  end if;

  if session_row.status <> 'PENDING' then
    raise exception 'STATE_NOT_PENDING';
  end if;

  if session_row.expires_at < now() then
    update public.oauth_sessions
    set status = 'EXPIRED',
        completed_at = now(),
        last_error = 'STATE_EXPIRED'
    where id = session_row.id;
    raise exception 'STATE_EXPIRED';
  end if;

  if session_row.actor_user_id is not null and session_row.actor_user_id <> actor_id then
    raise exception 'STATE_OWNER_MISMATCH';
  end if;

  if not public.actor_can_manage_store_integration(session_row.store_id) then
    raise exception 'PERMISSION_DENIED';
  end if;

  provider_upper := upper(session_row.provider);

  select catalog.id
  into target_provider_catalog_id
  from public.provider_catalog catalog
  join public.stores s
    on s.org_id = catalog.org_id
  where s.id = session_row.store_id
    and upper(catalog.provider_key) = provider_upper
    and catalog.auth_kind = 'OAUTH2'
    and catalog.is_active = true;

  if target_provider_catalog_id is null then
    raise exception 'OAUTH_PROVIDER_NOT_CONFIGURED';
  end if;

  insert into public.integrations (
    store_id,
    provider,
    status,
    last_sync_at,
    last_error
  )
  values (
    session_row.store_id,
    provider_upper,
    'CONNECTED',
    now(),
    null
  )
  on conflict (store_id, provider) do update
    set status = excluded.status,
        last_sync_at = excluded.last_sync_at,
        last_error = excluded.last_error
  returning id into integration_id;

  payload_text := encode(
    convert_to(
      jsonb_build_object(
        'auth_code', auth_code,
        'credential_payload', coalesce(credential_payload, '{}'::jsonb),
        'updated_at', now()
      )::text,
      'UTF8'
    ),
    'base64'
  );

  insert into public.integration_credentials (integration_id, encrypted_payload)
  values (integration_id, payload_text)
  on conflict (integration_id) do update
    set encrypted_payload = excluded.encrypted_payload,
        updated_at = now();

  update public.provider_configurations pc
  set connection_status = 'CONNECTED',
      last_tested_at = now(),
      last_error = null
  where pc.store_id = session_row.store_id
    and pc.provider_catalog_id in (
      select catalog.id
      from public.provider_catalog catalog
      join public.stores s on s.org_id = catalog.org_id
      where s.id = session_row.store_id
        and upper(catalog.provider_key) = provider_upper
    );

  update public.oauth_sessions
  set status = 'COMPLETED',
      completed_at = now(),
      last_error = null,
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('integration_id', integration_id::text, 'completed_by', actor_id::text)
  where id = session_row.id;

  select s.org_id
  into target_org_id
  from public.stores s
  where s.id = session_row.store_id;

  insert into public.audit_logs (
    org_id,
    store_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    payload
  )
  values (
    target_org_id,
    session_row.store_id,
    actor_id,
    'oauth_complete',
    'integration',
    provider_upper,
    jsonb_build_object('integration_id', integration_id::text, 'mode', 'MOCK')
  );

  return jsonb_build_object(
    'ok', true,
    'provider', provider_upper,
    'store_id', session_row.store_id::text,
    'integration_id', integration_id::text,
    'status', 'CONNECTED'
  );
end;
$$;

create or replace function public.oauth_disconnect_session(
  target_store_id uuid,
  target_provider text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  provider_upper text;
  target_integration_id uuid;
  target_org_id uuid;
  target_provider_catalog_id uuid;
begin
  if actor_id is null then
    raise exception 'unauthenticated';
  end if;

  provider_upper := upper(trim(coalesce(target_provider, '')));
  if provider_upper = '' then
    raise exception 'PROVIDER_REQUIRED';
  end if;

  if not public.actor_can_manage_store_integration(target_store_id) then
    raise exception 'PERMISSION_DENIED';
  end if;

  select s.org_id
  into target_org_id
  from public.stores s
  where s.id = target_store_id;

  if target_org_id is null then
    raise exception 'STORE_NOT_FOUND';
  end if;

  select catalog.id
  into target_provider_catalog_id
  from public.provider_catalog catalog
  where catalog.org_id = target_org_id
    and upper(catalog.provider_key) = provider_upper
    and catalog.auth_kind = 'OAUTH2'
    and catalog.is_active = true;

  if target_provider_catalog_id is null then
    raise exception 'OAUTH_PROVIDER_NOT_CONFIGURED';
  end if;

  select i.id
  into target_integration_id
  from public.integrations i
  where i.store_id = target_store_id
    and i.provider = provider_upper;

  if target_integration_id is not null then
    delete from public.integration_credentials ic
    where ic.integration_id = target_integration_id;
  end if;

  insert into public.integrations (
    store_id,
    provider,
    status,
    last_sync_at,
    last_error
  )
  values (
    target_store_id,
    provider_upper,
    'DISCONNECTED',
    now(),
    null
  )
  on conflict (store_id, provider) do update
    set status = excluded.status,
        last_sync_at = excluded.last_sync_at,
        last_error = excluded.last_error
  returning id into target_integration_id;

  update public.provider_configurations pc
  set connection_status = 'DISCONNECTED',
      last_error = null
  where pc.store_id = target_store_id
    and pc.provider_catalog_id in (
      select catalog.id
      from public.provider_catalog catalog
      join public.stores s on s.org_id = catalog.org_id
      where s.id = target_store_id
        and upper(catalog.provider_key) = provider_upper
    );

  insert into public.oauth_sessions (
    store_id,
    provider,
    actor_user_id,
    state_token,
    status,
    authorization_url,
    expires_at,
    completed_at
  )
  values (
    target_store_id,
    provider_upper,
    actor_id,
    replace(gen_random_uuid()::text, '-', ''),
    'DISCONNECTED',
    null,
    now(),
    now()
  );

  insert into public.audit_logs (
    org_id,
    store_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    payload
  )
  values (
    target_org_id,
    target_store_id,
    actor_id,
    'oauth_disconnect',
    'integration',
    provider_upper,
    jsonb_build_object('integration_id', target_integration_id::text)
  );

  return jsonb_build_object(
    'ok', true,
    'provider', provider_upper,
    'store_id', target_store_id::text,
    'status', 'DISCONNECTED'
  );
end;
$$;

alter table public.oauth_sessions enable row level security;

drop policy if exists oauth_sessions_deny_all on public.oauth_sessions;
create policy oauth_sessions_deny_all
on public.oauth_sessions
for all
using (false)
with check (false);

revoke all on function public.actor_can_manage_store_integration(uuid) from public;
grant execute on function public.actor_can_manage_store_integration(uuid) to authenticated;

revoke all on function public.oauth_start_session(uuid, text) from public;
grant execute on function public.oauth_start_session(uuid, text) to authenticated;

revoke all on function public.oauth_complete_session(text, text, jsonb) from public;
grant execute on function public.oauth_complete_session(text, text, jsonb) to authenticated;

revoke all on function public.oauth_disconnect_session(uuid, text) from public;
grant execute on function public.oauth_disconnect_session(uuid, text) to authenticated;
