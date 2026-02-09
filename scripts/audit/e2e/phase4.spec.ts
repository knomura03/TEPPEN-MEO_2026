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
  const selectorByTestId = page.getByTestId('store-selector');
  const selectorByHeader = page.getByRole('banner').getByRole('combobox').first();

  await Promise.race([
    selectorByTestId.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {}),
    selectorByHeader.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {}),
  ]);

  const selector = (await selectorByTestId.isVisible().catch(() => false))
    ? selectorByTestId
    : (await selectorByHeader.isVisible().catch(() => false))
      ? selectorByHeader
      : null;

  if (!selector) {
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

const openBillingView = async (page: Page) => {
  const billingEntry = await findVisibleBillingEntry(page);
  expect(billingEntry, '課金/請求の導線が見つかりません。Phase4のUI未実装の可能性があります。').not.toBeNull();
  if (!billingEntry) return;
  await billingEntry.click();
  await expect(page.getByTestId('billing-view-root')).toBeVisible();
};

const waitForToastText = async (page: Page, text: string, timeoutMs = 15_000) => {
  const toast = page.getByText(text).last();
  await expect(toast).toBeVisible({ timeout: timeoutMs });
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

  await openBillingView(page);

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

test('Phase4: plan create -> org assign -> invite user', async ({ page }) => {
  test.setTimeout(4 * 60 * 1000);

  await ensureLoggedOut(page);
  await login(page, env.admin);
  await ensureStoreSelected(page);
  await openBillingView(page);

  const token = new Date().toISOString().replace(/[^0-9]/g, '').slice(-10);
  const planCode = `AUDIT${token}`;
  const inviteEmail = `audit+${token}@example.com`;

  const planEditor = page.locator('div').filter({ has: page.getByText('プラン作成/更新') }).first();
  await planEditor.locator('input[placeholder="例: FREE"]').fill(planCode);
  await planEditor.locator('input[placeholder="例: Free"]').fill(`[AUDIT] ${planCode}`);
  await planEditor.locator('input[type="number"]').fill('1200');
  await planEditor.locator('input[placeholder="説明（任意）"]').fill(`audit plan ${token}`);
  await planEditor.getByRole('button', { name: '保存' }).click();
  await waitForToastText(page, '保存完了');

  const assignPanel = page
    .locator('h5')
    .filter({ hasText: 'ORGへのプラン割当' })
    .first()
    .locator('xpath=ancestor::div[contains(@class,"border")][1]');
  await expect(assignPanel).toBeVisible();
  await assignPanel.locator('select').first().selectOption(planCode);
  await assignPanel.getByRole('button', { name: 'このORGに割当' }).click();
  await waitForToastText(page, '更新完了');

  const userMgmtEntry =
    (await page.locator('#nav-USER_MANAGEMENT').isVisible().catch(() => false))
      ? page.locator('#nav-USER_MANAGEMENT')
      : page.getByText('ユーザー・契約管理').first();
  await userMgmtEntry.click();

  await page.getByRole('button', { name: '新規ユーザー作成' }).click();
  const inviteModal = page.locator('div').filter({ has: page.getByText('新規ユーザー作成（招待）') }).first();
  await expect(inviteModal).toBeVisible();

  await inviteModal.locator('label:has-text("名前") + input').fill(`[AUDIT] USER ${token}`);
  await inviteModal.getByTestId('invite-email-input').fill(inviteEmail);
  await inviteModal.getByTestId('invite-password-input').fill('AuditPass!234');
  await inviteModal.locator('label:has-text("権限ロール") + select').selectOption('USER');

  const planCodeSelect = inviteModal.locator('label:has-text("契約プラン（planCode）") + select');
  if (await planCodeSelect.isVisible().catch(() => false)) {
    await planCodeSelect.selectOption(planCode);
  }

  const inviteResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/functions/v1/admin-create-user') && response.request().method() === 'POST',
    { timeout: 180_000 }
  );
  await inviteModal.getByRole('button', { name: '招待を送信' }).click();

  const inviteResponse = await inviteResponsePromise;
  const inviteResponseBody = await inviteResponse.text();
  expect(
    inviteResponse.ok(),
    `admin-create-user failed: status=${inviteResponse.status()} body=${inviteResponseBody}`
  ).toBeTruthy();

  await expect(page.getByText(inviteEmail).first()).toBeVisible({ timeout: 60_000 });
  await waitForToastText(page, '招待完了', 60_000);
});
