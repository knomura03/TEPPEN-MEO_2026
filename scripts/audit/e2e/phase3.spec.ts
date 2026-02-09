import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

type AuditCreds = {
  email: string;
  password: string;
};

type LocalAuditEnv = {
  admin: AuditCreds;
  manager: AuditCreds;
  user: AuditCreds;
  baseUrl: string;
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

const loadAuditEnv = (): LocalAuditEnv => {
  const repoRoot = process.cwd();
  const envPath = path.join(repoRoot, '.env.audit.local');
  if (!fs.existsSync(envPath)) {
    throw new Error('Missing .env.audit.local. Create it with AUDIT_* credentials before running audit.');
  }
  const env = loadDotEnvFileSync(envPath);
  return {
    baseUrl: process.env.AUDIT_BASE_URL || 'http://localhost:3000',
    admin: {
      email: requireEnv(env, 'AUDIT_ADMIN_EMAIL'),
      password: requireEnv(env, 'AUDIT_ADMIN_PASSWORD'),
    },
    manager: {
      email: requireEnv(env, 'AUDIT_MANAGER_EMAIL'),
      password: requireEnv(env, 'AUDIT_MANAGER_PASSWORD'),
    },
    user: {
      email: requireEnv(env, 'AUDIT_USER_EMAIL'),
      password: requireEnv(env, 'AUDIT_USER_PASSWORD'),
    },
  };
};

const env = loadAuditEnv();
const runId = `AUDIT_${new Date().toISOString().replace(/[:.]/g, '-')}`;

const ensureLoggedOut = async (page: Page) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const loginEmail = page.getByTestId('login-email');
  if (await loginEmail.isVisible().catch(() => false)) return;

  const logout = page.getByRole('button', { name: 'ログアウト' }).first();
  if (await logout.isVisible().catch(() => false)) {
    await logout.click();
  } else {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  await expect(page.getByTestId('login-email')).toBeVisible();
};

const login = async (page: Page, creds: AuditCreds) => {
  const loginEmail = page.getByTestId('login-email');
  if (!(await loginEmail.isVisible().catch(() => false))) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  }
  await expect(page.getByTestId('login-email')).toBeVisible();
  await page.getByTestId('login-email').fill(creds.email);
  await page.getByTestId('login-password').fill(creds.password);
  await page.getByTestId('login-submit').click();
  await expect(page.locator('#nav-DASHBOARD')).toBeVisible();
};

const logout = async (page: Page) => {
  const btn = page.getByRole('button', { name: 'ログアウト' }).first();
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.getByTestId('login-email')).toBeVisible();
  await page.waitForFunction(() => {
    const keys = Object.keys(window.localStorage || {});
    return keys.filter((k) => k.startsWith('sb-') && k.endsWith('-auth-token')).length === 0;
  });
};

const ensureStoreSelected = async (page: Page) => {
  const selector = page.getByTestId('store-selector');
  if (!(await selector.isVisible().catch(() => false))) {
    throw new Error('Store selector not found. The app shell may not be loaded.');
  }
  const current = await selector.inputValue();
  if (current) return;
  const firstValue = await selector.locator('option').first().getAttribute('value');
  if (!firstValue) {
    throw new Error('Store selector has no options.');
  }
  await selector.selectOption(firstValue);
};

const openRankTracker = async (page: Page) => {
  await page.locator('#nav-RANK_TRACKER').click();
  await expect(page.getByTestId('rank-tracker-view')).toBeVisible();
  await expect(page.getByText('順位計測（キーワード管理）')).toBeVisible();
};

const waitForOneNotification = async (page: Page, titleOrText: RegExp | string): Promise<void> => {
  if (titleOrText instanceof RegExp) {
    await expect(page.getByText(titleOrText).first()).toBeVisible({ timeout: 30_000 });
    return;
  }
  await expect(page.getByText(titleOrText).first()).toBeVisible({ timeout: 30_000 });
};

const pickFirstEnabled = async (locator: Locator): Promise<Locator> => {
  const count = await locator.count();
  for (let idx = 0; idx < count; idx += 1) {
    const item = locator.nth(idx);
    const disabled = await item.isDisabled().catch(() => false);
    if (!disabled) return item;
  }
  throw new Error('No enabled element found.');
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('hasSeenTour', 'true');
  });
});

test('Phase3: admin executes P3-01〜P3-06 flow', async ({ page }) => {
  await ensureLoggedOut(page);
  await login(page, env.admin);
  await ensureStoreSelected(page);
  await openRankTracker(page);

  const keyword = `[AUDIT] ${runId} keyword`;
  await page.getByTestId('rank-keyword-new-input').fill(keyword);
  await page.getByTestId('rank-keyword-note-input').fill(`[AUDIT] ${runId} note`);
  await page.getByTestId('rank-keyword-add').click();
  await waitForOneNotification(page, '追加完了');
  await expect(page.getByTestId('rank-keyword-item').filter({ hasText: keyword }).first()).toBeVisible();

  const competitor = `[AUDIT] ${runId} competitor`;
  await page.getByTestId('rank-competitor-name-input').fill(competitor);
  await page.getByTestId('rank-competitor-note-input').fill(`[AUDIT] ${runId} note`);
  await page.getByTestId('rank-competitor-add').click();
  await waitForOneNotification(page, '追加完了');
  await expect(page.getByTestId('rank-competitor-item').filter({ hasText: competitor }).first()).toBeVisible();

  await page.getByTestId('rank-run-execute').click();
  await waitForOneNotification(page, /収集完了|収集エラー/);

  const runItems = page.getByTestId('rank-run-item');
  await expect(runItems.first()).toBeVisible({ timeout: 30_000 });
  await runItems.first().click();
  await expect(page.getByText('選択中runの収集結果')).toBeVisible();
  await expect(page.getByText(/^順位キーワード$/)).toBeVisible();

  await expect(page.getByText('順位/競合ダッシュボード（P3-04）')).toBeVisible();
  await page.getByTestId('rank-dashboard-reload').click();

  await page.getByTestId('nap-run-execute').click();
  await waitForOneNotification(page, /NAPチェック完了|NAPチェック（注意）|NAPチェックエラー/);
  await expect(page.getByTestId('nap-run-item').first()).toBeVisible({ timeout: 30_000 });

  const alerts = page.getByTestId('nap-alert-item');
  const alertCount = await alerts.count();
  if (alertCount > 0) {
    const firstAlert = alerts.first();
    const toggleBtn = firstAlert.getByTestId('nap-alert-toggle');
    if (await toggleBtn.isVisible().catch(() => false)) {
      await toggleBtn.click();
      await waitForOneNotification(page, '更新');
    }
    const resolveButton = firstAlert.getByTestId('nap-alert-resolve');
    if (await resolveButton.isVisible().catch(() => false)) {
      await resolveButton.click();
      await waitForOneNotification(page, '更新');
    }
  }

  await logout(page);
});

test('Phase3: manager/user can open rank tracker', async ({ page }) => {
  await ensureLoggedOut(page);
  await login(page, env.manager);
  await ensureStoreSelected(page);
  await openRankTracker(page);
  const managerReload = await pickFirstEnabled(page.locator('[data-testid="rank-runs-reload"], [data-testid="rank-dashboard-reload"]'));
  await managerReload.click();
  await logout(page);

  await login(page, env.user);
  await ensureStoreSelected(page);
  await openRankTracker(page);
  const userReload = await pickFirstEnabled(page.locator('[data-testid="rank-runs-reload"], [data-testid="rank-dashboard-reload"]'));
  await userReload.click();
  await logout(page);
});
