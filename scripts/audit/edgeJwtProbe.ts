import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadDotEnvFile, resolveRepoRoot } from './lib';

type ProbeTarget = {
  functionName: string;
  payload: Record<string, unknown>;
};

type ProbeResult = {
  functionName: string;
  status: number;
  bodyText: string;
  invalidJwt: boolean;
  missingDeployment: boolean;
};

const requireValue = (value: string | undefined, key: string): string => {
  if (!value || !value.trim()) {
    throw new Error(`${key} が未設定です。`);
  }
  return value.trim();
};

const sanitize = (value: string): string => value.replace(/\s+/g, ' ').trim();

const isInvalidJwtResponse = (status: number, bodyText: string): boolean => {
  if (status !== 401) return false;
  const normalized = bodyText.toLowerCase();
  return (
    normalized.includes('invalid jwt') ||
    normalized.includes('missing authorization') ||
    normalized.includes('missing auth token') ||
    normalized.includes('invalid auth token') ||
    normalized.includes('auth session missing') ||
    normalized.includes('invalid token') ||
    normalized.includes('jwt')
  );
};

const callFunction = async (params: {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  target: ProbeTarget;
}): Promise<ProbeResult> => {
  const response = await fetch(
    `${params.supabaseUrl}/functions/v1/${params.target.functionName}?client=audit-edge-jwt`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: params.anonKey,
        Authorization: `Bearer ${params.accessToken}`,
      },
      body: JSON.stringify(params.target.payload),
    }
  );

  const bodyText = await response.text();
  return {
    functionName: params.target.functionName,
    status: response.status,
    bodyText,
    invalidJwt: isInvalidJwtResponse(response.status, bodyText),
    missingDeployment: response.status === 404,
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

  const storesResult = await client.from('stores').select('id').limit(1);
  const firstStoreId =
    Array.isArray(storesResult.data) && storesResult.data.length > 0 && storesResult.data[0]?.id
      ? String(storesResult.data[0].id)
      : '00000000-0000-0000-0000-000000000000';

  const targets: ProbeTarget[] = [
    {
      functionName: 'dashboard-metrics',
      payload: { storeId: firstStoreId, range: '7days' },
    },
    {
      functionName: 'inbox-sync',
      payload: { storeId: firstStoreId, providers: ['FACEBOOK', 'INSTAGRAM', 'GBP'], mode: 'LATEST_ONLY' },
    },
    {
      functionName: 'facebook-reply-message',
      payload: { storeId: firstStoreId, externalMessageId: 'probe-external-id', replyText: 'probe' },
    },
    {
      functionName: 'instagram-reply-comment',
      payload: { storeId: firstStoreId, externalMessageId: 'probe-external-id', replyText: 'probe' },
    },
    {
      functionName: 'gbp-reply-review',
      payload: { storeId: firstStoreId, externalMessageId: 'probe-external-id', replyText: 'probe' },
    },
    {
      functionName: 'inbox-apply-reaction',
      payload: {
        storeId: firstStoreId,
        provider: 'FACEBOOK',
        channel: 'REVIEWS',
        externalMessageId: 'probe-external-id',
        reaction: 'LIKE',
      },
    },
  ];

  const results: ProbeResult[] = [];
  for (const target of targets) {
    const result = await callFunction({
      supabaseUrl,
      anonKey,
      accessToken,
      target,
    });
    results.push(result);
  }

  const invalidJwtFailures = results.filter((result) => result.invalidJwt);
  const notDeployedFailures = results.filter((result) => result.missingDeployment);

  console.log('\n[edgeJwtProbe] result');
  for (const result of results) {
    const label = result.invalidJwt || result.missingDeployment ? 'FAIL' : 'PASS';
    console.log(
      `- ${label} ${result.functionName}: status=${result.status} body=${sanitize(result.bodyText).slice(0, 220)}`
    );
  }

  if (invalidJwtFailures.length > 0 || notDeployedFailures.length > 0) {
    if (invalidJwtFailures.length > 0) {
      console.error(
        `\nInvalid JWTが検出されました: ${invalidJwtFailures.map((item) => item.functionName).join(', ')}`
      );
    }
    if (notDeployedFailures.length > 0) {
      console.error(
        `\n未配備（404）が検出されました: ${notDeployedFailures.map((item) => item.functionName).join(', ')}`
      );
    }
    process.exitCode = 1;
  }
};

void main().catch((error) => {
  console.error('[edgeJwtProbe] failed:', error);
  process.exitCode = 1;
});
