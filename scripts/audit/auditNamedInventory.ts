import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadDotEnvFile, resolveRepoRoot, writeTextFile } from './lib';

type OrganizationRow = {
  id: string;
  name: string | null;
  management_unit_id: string | null;
  created_at: string;
};

type StoreRow = {
  id: string;
  org_id: string;
  name: string | null;
  created_at: string;
};

type ManagementUnitRow = {
  id: string;
  name: string | null;
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

  const { data: orgData, error: orgError } = await client
    .from('organizations')
    .select('id, name, management_unit_id, created_at')
    .order('created_at', { ascending: false });
  if (orgError) throw orgError;

  const { data: storeData, error: storeError } = await client
    .from('stores')
    .select('id, org_id, name, created_at')
    .order('created_at', { ascending: false });
  if (storeError) throw storeError;

  const { data: unitData, error: unitError } = await client
    .from('management_units')
    .select('id, name');
  if (unitError) throw unitError;

  const organizations = (orgData || []) as OrganizationRow[];
  const stores = (storeData || []) as StoreRow[];
  const units = (unitData || []) as ManagementUnitRow[];

  const unitMap = new Map<string, string>();
  units.forEach((unit) => {
    unitMap.set(unit.id, normalizeText(unit.name) || unit.id);
  });

  const orgMap = new Map<string, OrganizationRow>();
  organizations.forEach((org) => {
    orgMap.set(org.id, org);
  });

  const auditGroups = organizations.filter((org) => isAuditNamed(org.name));
  const auditGroupIds = new Set(auditGroups.map((org) => org.id));

  const auditNamedStores = stores.filter((store) => isAuditNamed(store.name));
  const storesUnderAuditGroups = stores.filter((store) => auditGroupIds.has(store.org_id));

  const cleanupStoreMap = new Map<string, StoreRow>();
  auditNamedStores.forEach((store) => cleanupStoreMap.set(store.id, store));
  storesUnderAuditGroups.forEach((store) => cleanupStoreMap.set(store.id, store));
  const cleanupStores = Array.from(cleanupStoreMap.values());

  const generatedAt = new Date();
  const filePath = path.join(repoRoot, 'docs', '28_AUDIT_GROUP_STORE_INVENTORY.md');

  const groupRows = auditGroups.map((org) => [
    `\`${org.id}\``,
    normalizeText(org.name) || '（名称なし）',
    org.management_unit_id ? normalizeText(unitMap.get(org.management_unit_id)) || org.management_unit_id : '（未設定）',
    toJst(org.created_at),
  ]);

  const storeRows = cleanupStores.map((store) => {
    const org = orgMap.get(store.org_id);
    const reason: string[] = [];
    if (isAuditNamed(store.name)) reason.push('店舗名に[AUDIT]');
    if (auditGroupIds.has(store.org_id)) reason.push('所属グループが[AUDIT]');
    return [
      `\`${store.id}\``,
      normalizeText(store.name) || '（名称なし）',
      org ? normalizeText(org.name) || org.id : store.org_id,
      reason.join(' / '),
      toJst(store.created_at),
    ];
  });

  const markdown = [
    '# [AUDIT] グループ/店舗 棚卸しレポート',
    '',
    `- 生成日時: ${generatedAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`,
    '- 対象: Supabase Production（管理者ログインで取得）',
    '',
    '## 集計',
    '',
    `- [AUDIT]名のグループ数: **${auditGroups.length}件**`,
    `- [AUDIT]名の店舗数: **${auditNamedStores.length}件**`,
    `- [AUDIT]グループ配下の店舗数: **${storesUnderAuditGroups.length}件**`,
    `- クリーンアップ候補店舗数（重複除外）: **${cleanupStores.length}件**`,
    '',
    '## [AUDIT]グループ一覧',
    '',
    renderTable(['グループID', 'グループ名', '管理ユニット', '作成日時'], groupRows),
    '',
    '## クリーンアップ候補店舗一覧',
    '',
    renderTable(['店舗ID', '店舗名', '所属グループ', '候補理由', '作成日時'], storeRows),
    '',
    '## 補足',
    '',
    '- 本レポートは棚卸し用です。削除は実行していません。',
    '- 「候補理由」が `所属グループが[AUDIT]` のみの店舗は、名称自体が監査用ではない可能性があります。削除前に確認してください。',
    '',
  ].join('\n');

  await writeTextFile(filePath, markdown);

  console.log('[auditNamedInventory] generated:', filePath);
  console.log(`[auditNamedInventory] groups=${auditGroups.length}, cleanupStores=${cleanupStores.length}`);
};

void main().catch((error) => {
  console.error('[auditNamedInventory] failed:', error);
  process.exitCode = 1;
});
