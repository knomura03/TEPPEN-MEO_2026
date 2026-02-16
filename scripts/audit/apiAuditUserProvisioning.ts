import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadDotEnvFile, resolveRepoRoot } from './lib';

type SessionInfo = {
  userId: string;
  accessToken: string;
};

type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

const EXISTING_EMAIL_ERROR = 'すでに存在しているユーザーのため招待できません。別のメールアドレスを指定してください。';

const requireValue = (value: string | undefined, label: string): string => {
  if (!value || !value.trim()) {
    throw new Error(`${label} が未設定です。`);
  }
  return value.trim();
};

const signIn = async (
  supabaseUrl: string,
  anonKey: string,
  email: string,
  password: string
): Promise<SessionInfo> => {
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token || !data.user?.id) {
    throw new Error(`ログイン失敗 (${email}): ${error?.message || 'unknown error'}`);
  }
  return {
    userId: data.user.id,
    accessToken: data.session.access_token,
  };
};

const invokeEdgeFunction = async (
  supabaseUrl: string,
  anonKey: string,
  accessToken: string,
  functionName: string,
  payload: Record<string, unknown>
): Promise<{ status: number; body: unknown; rawText: string }> => {
  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const rawText = await response.text();
  let body: unknown = null;
  if (rawText) {
    try {
      body = JSON.parse(rawText);
    } catch {
      body = rawText;
    }
  }

  return {
    status: response.status,
    body,
    rawText,
  };
};

const getErrorText = (body: unknown): string => {
  if (!body) return '';
  if (typeof body === 'string') return body;
  if (typeof body === 'object' && body !== null) {
    const value = (body as { error?: unknown; message?: unknown }).error ?? (body as { message?: unknown }).message;
    return typeof value === 'string' ? value : JSON.stringify(body);
  }
  return String(body);
};

const pickOrgAndStoreForSession = async (
  supabaseUrl: string,
  anonKey: string,
  accessToken: string
): Promise<{ orgId: string; storeId: string } | null> => {
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  const { data: storeRow, error: storeError } = await client
    .from('stores')
    .select('id, org_id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (storeError || !storeRow?.id || !storeRow.org_id) {
    return null;
  }

  return {
    orgId: String(storeRow.org_id),
    storeId: String(storeRow.id),
  };
};

const main = async () => {
  const repoRoot = resolveRepoRoot();
  const localEnv = await loadDotEnvFile(path.join(repoRoot, '.env.local'));
  const auditEnv = await loadDotEnvFile(path.join(repoRoot, '.env.audit.local'));

  const supabaseUrl = requireValue(localEnv.VITE_SUPABASE_URL, 'VITE_SUPABASE_URL');
  const anonKey = requireValue(localEnv.VITE_SUPABASE_ANON_KEY, 'VITE_SUPABASE_ANON_KEY');
  const adminEmail = requireValue(auditEnv.AUDIT_ADMIN_EMAIL, 'AUDIT_ADMIN_EMAIL');
  const adminPassword = requireValue(auditEnv.AUDIT_ADMIN_PASSWORD, 'AUDIT_ADMIN_PASSWORD');
  const supervisorEmail = requireValue(auditEnv.AUDIT_SUPERVISOR_EMAIL || auditEnv.AUDIT_MANAGER_EMAIL, 'AUDIT_SUPERVISOR_EMAIL または AUDIT_MANAGER_EMAIL');
  const supervisorPassword = requireValue(auditEnv.AUDIT_SUPERVISOR_PASSWORD || auditEnv.AUDIT_MANAGER_PASSWORD, 'AUDIT_SUPERVISOR_PASSWORD または AUDIT_MANAGER_PASSWORD');
  const managerEmail = requireValue(auditEnv.AUDIT_MANAGER_EMAIL, 'AUDIT_MANAGER_EMAIL');
  const managerPassword = requireValue(auditEnv.AUDIT_MANAGER_PASSWORD, 'AUDIT_MANAGER_PASSWORD');

  const checks: CheckResult[] = [];

  const adminSession = await signIn(supabaseUrl, anonKey, adminEmail, adminPassword);
  const supervisorSession = await signIn(supabaseUrl, anonKey, supervisorEmail, supervisorPassword);
  const managerSession = await signIn(supabaseUrl, anonKey, managerEmail, managerPassword);

  const adminTarget = await pickOrgAndStoreForSession(supabaseUrl, anonKey, adminSession.accessToken);
  const managerTarget = await pickOrgAndStoreForSession(supabaseUrl, anonKey, managerSession.accessToken);
  const baseTarget = adminTarget || managerTarget;
  if (!baseTarget) {
    throw new Error('検証対象のグループ/店舗が見つかりませんでした。監査アカウントの所属を確認してください。');
  }

  const existingInvite = await invokeEdgeFunction(
    supabaseUrl,
    anonKey,
    adminSession.accessToken,
    'admin-create-user',
    {
      email: managerEmail,
      name: '[AUDIT] Existing User',
      role: 'USER',
      orgId: baseTarget.orgId,
      storeId: baseTarget.storeId,
      redirectTo: 'http://localhost:3000/invite',
    }
  );
  checks.push({
    name: 'admin-create-user rejects existing email',
    ok:
      existingInvite.status === 400 &&
      getErrorText(existingInvite.body).includes(EXISTING_EMAIL_ERROR),
    detail: `status=${existingInvite.status} error=${getErrorText(existingInvite.body)}`,
  });

  const searchExisting = await invokeEdgeFunction(
    supabaseUrl,
    anonKey,
    adminSession.accessToken,
    'admin-user-attach-existing',
    {
      orgId: baseTarget.orgId,
      query: managerEmail.split('@')[0],
    }
  );
  const candidates =
    searchExisting.body && typeof searchExisting.body === 'object'
      ? ((searchExisting.body as { candidates?: Array<{ userId: string; email: string }> }).candidates || [])
      : [];
  checks.push({
    name: 'admin-user-attach-existing can search existing users',
    ok: searchExisting.status === 200 && candidates.length > 0,
    detail: `status=${searchExisting.status} candidates=${candidates.length}`,
  });

  const managerRoleAttach = await invokeEdgeFunction(
    supabaseUrl,
    anonKey,
    managerSession.accessToken,
    'admin-user-attach-existing',
    {
      orgId: managerTarget?.orgId || baseTarget.orgId,
      storeId: managerTarget?.storeId || baseTarget.storeId,
      targetUserId: managerSession.userId,
      role: 'MANAGER',
    }
  );
  checks.push({
    name: 'MANAGER cannot attach MANAGER role',
    ok: managerRoleAttach.status === 403,
    detail: `status=${managerRoleAttach.status} error=${getErrorText(managerRoleAttach.body)}`,
  });

  const adminClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${adminSession.accessToken}` },
    },
  });

  const { data: supervisorUnitRow } = await adminClient
    .from('management_unit_supervisors')
    .select('management_unit_id')
    .eq('supervisor_user_id', supervisorSession.userId)
    .maybeSingle();
  const supervisorUnitId = String(supervisorUnitRow?.management_unit_id || '');

  const { data: crossUnitOrg } = await adminClient
    .from('organizations')
    .select('id, management_unit_id')
    .not('management_unit_id', 'eq', supervisorUnitId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (supervisorUnitId && crossUnitOrg?.id) {
    const crossUnitProbe = await invokeEdgeFunction(
      supabaseUrl,
      anonKey,
      supervisorSession.accessToken,
      'admin-user-attach-existing',
      {
        orgId: String(crossUnitOrg.id),
        query: managerEmail.split('@')[0],
      }
    );
    checks.push({
      name: 'SUPERVISOR cannot access cross-management-unit org',
      ok: crossUnitProbe.status === 403,
      detail: `status=${crossUnitProbe.status} error=${getErrorText(crossUnitProbe.body)}`,
    });
  } else {
    checks.push({
      name: 'SUPERVISOR cannot access cross-management-unit org',
      ok: true,
      detail: 'SKIP: cross-unit検証用のデータがありませんでした。',
    });
  }

  const failed = checks.filter((check) => !check.ok);
  console.log('\n[apiAuditUserProvisioning] result');
  for (const check of checks) {
    console.log(`- ${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`);
  }
  if (failed.length > 0) {
    process.exitCode = 1;
  }
};

void main().catch((error) => {
  console.error('[apiAuditUserProvisioning] failed:', error);
  process.exitCode = 1;
});
