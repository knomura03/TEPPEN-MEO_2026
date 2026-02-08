import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  ensureDir,
  formatTimestampForPath,
  loadDotEnvFile,
  writeJsonFile,
  writeTextFile,
} from './lib';

type DbAuditCheck =
  | { kind: 'select'; name: string; table: string; columns: string }
  | {
      kind: 'rpc';
      name: string;
      fn: string;
      args: Record<string, unknown>;
      acceptableErrors?: string[];
    };

type DbAuditRpcCheck = Extract<DbAuditCheck, { kind: 'rpc' }>;

export type DbAuditCheckResult = {
  name: string;
  ok: boolean;
  kind: DbAuditCheck['kind'];
  table?: string;
  columns?: string;
  fn?: string;
  error?: {
    message: string;
    code?: string;
    details?: string;
    hint?: string;
  };
};

export type DbAuditPhase2Result = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  checks: DbAuditCheckResult[];
};

const buildOutputDir = (repoRoot: string): string => {
  const base = process.env.AUDIT_OUTPUT_DIR;
  if (base) return base;
  const ts = formatTimestampForPath(new Date());
  return path.join(repoRoot, 'output', 'audit', '_adhoc', 'db', 'phase2', ts);
};

const requireValue = (map: Record<string, string>, key: string): string => {
  const value = map[key];
  if (!value) {
    throw new Error(`Missing required env: ${key}`);
  }
  return value;
};

const toErrorInfo = (error: unknown): DbAuditCheckResult['error'] => {
  if (!error || typeof error !== 'object') return { message: String(error) };
  const anyErr = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
  return {
    message: String(anyErr.message || error),
    code: anyErr.code ? String(anyErr.code) : undefined,
    details: anyErr.details ? String(anyErr.details) : undefined,
    hint: anyErr.hint ? String(anyErr.hint) : undefined,
  };
};

const isFunctionNotFoundError = (errorInfo?: DbAuditCheckResult['error']): boolean => {
  if (!errorInfo) return false;
  const code = errorInfo.code || '';
  const message = errorInfo.message || '';
  return code === 'PGRST202' || /Could not find the function/i.test(message);
};

const isAcceptableRpcError = (errorInfo: DbAuditCheckResult['error'], expectedMessages: string[]): boolean => {
  if (!errorInfo) return false;
  const msg = (errorInfo.message || '').toUpperCase();
  return expectedMessages.some((item) => msg.includes(item.toUpperCase()));
};

export const runDbAuditPhase2 = async (params: {
  repoRoot: string;
  outputDir?: string;
}): Promise<DbAuditPhase2Result> => {
  const outputDir = params.outputDir || buildOutputDir(params.repoRoot);
  await ensureDir(outputDir);

  const envLocalPath = path.join(params.repoRoot, '.env.local');
  const envAuditPath = path.join(params.repoRoot, '.env.audit.local');
  const envLocal = await loadDotEnvFile(envLocalPath);
  const envAudit = await loadDotEnvFile(envAuditPath);

  const supabaseUrl = requireValue(envLocal, 'VITE_SUPABASE_URL');
  const anonKey = requireValue(envLocal, 'VITE_SUPABASE_ANON_KEY');
  const adminEmail = requireValue(envAudit, 'AUDIT_ADMIN_EMAIL');
  const adminPassword = requireValue(envAudit, 'AUDIT_ADMIN_PASSWORD');

  const supabase = createClient(supabaseUrl, anonKey);
  const startedAt = new Date();

  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword,
  });
  if (authError) {
    await writeTextFile(path.join(outputDir, 'auth.error.log'), JSON.stringify(authError, null, 2));
    throw new Error(`Admin sign-in failed: ${authError.message}`);
  }
  const actorUserId = authData.user?.id;

  const checks: Array<Extract<DbAuditCheck, { kind: 'select' }>> = [
    {
      kind: 'select',
      name: 'oauth_sessions.columns',
      table: 'oauth_sessions',
      columns:
        'id, store_id, provider, actor_user_id, state_token, status, authorization_url, expires_at, started_at, completed_at, last_error, metadata',
    },
    {
      kind: 'select',
      name: 'provider_catalog.oauth_columns',
      table: 'provider_catalog',
      columns: 'id, provider_key, auth_kind, is_active, provider_capabilities(can_connect,can_publish,can_reply)',
    },
    {
      kind: 'select',
      name: 'provider_configurations.connection_columns',
      table: 'provider_configurations',
      columns: 'id, store_id, provider_catalog_id, has_gui_config, connection_status, last_tested_at, last_error',
    },
    {
      kind: 'select',
      name: 'integrations.columns',
      table: 'integrations',
      columns: 'id, store_id, provider, status, last_sync_at, last_error',
    },
    {
      kind: 'select',
      name: 'integration_credentials.columns',
      table: 'integration_credentials',
      columns: 'integration_id, encrypted_payload, updated_at',
    },
    {
      kind: 'select',
      name: 'post_publish_logs.columns',
      table: 'post_publish_logs',
      columns: 'id, post_id, store_id, provider, mode, status, message, external_post_id, requested_by_user_id, created_at',
    },
    {
      kind: 'select',
      name: 'inbox_reply_logs.columns',
      table: 'inbox_reply_logs',
      columns: 'id, message_id, store_id, provider, mode, status, message, external_reply_id, requested_by_user_id, created_at',
    },
    {
      kind: 'select',
      name: 'inbox_messages.workflow_columns',
      table: 'inbox_messages',
      columns: 'id, store_id, tags, assigned_user_id, due_at, sla_status, is_replied, reply_content',
    },
    {
      kind: 'select',
      name: 'brand_kits.columns',
      table: 'brand_kits',
      columns: 'id, org_id, tone_guide, banned_words, recommended_hashtags, default_signature, updated_by, updated_at',
    },
    {
      kind: 'select',
      name: 'post_templates.columns',
      table: 'post_templates',
      columns: 'id, org_id, title, body, default_platforms, is_active, created_by, updated_by, updated_at',
    },
  ];

  const results: DbAuditCheckResult[] = [];

  for (const check of checks) {
    const { error } = await supabase.from(check.table).select(check.columns).limit(1);
    if (error) {
      results.push({
        name: check.name,
        ok: false,
        kind: check.kind,
        table: check.table,
        columns: check.columns,
        error: toErrorInfo(error),
      });
      break;
    }
    results.push({
      name: check.name,
      ok: true,
      kind: check.kind,
      table: check.table,
      columns: check.columns,
    });
  }

  if (results.every((r) => r.ok) && actorUserId) {
    const { data: storeRow, error: storeError } = await supabase
      .from('stores')
      .select('id, org_id')
      .limit(1)
      .maybeSingle();

    if (storeError) {
      results.push({
        name: 'stores.select_for_rpc_probe',
        ok: false,
        kind: 'select',
        table: 'stores',
        columns: 'id, org_id',
        error: toErrorInfo(storeError),
      });
    } else {
      const targetStoreId = String(storeRow?.id || '');
      const targetOrgId = String(storeRow?.org_id || '');
      const rpcChecks: DbAuditRpcCheck[] = [
        {
          kind: 'rpc',
          name: 'rpc.actor_can_manage_store_integration',
          fn: 'actor_can_manage_store_integration',
          args: { target_store_id: targetStoreId },
        },
        {
          kind: 'rpc',
          name: 'rpc.actor_can_manage_brand_assets',
          fn: 'actor_can_manage_brand_assets',
          args: { target_org_id: targetOrgId },
        },
        {
          kind: 'rpc',
          name: 'rpc.oauth_start_session',
          fn: 'oauth_start_session',
          args: { target_store_id: targetStoreId, target_provider: 'INSTAGRAM' },
          acceptableErrors: ['OAUTH_PROVIDER_NOT_CONFIGURED', 'PERMISSION_DENIED', 'STORE_NOT_FOUND'],
        },
        {
          kind: 'rpc',
          name: 'rpc.oauth_complete_session',
          fn: 'oauth_complete_session',
          args: { target_state_token: 'AUDIT_FAKE_STATE', auth_code: 'AUDIT_FAKE_CODE' },
          acceptableErrors: ['STATE_NOT_FOUND', 'STATE_REQUIRED', 'AUTH_CODE_REQUIRED'],
        },
        {
          kind: 'rpc',
          name: 'rpc.oauth_disconnect_session',
          fn: 'oauth_disconnect_session',
          args: { target_store_id: targetStoreId, target_provider: 'INSTAGRAM' },
          acceptableErrors: ['OAUTH_PROVIDER_NOT_CONFIGURED', 'PERMISSION_DENIED', 'STORE_NOT_FOUND'],
        },
      ];

      for (const check of rpcChecks) {
        const { error } = await supabase.rpc(check.fn, check.args);
        if (error) {
          const errorInfo = toErrorInfo(error);
          if (isFunctionNotFoundError(errorInfo)) {
            results.push({
              name: check.name,
              ok: false,
              kind: check.kind,
              fn: check.fn,
              error: errorInfo,
            });
            break;
          }

          if (check.acceptableErrors && isAcceptableRpcError(errorInfo, check.acceptableErrors)) {
            results.push({
              name: check.name,
              ok: true,
              kind: check.kind,
              fn: check.fn,
            });
            continue;
          }

          results.push({
            name: check.name,
            ok: false,
            kind: check.kind,
            fn: check.fn,
            error: errorInfo,
          });
          break;
        }
        results.push({
          name: check.name,
          ok: true,
          kind: check.kind,
          fn: check.fn,
        });
      }
    }
  }

  const ok = results.every((r) => r.ok);
  const finishedAt = new Date();
  const out: DbAuditPhase2Result = {
    ok,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    checks: results,
  };

  await writeJsonFile(path.join(outputDir, 'dbAudit.phase2.json'), out);
  return out;
};

const main = async (): Promise<void> => {
  const repoRoot = process.cwd();
  const outputDir = buildOutputDir(repoRoot);
  const result = await runDbAuditPhase2({ repoRoot, outputDir });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
