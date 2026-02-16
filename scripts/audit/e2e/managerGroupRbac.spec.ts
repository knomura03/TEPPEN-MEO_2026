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

const requireEnv = (map: Record<string, string>, key: string): string => {
  const value = map[key];
  if (!value) {
    throw new Error(`Missing required env in .env.audit.local: ${key}`);
  }
  return value;
};

const loadAdminCreds = (): AuditCreds => {
  const envPath = path.join(process.cwd(), '.env.audit.local');
  const env = loadDotEnvFileSync(envPath);
  return {
    email: requireEnv(env, 'AUDIT_ADMIN_EMAIL'),
    password: requireEnv(env, 'AUDIT_ADMIN_PASSWORD'),
  };
};

const getLoginEmailInput = (page: Page) =>
  page
    .locator('[data-testid="login-email"], input[name="email"], input[type="email"], input[placeholder="you@example.com"]')
    .first();
const getLoginPasswordInput = (page: Page) =>
  page
    .locator('[data-testid="login-password"], input[name="password"], input[type="password"], input[placeholder="••••••••"]')
    .first();
const getLoginSubmitButton = (page: Page) =>
  page
    .locator('[data-testid="login-submit"], button[type="submit"], button:has-text("ログイン"), button:has-text("管理画面")')
    .first();

const login = async (page: Page, creds: AuditCreds) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('hasSeenTour', 'true'));
  await getLoginEmailInput(page).fill(creds.email);
  await getLoginPasswordInput(page).fill(creds.password);
  await getLoginSubmitButton(page).click();
  await expect(page.locator('#nav-DASHBOARD')).toBeVisible();
};

const adminCreds = loadAdminCreds();

test('MANAGERはグループ作成不可・名称変更可', async ({ page, browser }) => {
  const timestamp = Date.now();
  const managerCreds: AuditCreds = {
    email: `manager-rbac-${timestamp}@example.com`,
    password: `AuditMgr!${String(timestamp).slice(-6)}`,
  };

  await login(page, adminCreds);
  await page.goto('/?view=USER_MANAGEMENT', { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: '新規ユーザー作成' }).click();
  await page.getByTestId('invite-name-input').fill(`[AUDIT] Manager RBAC ${timestamp}`);
  await page.getByTestId('invite-email-input').fill(managerCreds.email);
  await page.getByTestId('invite-role-select').selectOption('MANAGER');

  const groupSelect = page
    .locator('label:has-text("グループ（必須）")')
    .locator('xpath=following-sibling::select')
    .first();
  const groupValue = await groupSelect.locator('option').nth(1).getAttribute('value');
  if (groupValue) {
    await groupSelect.selectOption(groupValue);
  }

  const storeSelect = page
    .locator('label:has-text("店舗（必須）")')
    .locator('xpath=following-sibling::select')
    .first();
  const storeValue = await storeSelect.locator('option').nth(1).getAttribute('value');
  if (storeValue) {
    await storeSelect.selectOption(storeValue);
  }

  await page.locator('summary:has-text("詳細（監査用）")').click();
  await page.getByTestId('invite-password-input').fill(managerCreds.password);
  const inviteSubmitButton = page.getByRole('button', { name: '招待を送信' });
  await inviteSubmitButton.evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  await expect(page.getByText('ユーザーを作成しました。')).toBeVisible({ timeout: 20_000 });

  const managerContext = await browser.newContext({
    baseURL: process.env.AUDIT_BASE_URL || 'http://localhost:3000',
  });
  const managerPage = await managerContext.newPage();
  await login(managerPage, managerCreds);
  await managerPage.goto('/?view=GROUP_MANAGEMENT', { waitUntil: 'domcontentloaded' });
  await expect(managerPage.locator('h1:has-text("グループ管理")')).toBeVisible();
  await expect(managerPage.locator('#group-rename-form')).toBeVisible();
  await expect(managerPage.locator('#group-create-form')).toHaveCount(0);
  await managerContext.close();
});
