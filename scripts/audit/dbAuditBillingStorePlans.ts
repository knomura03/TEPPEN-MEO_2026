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
  | { kind: 'count-match'; name: string; leftTable: string; rightTable: string };

type DbAuditCheckResult = {
  name: string;
  ok: boolean;
  kind: DbAuditCheck['kind'];
  details?: Record<string, unknown>;
  error?: {
    message: string;
    code?: string;
    details?: string;
    hint?: string;
  };
};

type DbAuditBillingStorePlansResult = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  checks: DbAuditCheckResult[];
};

const buildOutputDir = (repoRoot: string): string => {
  const base = process.env.AUDIT_OUTPUT_DIR;
  if (base) return base;
  const ts = formatTimestampForPath(new Date());
  return path.join(repoRoot, 'output', 'audit', '_adhoc', 'db', 'billing-store-plans', ts);
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

export const runDbAuditBillingStorePlans = async (params: {
  repoRoot: string;
  outputDir?: string;
}): Promise<DbAuditBillingStorePlansResult> => {
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
      name: 'store_subscriptions.columns',
      table: 'store_subscriptions',
      columns: 'id, store_id, billing_plan_id, status, created_at, updated_at',
    },
    {
      kind: 'select',
      name: 'store_subscription_plan_schedules.columns',
      table: 'store_subscription_plan_schedules',
      columns: 'id, store_id, billing_plan_id, status, effective_at, applied_at, canceled_at, note, created_by, updated_by, created_at, updated_at',
    },
    {
      kind: 'count-match',
      name: 'stores_vs_store_subscriptions.count_match',
      leftTable: 'stores',
      rightTable: 'store_subscriptions',
    },
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
          details: { table: check.table, columns: check.columns },
          error: toErrorInfo(error),
        });
        break;
      }
      results.push({
        name: check.name,
        ok: true,
        kind: check.kind,
        details: { table: check.table, columns: check.columns },
      });
      continue;
    }

    const [{ count: leftCount, error: leftError }, { count: rightCount, error: rightError }] = await Promise.all([
      supabase.from(check.leftTable).select('id', { count: 'exact', head: true }),
      supabase.from(check.rightTable).select('id', { count: 'exact', head: true }),
    ]);

    if (leftError || rightError) {
      results.push({
        name: check.name,
        ok: false,
        kind: check.kind,
        details: { leftTable: check.leftTable, rightTable: check.rightTable },
        error: toErrorInfo(leftError || rightError),
      });
      break;
    }

    const left = Number(leftCount || 0);
    const right = Number(rightCount || 0);
    const ok = left === right;
    results.push({
      name: check.name,
      ok,
      kind: check.kind,
      details: {
        leftTable: check.leftTable,
        leftCount: left,
        rightTable: check.rightTable,
        rightCount: right,
      },
      ...(ok
        ? {}
        : { error: { message: `count mismatch: ${check.leftTable}=${left}, ${check.rightTable}=${right}` } }),
    });
    if (!ok) break;
  }

  const out: DbAuditBillingStorePlansResult = {
    ok: results.every((item) => item.ok),
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    checks: results,
  };

  await writeJsonFile(path.join(outputDir, 'dbAudit.billing-store-plans.json'), out);
  return out;
};

const main = async (): Promise<void> => {
  const repoRoot = process.cwd();
  const outputDir = buildOutputDir(repoRoot);
  const result = await runDbAuditBillingStorePlans({ repoRoot, outputDir });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
