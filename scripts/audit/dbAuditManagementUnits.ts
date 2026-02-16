import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadDotEnvFile, resolveRepoRoot } from './lib';

type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

const requireValue = (value: string | undefined, label: string): string => {
  if (!value || !value.trim()) {
    throw new Error(`${label} が未設定です。`);
  }
  return value.trim();
};

const main = async () => {
  const repoRoot = resolveRepoRoot();
  const localEnv = await loadDotEnvFile(path.join(repoRoot, '.env.local'));
  const auditEnv = await loadDotEnvFile(path.join(repoRoot, '.env.audit.local'));

  const supabaseUrl = requireValue(localEnv.VITE_SUPABASE_URL, 'VITE_SUPABASE_URL');
  const anonKey = requireValue(localEnv.VITE_SUPABASE_ANON_KEY, 'VITE_SUPABASE_ANON_KEY');
  const adminEmail = requireValue(auditEnv.AUDIT_ADMIN_EMAIL, 'AUDIT_ADMIN_EMAIL');
  const adminPassword = requireValue(auditEnv.AUDIT_ADMIN_PASSWORD, 'AUDIT_ADMIN_PASSWORD');

  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: loginData, error: loginError } = await client.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword,
  });
  if (loginError || !loginData.session?.access_token) {
    throw new Error(`管理者ログインに失敗しました: ${loginError?.message || 'unknown error'}`);
  }

  const checks: CheckResult[] = [];

  const managementUnits = await client
    .from('management_units')
    .select('id, name, created_at')
    .order('created_at', { ascending: true });
  checks.push({
    name: 'management_units read',
    ok: !managementUnits.error && Array.isArray(managementUnits.data),
    detail: managementUnits.error?.message || `count=${managementUnits.data?.length ?? 0}`,
  });

  const organizations = await client
    .from('organizations')
    .select('id, management_unit_id')
    .order('created_at', { ascending: true })
    .limit(2000);
  checks.push({
    name: 'organizations.management_unit_id read',
    ok: !organizations.error,
    detail: organizations.error?.message || `count=${organizations.data?.length ?? 0}`,
  });

  const nullManagementUnitRows = (organizations.data || []).filter((row) => {
    const typed = row as { management_unit_id?: string | null };
    return !typed.management_unit_id;
  });
  checks.push({
    name: 'organizations.management_unit_id not null',
    ok: nullManagementUnitRows.length === 0,
    detail: nullManagementUnitRows.length === 0 ? 'OK' : `null rows=${nullManagementUnitRows.length}`,
  });

  const supervisorAssignments = await client
    .from('management_unit_supervisors')
    .select('supervisor_user_id, management_unit_id');
  const duplicates = new Map<string, number>();
  (supervisorAssignments.data || []).forEach((row) => {
    const supervisorUserId = String((row as { supervisor_user_id?: string }).supervisor_user_id || '');
    if (!supervisorUserId) return;
    duplicates.set(supervisorUserId, (duplicates.get(supervisorUserId) || 0) + 1);
  });
  const duplicateSupervisorRows = Array.from(duplicates.entries()).filter(([, count]) => count > 1);
  checks.push({
    name: 'SUPERVISOR is assigned to one management unit',
    ok: !supervisorAssignments.error && duplicateSupervisorRows.length === 0,
    detail: supervisorAssignments.error?.message || (duplicateSupervisorRows.length === 0 ? 'OK' : `duplicates=${duplicateSupervisorRows.length}`),
  });

  const failed = checks.filter((check) => !check.ok);
  console.log('\n[dbAuditManagementUnits] result');
  for (const check of checks) {
    console.log(`- ${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
};

void main().catch((error) => {
  console.error('[dbAuditManagementUnits] failed:', error);
  process.exitCode = 1;
});
