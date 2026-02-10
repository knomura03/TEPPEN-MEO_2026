-- TEPPEN MEO Phase4 follow-up: real OAuth callback + encrypted credentials support
-- Updated: 2026-02-10
-- Purpose:
--   - Real OAuth callback flow becomes primary (oauth-start / oauth-callback Edge Functions)
--   - integration_credentials / oauth_sessions lookups are optimized for runtime checks
--   - Backward compatibility is preserved (existing RPC flow remains available)

begin;

create index if not exists idx_oauth_sessions_provider_store_status
  on public.oauth_sessions (provider, store_id, status);

create index if not exists idx_oauth_sessions_status_created_at
  on public.oauth_sessions (status, created_at desc);

create index if not exists idx_integration_credentials_updated_at
  on public.integration_credentials (updated_at desc);

comment on index public.idx_oauth_sessions_provider_store_status is
  'Used by oauth-start/callback and runtime readiness checks for provider/store scoped session lookup.';

comment on index public.idx_oauth_sessions_status_created_at is
  'Used to monitor pending/expired oauth session windows efficiently.';

comment on index public.idx_integration_credentials_updated_at is
  'Used by operational diagnostics to inspect recently rotated integration credentials.';

commit;
