import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';

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
    throw new Error('Missing .env.audit.local. Create it before running invite onboarding audit.');
  }
  const env = loadDotEnvFileSync(envPath);
  return {
    email: requireEnv(env, 'AUDIT_ADMIN_EMAIL'),
    password: requireEnv(env, 'AUDIT_ADMIN_PASSWORD'),
  };
};

const installClipboardStub = async (page: Page) => {
  await page.addInitScript(() => {
    localStorage.setItem('hasSeenTour', 'true');
    (window as unknown as { __auditCopiedText?: string }).__auditCopiedText = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as unknown as { __auditCopiedText?: string }).__auditCopiedText = value;
        },
        readText: async () => (window as unknown as { __auditCopiedText?: string }).__auditCopiedText || '',
      },
    });
  });
};

const getLoginEmailInput = (page: Page) =>
  page
    .locator(
      '[data-testid="login-email"], input[name="email"], input[type="email"], input[placeholder="you@example.com"]'
    )
    .first();

const getLoginPasswordInput = (page: Page) =>
  page
    .locator(
      '[data-testid="login-password"], input[name="password"], input[type="password"], input[placeholder="••••••••"]'
    )
    .first();

const getLoginSubmitButton = (page: Page) =>
  page
    .locator(
      '[data-testid="login-submit"], button[type="submit"], button:has-text("ログイン"), button:has-text("管理画面")'
    )
    .first();

const ensureLoginScreen = async (page: Page) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const loginEmail = getLoginEmailInput(page);
  if (await loginEmail.isVisible().catch(() => false)) return;

  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await expect(loginEmail).toBeVisible();
};

const login = async (page: Page, creds: AuditCreds) => {
  await ensureLoginScreen(page);
  await getLoginEmailInput(page).fill(creds.email);
  await getLoginPasswordInput(page).fill(creds.password);
  await getLoginSubmitButton(page).click();
  await expect(page.locator('#nav-DASHBOARD')).toBeVisible();
};

const navigateToUserManagement = async (page: Page) => {
  const nav = page.locator('#nav-USER_MANAGEMENT');
  if (await nav.isVisible().catch(() => false)) {
    await nav.click();
  } else {
    await page.goto('/?view=USER_MANAGEMENT', { waitUntil: 'domcontentloaded' });
  }
  await expect(page.getByRole('heading', { name: 'ユーザー管理' }).first()).toBeVisible();
};

const createInviteLink = async (page: Page, email: string, name: string): Promise<string> => {
  await page.getByRole('button', { name: '新規ユーザー作成' }).click();
  await page.getByTestId('invite-name-input').fill(name);
  await page.getByTestId('invite-email-input').fill(email);
  await page.getByTestId('invite-role-select').selectOption('USER');
  const groupSelect = page.locator('label:has-text("グループ（必須）")').locator('xpath=following-sibling::select').first();
  if (await groupSelect.count()) {
    const options = await groupSelect.locator('option').allTextContents();
    if (options.length > 1) {
      const value = await groupSelect.locator('option').nth(1).getAttribute('value');
      if (value) {
        await groupSelect.selectOption(value);
      }
    }
  }

  const storeSelect = page.locator('label:has-text("店舗（必須）")').locator('xpath=following-sibling::select').first();
  if (await storeSelect.count()) {
    const storeValue = await storeSelect.locator('option').nth(1).getAttribute('value');
    if (storeValue) {
      await storeSelect.selectOption(storeValue);
    }
  }

  await page.getByTestId('invite-copy-link-button').click();
  await expect(
    page.getByText(/URLをクリップボードにコピーしました。|既存ユーザー向けのURLをクリップボードにコピーしました。/).first()
  ).toBeVisible({ timeout: 20_000 });

  const actionLink = await page.evaluate(() => (window as unknown as { __auditCopiedText?: string }).__auditCopiedText || '');
  expect(actionLink).toContain('/auth/v1/verify');
  return actionLink;
};

const adminCreds = loadAdminCreds();

test('招待URLアクセス時は初回パスワード設定が必須になる', async ({ browser }) => {
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await installClipboardStub(adminPage);
  await login(adminPage, adminCreds);
  await navigateToUserManagement(adminPage);

  const auditId = `invite-onboarding-${Date.now()}`;
  const inviteEmail = `${auditId}@example.com`;
  const inviteName = `[AUDIT] ${auditId}`;
  const inviteLink = await createInviteLink(adminPage, inviteEmail, inviteName);
  await adminContext.close();

  const invitedContext = await browser.newContext();
  const invitedPage = await invitedContext.newPage();
  await invitedPage.goto(inviteLink, { waitUntil: 'domcontentloaded' });
  await expect(invitedPage).toHaveURL(/\/invite/);
  await expect(invitedPage.getByTestId('invite-password-input')).toBeVisible({ timeout: 30_000 });
  await expect(invitedPage.locator('#nav-DASHBOARD')).toHaveCount(0);

  const password = `Teppen!${Date.now()}Aa`;
  await invitedPage.getByTestId('invite-password-input').fill(password);
  await invitedPage.getByTestId('invite-password-confirm-input').fill(password);
  await invitedPage.getByTestId('invite-password-submit').click();

  await expect(invitedPage.locator('#nav-DASHBOARD')).toBeVisible({ timeout: 45_000 });
  await invitedContext.close();
});
