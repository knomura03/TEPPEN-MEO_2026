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
  if (!fs.existsSync(envPath)) {
    throw new Error('Missing .env.audit.local. Create it before running dashboard audit.');
  }
  const env = loadDotEnvFileSync(envPath);
  return {
    email: requireEnv(env, 'AUDIT_ADMIN_EMAIL'),
    password: requireEnv(env, 'AUDIT_ADMIN_PASSWORD'),
  };
};

const adminCreds = loadAdminCreds();

const login = async (page: Page, creds: AuditCreds) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"], input[type="email"]').first().fill(creds.email);
  await page.locator('input[name="password"], input[type="password"]').first().fill(creds.password);
  await page.locator('button[type="submit"], [data-testid="login-submit"]').first().click();
  await expect(page.locator('#nav-DASHBOARD')).toBeVisible();
};

const ensureStoreSelected = async (page: Page) => {
  const selector = page.getByTestId('store-selector');
  if (!(await selector.isVisible().catch(() => false))) return;
  const value = await selector.inputValue();
  if (value) return;
  const firstOptionValue = await selector.locator('option').first().getAttribute('value');
  if (firstOptionValue) {
    await selector.selectOption(firstOptionValue);
  }
};

test('ダッシュボードでInvalid JWTトーストが出ない', async ({ page }) => {
  await login(page, adminCreds);
  await ensureStoreSelected(page);

  await page.goto('/?view=DASHBOARD', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'ダッシュボード' }).first()).toBeVisible();

  await page.waitForTimeout(6_000);

  await expect(page.locator('text=Invalid JWT')).toHaveCount(0);
  await expect(page.locator('text=ログインセッションが無効です')).toHaveCount(0);
  await expect(page.locator('text=ダッシュボード取得エラー')).toHaveCount(0);

  const recoveryBadgeCount = await page.locator('span', { hasText: /取得済み|データなし|要確認/ }).count();
  expect(recoveryBadgeCount).toBeGreaterThan(0);
});
