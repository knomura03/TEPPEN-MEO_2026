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

type DbAuditCheck = { kind: 'select'; name: string; table: string; columns: string };

export type DbAuditCheckResult = {
  name: string;
  ok: boolean;
  kind: DbAuditCheck['kind'];
  table?: string;
  columns?: string;
  error?: {
    message: string;
    code?: string;
    details?: string;
    hint?: string;
  };
};

export type DbAuditPhase3Result = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  checks: DbAuditCheckResult[];
};

const buildOutputDir = (repoRoot: string): string => {
  const base = process.env.AUDIT_OUTPUT_DIR;
  if (base) return base;
  const ts = formatTimestampForPath(new Date());
  return path.join(repoRoot, 'output', 'audit', '_adhoc', 'db', 'phase3', ts);
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

export const runDbAuditPhase3 = async (params: {
  repoRoot: string;
  outputDir?: string;
}): Promise<DbAuditPhase3Result> => {
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

  const { error: authError } = await supabase.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword,
  });
  if (authError) {
    await writeTextFile(path.join(outputDir, 'auth.error.log'), JSON.stringify(authError, null, 2));
    throw new Error(`Admin sign-in failed: ${authError.message}`);
  }

  const checks: DbAuditCheck[] = [
    {
      kind: 'select',
      name: 'rank_keywords.columns',
      table: 'rank_keywords',
      columns: 'id, store_id, keyword, note, is_active, created_by, updated_by, created_at, updated_at',
    },
    {
      kind: 'select',
      name: 'rank_collection_runs.columns',
      table: 'rank_collection_runs',
      columns:
        'id, store_id, trigger_type, mode, status, message, requested_by_user_id, started_at, finished_at, created_at',
    },
    {
      kind: 'select',
      name: 'rank_collection_results.columns',
      table: 'rank_collection_results',
      columns: 'id, run_id, store_id, rank_keyword_id, keyword, position, mode, status, message, raw, created_at',
    },
    {
      kind: 'select',
      name: 'competitor_targets.columns',
      table: 'competitor_targets',
      columns: 'id, store_id, name, note, is_active, created_by, updated_by, created_at, updated_at',
    },
    {
      kind: 'select',
      name: 'competitor_metric_snapshots.columns',
      table: 'competitor_metric_snapshots',
      columns:
        'id, run_id, store_id, competitor_target_id, competitor_name, map_rank, review_count, rating, mode, status, message, raw, collected_at, created_at',
    },
    {
      kind: 'select',
      name: 'nap_consistency_runs.columns',
      table: 'nap_consistency_runs',
      columns:
        'id, store_id, trigger_type, status, message, summary, requested_by_user_id, started_at, finished_at, created_at',
    },
    {
      kind: 'select',
      name: 'nap_consistency_results.columns',
      table: 'nap_consistency_results',
      columns:
        'id, run_id, store_id, provider_catalog_id, provider_key, provider_name, expected_name, expected_address, expected_phone, observed_name, observed_address, observed_phone, name_match, address_match, phone_match, status, mismatch_fields, message, details, created_at',
    },
    {
      kind: 'select',
      name: 'nap_alerts.columns',
      table: 'nap_alerts',
      columns:
        'id, store_id, provider_catalog_id, provider_key, provider_name, status, last_result_status, mismatch_fields, last_run_id, last_result_id, first_detected_at, opened_at, last_detected_at, last_checked_at, acknowledged_at, acknowledged_by_user_id, resolved_at, resolved_by_user_id, note, updated_by, created_at, updated_at',
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

  const ok = results.every((r) => r.ok);
  const finishedAt = new Date();
  const out: DbAuditPhase3Result = {
    ok,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    checks: results,
  };

  await writeJsonFile(path.join(outputDir, 'dbAudit.phase3.json'), out);
  return out;
};

const main = async (): Promise<void> => {
  const repoRoot = process.cwd();
  const outputDir = buildOutputDir(repoRoot);
  const result = await runDbAuditPhase3({ repoRoot, outputDir });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
