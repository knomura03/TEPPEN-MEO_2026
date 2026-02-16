import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  supervisorUserId?: string;
  error?: string;
};

type InvokeErrorInfo = {
  name?: string;
  message: string;
  status?: number;
  statusText?: string;
  body?: string;
};

const ensureAuditFeatureFlags = async (params: {
  supabase: any;
  orgId: string;
  storeId: string;
  actorUserId: string;
}): Promise<void> => {
  const requiredFeatureKeys = ['survey', 'create_post', 'post_list', 'inbox', 'user_management', 'rank_tracker'];
  for (const featureKey of requiredFeatureKeys) {
    const normalizedFeatureKey = featureKey.toLowerCase();
    const { data: existingRows, error: existingError } = await params.supabase
      .from('feature_flags')
      .select('id')
      .eq('org_id', params.orgId)
      .eq('store_id', params.storeId)
      .eq('feature_key', normalizedFeatureKey)
      .limit(1);
    if (existingError) {
      throw new Error(`Failed to load feature flag (${normalizedFeatureKey}): ${existingError.message}`);
    }

    if (existingRows && existingRows.length > 0) {
      const { error: updateError } = await params.supabase
        .from('feature_flags')
        .update({
          state: 'ENABLED',
          note: '[AUDIT] normalized by bootstrapUsers',
          updated_by: params.actorUserId,
        })
        .eq('org_id', params.orgId)
        .eq('store_id', params.storeId)
        .eq('feature_key', normalizedFeatureKey);
      if (updateError) {
        throw new Error(`Failed to update feature flag (${normalizedFeatureKey}): ${updateError.message}`);
      }
    } else {
      const { error: insertError } = await params.supabase.from('feature_flags').insert({
        org_id: params.orgId,
        store_id: params.storeId,
        feature_key: normalizedFeatureKey,
        state: 'ENABLED',
        note: '[AUDIT] normalized by bootstrapUsers',
        updated_by: params.actorUserId,
      });
      if (insertError) {
        throw new Error(`Failed to insert feature flag (${normalizedFeatureKey}): ${insertError.message}`);
      }
    }
  }
};

const requireValue = (map: Record<string, string>, key: string): string => {
  const value = map[key];
  if (!value) throw new Error(`Missing required env in .env.audit.local: ${key}`);
  return value;
};

const roleRank = (role: string): number => {
  switch (String(role || '').toUpperCase()) {
    case 'ADMIN':
      return 4;
    case 'SUPERVISOR':
      return 3;
    case 'MANAGER':
      return 2;
    case 'USER':
      return 1;
    default:
      return 0;
  }
};

const invokeEdgeFunctionJson = async (params: {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  functionName: string;
  body: unknown;
}): Promise<{ ok: boolean; status: number; statusText: string; json?: unknown; text: string }> => {
  const url = `${params.supabaseUrl.replace(/\/+$/, '')}/functions/v1/${params.functionName}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: params.anonKey,
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params.body),
  });
  const text = await res.text();
  let json: unknown | undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { ok: res.ok, status: res.status, statusText: res.statusText, json, text };
};

const extractString = (value: unknown): string => {
  if (typeof value === 'string') return value;
  return '';
};

const findExistingUserIdByEmail = async (params: {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  orgId: string;
  email: string;
}): Promise<string | null> => {
  const query = params.email.split('@')[0] || params.email;
  const search = await invokeEdgeFunctionJson({
    supabaseUrl: params.supabaseUrl,
    anonKey: params.anonKey,
    accessToken: params.accessToken,
    functionName: 'admin-user-attach-existing',
    body: {
      orgId: params.orgId,
      query,
    },
  });
  if (!search.ok) return null;

  const candidatesRaw =
    search.json && typeof search.json === 'object' && 'candidates' in search.json
      ? (search.json as { candidates?: unknown }).candidates
      : undefined;
  if (!Array.isArray(candidatesRaw)) return null;

  const wanted = params.email.trim().toLowerCase();
  for (const item of candidatesRaw) {
    if (!item || typeof item !== 'object') continue;
    const typed = item as { userId?: unknown; email?: unknown };
    const email = extractString(typed.email).trim().toLowerCase();
    const userId = extractString(typed.userId).trim();
    if (!userId || !email) continue;
    if (email === wanted) return userId;
  }
  return null;
};

const deleteUserFully = async (params: {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  orgId: string;
  targetUserId: string;
}): Promise<void> => {
  const first = await invokeEdgeFunctionJson({
    supabaseUrl: params.supabaseUrl,
    anonKey: params.anonKey,
    accessToken: params.accessToken,
    functionName: 'admin-user-delete',
    body: {
      orgId: params.orgId,
      targetUserId: params.targetUserId,
      mode: 'FULL_DELETE',
    },
  });
  if (first.status !== 409) {
    if (!first.ok) {
      throw new Error(`Failed to request FULL_DELETE confirm token: ${first.text} (status=${first.status})`);
    }
    return;
  }

  const confirmToken =
    first.json && typeof first.json === 'object' && 'confirmToken' in first.json
      ? extractString((first.json as { confirmToken?: unknown }).confirmToken).trim()
      : '';
  if (!confirmToken) {
    throw new Error(`FULL_DELETE confirm token is missing: ${first.text}`);
  }

  const second = await invokeEdgeFunctionJson({
    supabaseUrl: params.supabaseUrl,
    anonKey: params.anonKey,
    accessToken: params.accessToken,
    functionName: 'admin-user-delete',
    body: {
      orgId: params.orgId,
      targetUserId: params.targetUserId,
      mode: 'FULL_DELETE',
      confirmToken,
    },
  });
  if (!second.ok) {
    throw new Error(`Failed to execute FULL_DELETE: ${second.text} (status=${second.status})`);
  }
};

const recreateAuditUser = async (params: {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  orgId: string;
  storeId: string;
  email: string;
  password: string;
  role: 'SUPERVISOR' | 'MANAGER' | 'USER';
  name: string;
  outputDir: string;
  outputPrefix: string;
}): Promise<string> => {
  const existingUserId = await findExistingUserIdByEmail({
    supabaseUrl: params.supabaseUrl,
    anonKey: params.anonKey,
    accessToken: params.accessToken,
    orgId: params.orgId,
    email: params.email,
  });
  if (existingUserId) {
    try {
      await deleteUserFully({
        supabaseUrl: params.supabaseUrl,
        anonKey: params.anonKey,
        accessToken: params.accessToken,
        orgId: params.orgId,
        targetUserId: existingUserId,
      });
    } catch (error) {
      await writeTextFile(
        path.join(params.outputDir, `${params.outputPrefix}.delete.error.log`),
        error instanceof Error ? error.stack || error.message : String(error)
      );
      throw error;
    }
  }

  const createResult = await invokeEdgeFunctionJson({
    supabaseUrl: params.supabaseUrl,
    anonKey: params.anonKey,
    accessToken: params.accessToken,
    functionName: 'admin-create-user',
    body: {
      email: params.email,
      name: params.name,
      role: params.role,
      orgId: params.orgId,
      storeId: params.storeId,
      password: params.password,
    },
  });
  if (!createResult.ok) {
    await writeJsonFile(path.join(params.outputDir, `${params.outputPrefix}.create.error.json`), createResult);
    throw new Error(`Failed to provision ${params.role}: ${createResult.text} (status=${createResult.status})`);
  }
  const userId =
    createResult.json && typeof createResult.json === 'object' && 'userId' in createResult.json
      ? extractString((createResult.json as { userId?: unknown }).userId).trim()
      : '';
  return userId;
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

    const supervisorEmail = envAudit.AUDIT_SUPERVISOR_EMAIL?.trim() || '';
    const supervisorPassword = envAudit.AUDIT_SUPERVISOR_PASSWORD?.trim() || '';
    const hasSupervisorCreds = Boolean(supervisorEmail && supervisorPassword);

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

    await ensureAuditFeatureFlags({
      supabase,
      orgId,
      storeId,
      actorUserId,
    });

    if (hasSupervisorCreds) {
      out.supervisorUserId = await recreateAuditUser({
        supabaseUrl,
        anonKey,
        accessToken,
        orgId,
        storeId,
        email: supervisorEmail,
        password: supervisorPassword,
        role: 'SUPERVISOR',
        name: '[AUDIT] Supervisor',
        outputDir: params.outputDir,
        outputPrefix: 'invoke.supervisor',
      });
    }

    out.managerUserId = await recreateAuditUser({
      supabaseUrl,
      anonKey,
      accessToken,
      orgId,
      storeId,
      email: managerEmail,
      password: managerPassword,
      role: 'MANAGER',
      name: '[AUDIT] Manager',
      outputDir: params.outputDir,
      outputPrefix: 'invoke.manager',
    });

    out.userUserId = await recreateAuditUser({
      supabaseUrl,
      anonKey,
      accessToken,
      orgId,
      storeId,
      email: userEmail,
      password: userPassword,
      role: 'USER',
      name: '[AUDIT] User',
      outputDir: params.outputDir,
      outputPrefix: 'invoke.user',
    });

    // Basic sign-in sanity (avoid running E2E with broken credentials).
    const sanityClient = createClient(supabaseUrl, anonKey);
    const sanity = async (email: string, password: string, label: string) => {
      const { error } = await sanityClient.auth.signInWithPassword({ email, password });
      if (error) throw new Error(`${label} sign-in failed after provisioning: ${error.message}`);
      await sanityClient.auth.signOut();
    };
    if (hasSupervisorCreds) {
      await sanity(supervisorEmail, supervisorPassword, 'SUPERVISOR');
    }
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

const main = async () => {
  const repoRoot = process.cwd();
  const outputDir =
    process.env.AUDIT_OUTPUT_DIR || path.join(repoRoot, 'output', 'audit', '_adhoc', 'bootstrap_users', new Date().toISOString().replace(/[:.]/g, '-'));
  const result = await ensureAuditUsers({ repoRoot, outputDir });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
