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

test('既存ユーザーを検索してグループ/店舗へ追加できる', async ({ page }) => {
  await login(page, env.admin);
  await page.goto('/?view=USER_MANAGEMENT', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '既存ユーザーを追加' }).click();

  const groupSelect = page.locator('label:has-text("追加先グループ")').locator('xpath=following-sibling::select').first();
  const groupValue = await groupSelect.locator('option').nth(1).getAttribute('value');
  if (groupValue) {
    await groupSelect.selectOption(groupValue);
  }
  const storeSelect = page.locator('label:has-text("追加先店舗")').locator('xpath=following-sibling::select').first();
  const storeValue = await storeSelect.locator('option').nth(1).getAttribute('value');
  if (storeValue) {
    await storeSelect.selectOption(storeValue);
  }

  await page.getByPlaceholder('例: sample@example.com').fill(env.existingEmail);
  await page.getByRole('button', { name: '検索', exact: true }).click();
  const noResultNotice = page.getByText('検索結果がありません。');
  if (await noResultNotice.isVisible()) {
    await page.getByPlaceholder('例: sample@example.com').fill(env.admin.email);
    await page.getByRole('button', { name: '検索', exact: true }).click();
  }
  await expect(page.locator('input[name="attach-existing-user"], input[type="radio"]').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('input[type="radio"]').first().check();

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: '既存ユーザーを追加' }).last().click();
  await expect(page.getByText('既存ユーザーをグループ/店舗へ追加しました。')).toBeVisible({ timeout: 20_000 });
});
