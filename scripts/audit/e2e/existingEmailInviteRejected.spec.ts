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

const loadEnv = () => {
  const envPath = path.join(process.cwd(), '.env.audit.local');
  const env = loadDotEnvFileSync(envPath);
  return {
    admin: {
      email: requireEnv(env, 'AUDIT_ADMIN_EMAIL'),
      password: requireEnv(env, 'AUDIT_ADMIN_PASSWORD'),
    } satisfies AuditCreds,
    existingEmail: requireEnv(env, 'AUDIT_USER_EMAIL'),
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

const env = loadEnv();

test('既存メールで新規招待すると固定エラーを返す', async ({ page }) => {
  await login(page, env.admin);
  await page.goto('/?view=USER_MANAGEMENT', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '新規ユーザー作成' }).click();
  await page.getByTestId('invite-name-input').fill('[AUDIT] existing-email');
  await page.getByTestId('invite-email-input').fill(env.existingEmail);

  const groupSelect = page.locator('label:has-text("グループ（必須）")').locator('xpath=following-sibling::select').first();
  const groupValue = await groupSelect.locator('option').nth(1).getAttribute('value');
  if (groupValue) {
    await groupSelect.selectOption(groupValue);
  }
  const storeSelect = page.locator('label:has-text("店舗（必須）")').locator('xpath=following-sibling::select').first();
  const storeValue = await storeSelect.locator('option').nth(1).getAttribute('value');
  if (storeValue) {
    await storeSelect.selectOption(storeValue);
  }

  await page.getByRole('button', { name: '招待を送信' }).click();
  await expect(
    page.getByText('すでに存在しているユーザーのため招待できません。別のメールアドレスを指定してください。')
  ).toBeVisible({ timeout: 20_000 });
});
