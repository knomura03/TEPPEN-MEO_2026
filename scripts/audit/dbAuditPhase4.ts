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

export type DbAuditPhase4Result = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  checks: DbAuditCheckResult[];
};

const buildOutputDir = (repoRoot: string): string => {
  const base = process.env.AUDIT_OUTPUT_DIR;
  if (base) return base;
  const ts = formatTimestampForPath(new Date());
  return path.join(repoRoot, 'output', 'audit', '_adhoc', 'db', 'phase4', ts);
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

export const runDbAuditPhase4 = async (params: {
  repoRoot: string;
  outputDir?: string;
}): Promise<DbAuditPhase4Result> => {
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
      name: 'billing_plans.columns',
      table: 'billing_plans',
      columns: 'id, code, name, amount_monthly, currency, is_active, created_at, updated_at',
    },
    {
      kind: 'select',
      name: 'org_subscriptions.columns',
      table: 'org_subscriptions',
      columns:
        'id, org_id, billing_plan_id, status, stripe_customer_id, stripe_subscription_id, current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at',
    },
    {
      kind: 'select',
      name: 'billing_invoices.columns',
      table: 'billing_invoices',
      columns:
        'id, org_subscription_id, status, amount_total, amount_paid, currency, invoice_url, period_start, period_end, issued_at, paid_at, created_at',
    },
    {
      kind: 'select',
      name: 'subscription_usage_events.columns',
      table: 'subscription_usage_events',
      columns: 'id, org_id, feature_key, quantity, unit, occurred_at, payload, created_at',
    },
    {
      kind: 'select',
      name: 'pwa_installations.columns',
      table: 'pwa_installations',
      columns: 'id, user_id, platform, app_version, installed_at, last_seen_at',
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
  const out: DbAuditPhase4Result = {
    ok,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    checks: results,
  };

  await writeJsonFile(path.join(outputDir, 'dbAudit.phase4.json'), out);
  return out;
};

const main = async (): Promise<void> => {
  const repoRoot = process.cwd();
  const outputDir = buildOutputDir(repoRoot);
  const result = await runDbAuditPhase4({ repoRoot, outputDir });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
