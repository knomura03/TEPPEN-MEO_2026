import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadDotEnvFile, resolveRepoRoot, writeTextFile } from './lib';

type OrganizationRow = {
  id: string;
  name: string | null;
  created_at: string;
};

type StoreRow = {
  id: string;
  org_id: string;
  name: string | null;
  created_at: string;
};

type DeleteResult = {
  requested: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errorMessages: string[];
};

type CleanupTargetKey = 'stores' | 'groups' | 'users' | 'plans';

type CleanupTargets = Record<CleanupTargetKey, boolean>;

type CleanupFunctionBody = {
  ok?: boolean;
  error?: string;
  summary?: {
    stores?: {
      requested?: number;
      deleted?: number;
      failed?: number;
      skipped?: number;
      errors?: string[];
    };
    groups?: {
      requested?: number;
      deleted?: number;
      failed?: number;
      skipped?: number;
      errors?: string[];
    };
    users?: {
      requested?: number;
      deleted?: number;
      failed?: number;
      skipped?: number;
      errors?: string[];
    };
    plans?: {
      requested?: number;
      deleted?: number;
      failed?: number;
      skipped?: number;
      errors?: string[];
    };
  };
  candidates?: {
    groups?: Array<{ id?: string; name?: string | null; createdAt?: string }>;
    stores?: Array<{ id?: string; orgId?: string; name?: string | null; createdAt?: string }>;
    users?: Array<{ id?: string; email?: string; name?: string | null; createdAt?: string }>;
    plans?: Array<{ id?: string; code?: string | null; name?: string | null; createdAt?: string }>;
  };
};

const requireValue = (value: string | undefined, label: string): string => {
  if (!value || !value.trim()) {
    throw new Error(`${label} が未設定です。`);
  }
  return value.trim();
};

const normalizeText = (value: string | null | undefined): string => (value || '').trim();

const isAuditNamed = (value: string | null | undefined): boolean => {
  const text = normalizeText(value).toLowerCase();
  if (!text) return false;
  return text.includes('[audit]');
};

const toJst = (value: string): string => {
  try {
    return new Date(value).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  } catch {
    return value;
  }
};

const renderTable = (headers: string[], rows: string[][]): string => {
  const head = `| ${headers.join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  if (rows.length === 0) {
    return [head, divider, `| （該当なし） | ${headers.slice(1).map(() => '').join(' | ')} |`].join('\n');
  }
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
  return [head, divider, body].join('\n');
};

const parseTargets = (): CleanupTargets => {
  const defaults: CleanupTargets = {
    stores: true,
    groups: true,
    users: false,
    plans: false,
  };
  const targetArg = process.argv.find((arg) => arg.startsWith('--targets='));
  if (!targetArg) return defaults;
  const raw = targetArg.slice('--targets='.length).trim();
  if (!raw) return defaults;
  const enabled = new Set(
    raw
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
  return {
    stores: enabled.has('stores'),
    groups: enabled.has('groups'),
    users: enabled.has('users'),
    plans: enabled.has('plans'),
  };
};

const mapDeleteResult = (
  source: CleanupFunctionBody['summary'] extends infer T ? T : never,
  key: CleanupTargetKey
): DeleteResult => {
  const raw = (source as CleanupFunctionBody['summary'])?.[key];
  return {
    requested: Number(raw?.requested || 0),
    succeeded: Number(raw?.deleted || 0),
    failed: Number(raw?.failed || 0),
    skipped: Number(raw?.skipped || 0),
    errorMessages: Array.isArray(raw?.errors) ? raw!.errors!.map((item) => String(item || '')) : [],
  };
};

const callCleanupFunction = async (params: {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  applyMode: boolean;
  cleanupTargets: CleanupTargets;
}): Promise<CleanupFunctionBody> => {
  const response = await fetch(`${params.supabaseUrl}/functions/v1/admin-audit-data-cleanup?client=audit-cleanup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: params.anonKey,
      Authorization: `Bearer ${params.accessToken}`,
    },
    body: JSON.stringify({
      apply: params.applyMode,
      cleanupTargets: params.cleanupTargets,
    }),
  });
  const raw = await response.text();
  let parsed: CleanupFunctionBody = {};
  try {
    parsed = JSON.parse(raw) as CleanupFunctionBody;
  } catch {
    parsed = { ok: false, error: raw || 'Invalid function response' };
  }
  if (!response.ok || parsed.ok === false) {
    throw new Error(parsed.error || `admin-audit-data-cleanup failed (status=${response.status})`);
  }
  return parsed;
};

const main = async () => {
  const applyMode = process.argv.includes('--apply');
  const cleanupTargets = parseTargets();
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

  const cleanupResponse = await callCleanupFunction({
    supabaseUrl,
    anonKey,
    accessToken,
    applyMode,
    cleanupTargets,
  });
  const rawGroups = cleanupResponse.candidates?.groups || [];
  const rawStores = cleanupResponse.candidates?.stores || [];
  const rawUsers = cleanupResponse.candidates?.users || [];
  const rawPlans = cleanupResponse.candidates?.plans || [];
  const auditGroups: OrganizationRow[] = rawGroups.map((item) => ({
    id: String(item.id || ''),
    name: item.name || null,
    created_at: String(item.createdAt || ''),
  }));
  const storesToDelete: StoreRow[] = rawStores.map((item) => ({
    id: String(item.id || ''),
    org_id: String(item.orgId || ''),
    name: item.name || null,
    created_at: String(item.createdAt || ''),
  }));
  const storeIds = storesToDelete.map((store) => store.id).filter(Boolean);
  const orgIds = auditGroups.map((org) => org.id).filter(Boolean);
  const userIds = rawUsers.map((user) => String(user.id || '')).filter(Boolean);
  const planIds = rawPlans.map((plan) => String(plan.id || '')).filter(Boolean);

  const storeDeleteResult = mapDeleteResult(cleanupResponse.summary, 'stores');
  const orgDeleteResult = mapDeleteResult(cleanupResponse.summary, 'groups');
  const userDeleteResult = mapDeleteResult(cleanupResponse.summary, 'users');
  const planDeleteResult = mapDeleteResult(cleanupResponse.summary, 'plans');

  const generatedAt = new Date();
  const filePath = path.join(repoRoot, 'docs', '29_AUDIT_DATA_CLEANUP_LOG.md');

  const groupRows = auditGroups.map((org) => [
    `\`${org.id}\``,
    normalizeText(org.name) || '（名称なし）',
    toJst(org.created_at),
  ]);
  const storeRows = storesToDelete.map((store) => [
    `\`${store.id}\``,
    normalizeText(store.name) || '（名称なし）',
    `\`${store.org_id}\``,
    toJst(store.created_at),
  ]);
  const userRows = rawUsers.map((user) => [
    `\`${String(user.id || '')}\``,
    normalizeText(user.email) || '（メールなし）',
    normalizeText(user.name) || '（名称なし）',
    toJst(String(user.createdAt || '')),
  ]);
  const planRows = rawPlans.map((plan) => [
    `\`${String(plan.id || '')}\``,
    normalizeText(plan.code) || '（codeなし）',
    normalizeText(plan.name) || '（名称なし）',
    toJst(String(plan.createdAt || '')),
  ]);

  const markdown = [
    '# [AUDIT] データクリーンアップ実行ログ',
    '',
    `- 実行日時: ${generatedAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`,
    `- 実行モード: ${applyMode ? 'APPLY（実削除）' : 'DRY-RUN（削除なし）'}`,
    `- 対象: ${Object.entries(cleanupTargets)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key)
      .join(', ') || 'なし'}`,
    '',
    '## 対象件数',
    '',
    `- 削除候補グループ: **${cleanupTargets.groups ? orgIds.length : 0}件**`,
    `- 削除候補店舗: **${cleanupTargets.stores ? storeIds.length : 0}件**`,
    `- 削除候補ユーザー: **${cleanupTargets.users ? userIds.length : 0}件**`,
    `- 削除候補契約プラン: **${cleanupTargets.plans ? planIds.length : 0}件**`,
    '',
    applyMode ? '## 実行結果' : '## 実行結果（予告）',
    '',
    cleanupTargets.stores && applyMode
      ? `- stores: requested=${storeDeleteResult.requested}, succeeded=${storeDeleteResult.succeeded}, skipped=${storeDeleteResult.skipped}, failed=${storeDeleteResult.failed}`
      : '- stores: 実削除は未実行',
    cleanupTargets.groups && applyMode
      ? `- organizations: requested=${orgDeleteResult.requested}, succeeded=${orgDeleteResult.succeeded}, skipped=${orgDeleteResult.skipped}, failed=${orgDeleteResult.failed}`
      : '- organizations: 実削除は未実行',
    cleanupTargets.users && applyMode
      ? `- users: requested=${userDeleteResult.requested}, succeeded=${userDeleteResult.succeeded}, skipped=${userDeleteResult.skipped}, failed=${userDeleteResult.failed}`
      : '- users: 実削除は未実行',
    cleanupTargets.plans && applyMode
      ? `- plans: requested=${planDeleteResult.requested}, succeeded=${planDeleteResult.succeeded}, skipped=${planDeleteResult.skipped}, failed=${planDeleteResult.failed}`
      : '- plans: 実削除は未実行',
    '',
    '## 削除候補グループ',
    '',
    cleanupTargets.groups ? renderTable(['グループID', 'グループ名', '作成日時'], groupRows) : '- （対象外）',
    '',
    '## 削除候補店舗',
    '',
    cleanupTargets.stores ? renderTable(['店舗ID', '店舗名', '所属グループID', '作成日時'], storeRows) : '- （対象外）',
    '',
    '## 削除候補ユーザー',
    '',
    cleanupTargets.users ? renderTable(['ユーザーID', 'メールアドレス', '表示名', '作成日時'], userRows) : '- （対象外）',
    '',
    '## 削除候補契約プラン',
    '',
    cleanupTargets.plans ? renderTable(['プランID', 'プランコード', 'プラン名', '作成日時'], planRows) : '- （対象外）',
    '',
    '## エラー',
    '',
    ...(applyMode
      ? [
          ...storeDeleteResult.errorMessages,
          ...orgDeleteResult.errorMessages,
          ...userDeleteResult.errorMessages,
          ...planDeleteResult.errorMessages,
        ]
      : ['- （dry-runのため未実行）']),
    '',
  ].join('\n');

  await writeTextFile(filePath, markdown);

  console.log('[cleanupAuditNamedData] generated:', filePath);
  if (applyMode) {
    console.log(
      `[cleanupAuditNamedData] stores deleted=${storeDeleteResult.succeeded}/${storeDeleteResult.requested}, groups deleted=${orgDeleteResult.succeeded}/${orgDeleteResult.requested}, users deleted=${userDeleteResult.succeeded}/${userDeleteResult.requested}, plans deleted=${planDeleteResult.succeeded}/${planDeleteResult.requested}`
    );
    if (
      storeDeleteResult.failed > 0 ||
      orgDeleteResult.failed > 0 ||
      userDeleteResult.failed > 0 ||
      planDeleteResult.failed > 0 ||
      storeDeleteResult.skipped > 0 ||
      orgDeleteResult.skipped > 0 ||
      userDeleteResult.skipped > 0 ||
      planDeleteResult.skipped > 0
    ) {
      process.exitCode = 1;
    }
  } else {
    console.log(
      `[cleanupAuditNamedData] dry-run targets: stores=${cleanupTargets.stores ? storeIds.length : 0}, groups=${cleanupTargets.groups ? orgIds.length : 0}, users=${cleanupTargets.users ? userIds.length : 0}, plans=${cleanupTargets.plans ? planIds.length : 0}`
    );
  }
};

void main().catch((error) => {
  console.error('[cleanupAuditNamedData] failed:', error);
  process.exitCode = 1;
});
