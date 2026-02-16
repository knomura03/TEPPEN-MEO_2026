import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type AuditCreds = {
  email: string;
  password: string;
};

const requireEnv = (map: Record<string, string>, key: string): string => {
  const value = map[key];
  if (!value) {
    throw new Error(`Missing required env in .env.audit.local: ${key}`);
  }
  return value;
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

const creds = loadAdminCreds();

test('新規ユーザー作成時はグループ/店舗が必須', async ({ page }) => {
  await login(page, creds);
  await page.goto('/?view=USER_MANAGEMENT', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '新規ユーザー作成' }).click();
  await page.getByTestId('invite-name-input').fill('[AUDIT] required-check');
  await page.getByTestId('invite-email-input').fill(`required-${Date.now()}@example.com`);
  await page.getByRole('button', { name: '新規グループを作成' }).click();
  await page.getByTestId('invite-copy-link-button').click();
  await expect(page.getByText('新規グループ作成時はグループ名と初期店舗名が必須です。')).toBeVisible({ timeout: 15_000 });
});
