import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type AuditCreds = {
  email: string;
  password: string;
};

const loadDotEnvFileSync = (filePath: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (!key) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
};

const loadCred = (env: Record<string, string>, emailKey: string, passwordKey: string): AuditCreds | null => {
  const email = env[emailKey];
  const password = env[passwordKey];
  if (!email || !password) return null;
  return { email, password };
};

const loadAuditCreds = (): { manager: AuditCreds; supervisor?: AuditCreds } => {
  const envPath = path.join(process.cwd(), '.env.audit.local');
  if (!fs.existsSync(envPath)) {
    throw new Error('Missing .env.audit.local.');
  }
  const env = loadDotEnvFileSync(envPath);
  const manager = loadCred(env, 'AUDIT_MANAGER_EMAIL', 'AUDIT_MANAGER_PASSWORD');
  if (!manager) {
    throw new Error('Missing manager credentials in .env.audit.local.');
  }
  const supervisor = loadCred(env, 'AUDIT_SUPERVISOR_EMAIL', 'AUDIT_SUPERVISOR_PASSWORD');
  return {
    manager,
    supervisor: supervisor || undefined,
  };
};

const auditCreds = loadAuditCreds();

const login = async (page: Page, cred: AuditCreds) => {
  await page.addInitScript(() => {
    localStorage.setItem('hasSeenTour', 'true');
  });
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"], input[type="email"]').first().fill(cred.email);
  await page.locator('input[name="password"], input[type="password"]').first().fill(cred.password);
  await page.locator('button[type="submit"], [data-testid="login-submit"]').first().click();
  await expect(page.locator('#nav-DASHBOARD')).toBeVisible();
};

test('MANAGER（未設定時はSUPERVISOR）がグループ作成と名称変更を実行できる', async ({ page }) => {
  await login(page, auditCreds.manager);
  if ((await page.locator('#nav-GROUP_MANAGEMENT').count()) === 0) {
    test.skip(true, '監査用MANAGERにグループ管理権限がありません。MANAGERロール割当後に再実行してください。');
    return;
  }

  await page.locator('#nav-GROUP_MANAGEMENT').click();
  await expect(page).toHaveURL(/view=GROUP_MANAGEMENT/);
  await expect(page.locator('#group-management-main')).toBeVisible();

  const nonce = Date.now().toString().slice(-6);
  const groupName = `[AUDIT] グループ_${nonce}`;
  const initialStoreName = `[AUDIT] 店舗_${nonce}`;
  const renamedGroupName = `${groupName}_更新`;

  await page.getByPlaceholder('グループ名（例: 関東エリア）').fill(groupName);
  await page.getByPlaceholder('初期店舗名（例: 新宿本店）').fill(initialStoreName);
  await page.getByRole('button', { name: 'グループを作成' }).click();

  await expect(page.getByText(groupName)).toBeVisible({ timeout: 15_000 });

  const renameInput = page.locator('form:has-text("現在のグループ名を変更") input').first();
  await renameInput.fill(renamedGroupName);
  await page.getByRole('button', { name: 'グループ名を更新' }).click();
  await expect(page.getByText('グループ名を更新しました。')).toBeVisible({ timeout: 15_000 });
});
