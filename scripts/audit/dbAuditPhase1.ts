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
  | { kind: 'rpc'; name: string; fn: string; args: Record<string, unknown> };

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

export type DbAuditPhase1Result = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  checks: DbAuditCheckResult[];
};

const buildOutputDir = (repoRoot: string): string => {
  const base = process.env.AUDIT_OUTPUT_DIR;
  if (base) return base;
  const ts = formatTimestampForPath(new Date());
  return path.join(repoRoot, 'output', 'audit', '_adhoc', 'db', 'phase1', ts);
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

export const runDbAuditPhase1 = async (params: {
  repoRoot: string;
  outputDir?: string;
}): Promise<DbAuditPhase1Result> => {
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

  const checks: DbAuditCheck[] = [
    { kind: 'select', name: 'surveys.positive_threshold', table: 'surveys', columns: 'id, positive_threshold, status, public_token' },
    { kind: 'select', name: 'survey_responses.branch_type', table: 'survey_responses', columns: 'id, survey_id, rating, branch_type, source, created_at' },
    { kind: 'select', name: 'survey_events', table: 'survey_events', columns: 'id, survey_id, event_type, created_at' },
    { kind: 'select', name: 'posts.approval_columns', table: 'posts', columns: 'id, store_id, approval_status, submitted_for_approval_at, approved_at, approved_by_user_id, rejected_at, rejected_by_user_id, rejection_reason' },
    { kind: 'select', name: 'post_approval_comments', table: 'post_approval_comments', columns: 'id, post_id, actor_user_id, action_type, comment, created_at' },
    { kind: 'select', name: 'inbox_messages.reply_draft', table: 'inbox_messages', columns: 'id, store_id, provider, reply_draft_content, reply_draft_status, reply_draft_generated_at, reply_draft_approved_at' },
    { kind: 'select', name: 'store_groups', table: 'store_groups', columns: 'id, org_id, name, created_at' },
    { kind: 'select', name: 'store_group_stores', table: 'store_group_stores', columns: 'id, store_group_id, store_id, created_at' },
    { kind: 'select', name: 'org_store_policies', table: 'org_store_policies', columns: 'org_id, default_user_store_limit, allow_user_store_creation, updated_at' },
    { kind: 'select', name: 'user_store_controls', table: 'user_store_controls', columns: 'org_id, user_id, max_stores, allow_csv_store_bulk_create, updated_at' },
  ];

  const results: DbAuditCheckResult[] = [];
  for (const check of checks) {
    if (check.kind === 'select') {
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
      continue;
    }

    const { error } = await supabase.rpc(check.fn, check.args);
    if (error) {
      results.push({
        name: check.name,
        ok: false,
        kind: check.kind,
        fn: check.fn,
        error: toErrorInfo(error),
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

  if (actorUserId) {
    const { data: storeRow, error: storeError } = await supabase
      .from('stores')
      .select('id, org_id')
      .limit(1)
      .maybeSingle();

    if (!storeError && storeRow?.org_id) {
      const orgId = storeRow.org_id as string;
      const rpcChecks: DbAuditRpcCheck[] = [
        {
          kind: 'rpc',
          name: 'rpc.effective_user_store_limit',
          fn: 'effective_user_store_limit',
          args: { target_org_id: orgId, target_user_id: actorUserId },
        },
        {
          kind: 'rpc',
          name: 'rpc.user_store_count',
          fn: 'user_store_count',
          args: { target_org_id: orgId, target_user_id: actorUserId },
        },
        {
          kind: 'rpc',
          name: 'rpc.can_user_create_store',
          fn: 'can_user_create_store',
          args: { target_org_id: orgId, target_user_id: actorUserId },
        },
      ];
      for (const check of rpcChecks) {
        const { error } = await supabase.rpc(check.fn, check.args);
        if (error) {
          results.push({
            name: check.name,
            ok: false,
            kind: check.kind,
            fn: check.fn,
            error: toErrorInfo(error),
          });
          break;
        }
        results.push({ name: check.name, ok: true, kind: check.kind, fn: check.fn });
      }
    } else if (storeError) {
      results.push({
        name: 'stores.select_for_rpc_probe',
        ok: false,
        kind: 'select',
        table: 'stores',
        columns: 'id, org_id',
        error: toErrorInfo(storeError),
      });
    }
  }

  const ok = results.every((r) => r.ok);
  const finishedAt = new Date();
  const out: DbAuditPhase1Result = {
    ok,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    checks: results,
  };

  await writeJsonFile(path.join(outputDir, 'dbAudit.phase1.json'), out);
  return out;
};

const main = async (): Promise<void> => {
  const repoRoot = process.cwd();
  const outputDir = buildOutputDir(repoRoot);
  const result = await runDbAuditPhase1({ repoRoot, outputDir });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
