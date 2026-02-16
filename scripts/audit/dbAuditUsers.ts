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

const callFunction = async (params: {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  functionName: string;
}): Promise<{ status: number; body: string }> => {
  const response = await fetch(`${params.supabaseUrl}/functions/v1/${params.functionName}?client=audit-db-users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: params.anonKey,
      Authorization: `Bearer ${params.accessToken}`,
    },
    body: JSON.stringify({}),
  });
  return {
    status: response.status,
    body: await response.text(),
  };
};

const isFunctionReachableStatus = (status: number): boolean => {
  return status !== 401 && status !== 404;
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
  const accessToken = loginData.session.access_token;

  const checks: CheckResult[] = [];

  const profileColumns = await client
    .from('profiles')
    .select('id, invited_at, password_set_at')
    .limit(1);
  checks.push({
    name: 'profiles.invited_at/password_set_at',
    ok: !profileColumns.error,
    detail: profileColumns.error?.message || 'OK',
  });

  const membershipsCheck = await client
    .from('memberships')
    .select('id, user_id, org_id, role, store_id')
    .limit(1);
  checks.push({
    name: 'memberships read',
    ok: !membershipsCheck.error,
    detail: membershipsCheck.error?.message || 'OK',
  });

  for (const functionName of ['admin-user-update', 'admin-user-delete', 'admin-auth-link']) {
    const result = await callFunction({
      supabaseUrl,
      anonKey,
      accessToken,
      functionName,
    });
    checks.push({
      name: `function ${functionName}`,
      ok: isFunctionReachableStatus(result.status),
      detail: `status=${result.status} body=${result.body.slice(0, 200)}`,
    });
  }

  const failed = checks.filter((check) => !check.ok);
  console.log('\n[dbAuditUsers] result');
  for (const check of checks) {
    console.log(`- ${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`);
  }
  if (failed.length > 0) {
    process.exitCode = 1;
  }
};

void main().catch((error) => {
  console.error('[dbAuditUsers] failed:', error);
  process.exitCode = 1;
});
