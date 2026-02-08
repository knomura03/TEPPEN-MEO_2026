import path from 'node:path';

import { createClient } from '@supabase/supabase-js';

import { ensureDir, loadDotEnvFile, writeJsonFile, writeTextFile } from './lib';

export type AuditBootstrapUsersResult = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  actorUserId?: string;
  orgId?: string;
  storeId?: string;
  managerUserId?: string;
  userUserId?: string;
  error?: string;
};

type InvokeErrorInfo = {
  name?: string;
  message: string;
  status?: number;
  statusText?: string;
  body?: string;
};

const requireValue = (map: Record<string, string>, key: string): string => {
  const value = map[key];
  if (!value) throw new Error(`Missing required env in .env.audit.local: ${key}`);
  return value;
};

const roleRank = (role: string): number => {
  switch (String(role || '').toUpperCase()) {
    case 'ADMIN':
      return 3;
    case 'MANAGER':
      return 2;
    case 'USER':
      return 1;
    default:
      return 0;
  }
};

const toInvokeErrorInfo = async (error: unknown): Promise<InvokeErrorInfo> => {
  const anyErr = error as { name?: unknown; message?: unknown; context?: unknown };
  const info: InvokeErrorInfo = {
    name: anyErr?.name ? String(anyErr.name) : undefined,
    message: anyErr?.message ? String(anyErr.message) : String(error),
  };
  const ctx = anyErr?.context as unknown;
  if (ctx && typeof ctx === 'object') {
    const maybeResponse = ctx as { status?: unknown; statusText?: unknown; text?: unknown };
    if (typeof maybeResponse.status === 'number') info.status = maybeResponse.status;
    if (typeof maybeResponse.statusText === 'string') info.statusText = maybeResponse.statusText;
    if (typeof maybeResponse.text === 'function') {
      try {
        info.body = await (maybeResponse as unknown as Response).text();
      } catch {
        // ignore
      }
    }
  }
  return info;
};

export const ensureAuditUsers = async (params: {
  repoRoot: string;
  outputDir: string;
}): Promise<AuditBootstrapUsersResult> => {
  const startedAt = new Date();
  await ensureDir(params.outputDir);

  const out: AuditBootstrapUsersResult = {
    ok: false,
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
  };

  try {
    const envLocal = await loadDotEnvFile(path.join(params.repoRoot, '.env.local'));
    const envAudit = await loadDotEnvFile(path.join(params.repoRoot, '.env.audit.local'));

    const supabaseUrl = requireValue(envLocal, 'VITE_SUPABASE_URL');
    const anonKey = requireValue(envLocal, 'VITE_SUPABASE_ANON_KEY');

    const adminEmail = requireValue(envAudit, 'AUDIT_ADMIN_EMAIL');
    const adminPassword = requireValue(envAudit, 'AUDIT_ADMIN_PASSWORD');

    const managerEmail = requireValue(envAudit, 'AUDIT_MANAGER_EMAIL');
    const managerPassword = requireValue(envAudit, 'AUDIT_MANAGER_PASSWORD');

    const userEmail = requireValue(envAudit, 'AUDIT_USER_EMAIL');
    const userPassword = requireValue(envAudit, 'AUDIT_USER_PASSWORD');

    const supabase = createClient(supabaseUrl, anonKey);

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: adminEmail,
      password: adminPassword,
    });
    if (authError) {
      throw new Error(`Admin sign-in failed: ${authError.message}`);
    }
    const accessToken = authData.session?.access_token;
    if (!accessToken) {
      throw new Error('Admin sign-in succeeded but access token is missing.');
    }
    const actorUserId = authData.user?.id;
    if (!actorUserId) {
      throw new Error('Admin sign-in succeeded but userId is missing.');
    }
    out.actorUserId = actorUserId;

    const { data: memberships, error: membershipsError } = await supabase
      .from('memberships')
      .select('org_id, role, created_at')
      .eq('user_id', actorUserId);
    if (membershipsError) {
      throw new Error(`Failed to load memberships: ${membershipsError.message}`);
    }
    if (!memberships || memberships.length === 0) {
      throw new Error('No memberships found for AUDIT admin user. Bootstrap org/store/membership first.');
    }

    const sorted = [...memberships].sort((a, b) => {
      const roleDiff = roleRank(String(b.role)) - roleRank(String(a.role));
      if (roleDiff !== 0) return roleDiff;
      const aTime = Date.parse(String(a.created_at || '')) || 0;
      const bTime = Date.parse(String(b.created_at || '')) || 0;
      return aTime - bTime;
    });
    const orgId = String(sorted[0].org_id);
    out.orgId = orgId;

    const { data: storeRow, error: storeError } = await supabase
      .from('stores')
      .select('id, org_id')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (storeError) {
      throw new Error(`Failed to load stores: ${storeError.message}`);
    }
    const storeId = storeRow?.id ? String(storeRow.id) : null;
    if (!storeId) {
      throw new Error('No stores found for the audit org. Create at least 1 store before running audit.');
    }
    out.storeId = storeId;

    // Ensure MANAGER exists and can sign in (deterministic password provisioning via Edge Function).
    const managerRes = await supabase.functions.invoke('admin-create-user', {
      headers: { Authorization: `Bearer ${accessToken}` },
      body: {
        email: managerEmail,
        name: '[AUDIT] Manager',
        role: 'MANAGER',
        orgId,
        password: managerPassword,
      },
    });
    if (managerRes.error) {
      const info = await toInvokeErrorInfo(managerRes.error);
      await writeJsonFile(path.join(params.outputDir, 'invoke.manager.error.json'), info);
      const status = info.status ? ` (status=${info.status})` : '';
      throw new Error(`Failed to provision manager: ${info.message}${status}`);
    }
    out.managerUserId = String((managerRes.data as { userId?: string } | null)?.userId || '');

    // Ensure USER exists and is scoped to the selected store.
    const userRes = await supabase.functions.invoke('admin-create-user', {
      headers: { Authorization: `Bearer ${accessToken}` },
      body: {
        email: userEmail,
        name: '[AUDIT] User',
        role: 'USER',
        orgId,
        storeId,
        password: userPassword,
      },
    });
    if (userRes.error) {
      const info = await toInvokeErrorInfo(userRes.error);
      await writeJsonFile(path.join(params.outputDir, 'invoke.user.error.json'), info);
      const status = info.status ? ` (status=${info.status})` : '';
      throw new Error(`Failed to provision user: ${info.message}${status}`);
    }
    out.userUserId = String((userRes.data as { userId?: string } | null)?.userId || '');

    // Basic sign-in sanity (avoid running E2E with broken credentials).
    const sanityClient = createClient(supabaseUrl, anonKey);
    const sanity = async (email: string, password: string, label: string) => {
      const { error } = await sanityClient.auth.signInWithPassword({ email, password });
      if (error) throw new Error(`${label} sign-in failed after provisioning: ${error.message}`);
      await sanityClient.auth.signOut();
    };
    await sanity(managerEmail, managerPassword, 'MANAGER');
    await sanity(userEmail, userPassword, 'USER');

    await supabase.auth.signOut();

    out.ok = true;
  } catch (error) {
    out.error = error instanceof Error ? error.message : String(error);
    await writeTextFile(path.join(params.outputDir, 'bootstrapUsers.error.log'), out.error);
  } finally {
    const finishedAt = new Date();
    out.finishedAt = finishedAt.toISOString();
    await writeJsonFile(path.join(params.outputDir, 'bootstrapUsers.result.json'), out);
  }

  return out;
};
