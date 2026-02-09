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
  };
};

const env = loadAuditEnv();

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

const findVisibleBillingEntry = async (page: Page): Promise<Locator | null> => {
  const candidates: Locator[] = [
    page.locator('#nav-BILLING'),
    page.getByTestId('settings-tab-billing'),
    page.getByRole('button', { name: /課金|請求|Billing|Subscription/i }).first(),
    page.getByRole('link', { name: /課金|請求|Billing|Subscription/i }).first(),
  ];
  for (const candidate of candidates) {
    if (await candidate.isVisible().catch(() => false)) {
      return candidate;
    }
  }
  return null;
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('hasSeenTour', 'true');
  });
});

test('Phase4: billing + pwa surface is available', async ({ page }) => {
  await ensureLoggedOut(page);
  await login(page, env.admin);
  await ensureStoreSelected(page);

  const billingEntry = await findVisibleBillingEntry(page);
  expect(billingEntry, '課金/請求の導線が見つかりません。Phase4のUI未実装の可能性があります。').not.toBeNull();
  if (!billingEntry) return;
  await billingEntry.click();

  const billingPanelCandidates = [
    page.getByTestId('billing-plan-current'),
    page.getByTestId('billing-upgrade'),
    page.getByTestId('invoice-download'),
    page.getByText(/現在のプラン|請求履歴|サブスクリプション/i),
  ];
  const visibleBillingPanel = await Promise.any(
    billingPanelCandidates.map(async (locator) => {
      await expect(locator).toBeVisible({ timeout: 10_000 });
      return true;
    })
  ).catch(() => false);
  expect(visibleBillingPanel, '課金/請求画面の主要要素が見つかりません。').toBeTruthy();

  const manifestHref = await page.locator('link[rel="manifest"]').first().getAttribute('href');
  expect(manifestHref, 'PWA manifest が見つかりません。').toBeTruthy();

  const swReady = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration);
  });
  expect(swReady, 'service worker registration が見つかりません。').toBeTruthy();

  const pwaInstallButton = page.getByTestId('pwa-install-button');
  const pwaInstallText = page.getByText(/ホーム画面に追加|アプリをインストール|Install App/i).first();
  const hasInstallCta =
    (await pwaInstallButton.isVisible().catch(() => false)) ||
    (await pwaInstallText.isVisible().catch(() => false));
  expect(hasInstallCta, 'PWAインストール導線が見つかりません。').toBeTruthy();
});
