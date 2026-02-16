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
    throw new Error('Missing .env.audit.local. Create it before running store bootstrap audit.');
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

const createInviteLinkWithoutStore = async (page: Page, email: string, name: string): Promise<string> => {
  await page.locator('#nav-USER_MANAGEMENT').click();
  await expect(page.getByRole('heading', { name: 'ユーザー管理' }).first()).toBeVisible();
  await page.getByRole('button', { name: '新規ユーザー作成' }).click();
  await page.getByTestId('invite-name-input').fill(name);
  await page.getByTestId('invite-email-input').fill(email);
  await page.getByTestId('invite-role-select').selectOption('USER');

  const initialStoreSelect = page
    .locator('label:has-text("初期店舗（任意）")')
    .locator('xpath=following-sibling::select')
    .first();
  if (await initialStoreSelect.count()) {
    await initialStoreSelect.selectOption('');
  }

  await page.getByTestId('invite-copy-link-button').click();
  await expect(
    page.getByText(/URLをクリップボードにコピーしました。|既存ユーザー向けのURLをクリップボードにコピーしました。/).first()
  ).toBeVisible({ timeout: 20_000 });
  const actionLink = await page.evaluate(() => (window as unknown as { __auditCopiedText?: string }).__auditCopiedText || '');
  expect(actionLink).toContain('/auth/v1/verify');
  return actionLink;
};

const completeInvitePasswordSetup = async (page: Page, inviteLink: string): Promise<void> => {
  await page.goto(inviteLink, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/invite/);
  await expect(page.getByTestId('invite-password-input')).toBeVisible({ timeout: 30_000 });
  const password = `Teppen!${Date.now()}Aa`;
  await page.getByTestId('invite-password-input').fill(password);
  await page.getByTestId('invite-password-confirm-input').fill(password);
  await page.getByTestId('invite-password-submit').click();
  await expect(page.locator('#nav-DASHBOARD')).toBeVisible({ timeout: 45_000 });
};

const adminCreds = loadAdminCreds();

test('店舗未設定USERでも設定画面から店舗作成できる', async ({ browser }) => {
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await installClipboardStub(adminPage);
  await login(adminPage, adminCreds);

  const runId = `store-bootstrap-${Date.now()}`;
  const inviteEmail = `${runId}@example.com`;
  const inviteLink = await createInviteLinkWithoutStore(adminPage, inviteEmail, `[AUDIT] ${runId}`);
  await adminContext.close();

  const userContext = await browser.newContext();
  const userPage = await userContext.newPage();
  await userPage.addInitScript(() => {
    localStorage.setItem('hasSeenTour', 'true');
  });
  await completeInvitePasswordSetup(userPage, inviteLink);

  await userPage.getByTestId('open-settings').click();
  await expect(userPage.getByRole('heading', { name: '設定' }).first()).toBeVisible();
  await userPage.getByTestId('settings-tab-store').click();

  await userPage.getByTestId('store-name-input').fill(`[AUDIT] ${runId} store`);
  await userPage.getByTestId('store-address-input').fill('東京都豊島区北大塚1-21-9');
  await userPage.getByTestId('store-phone-input').fill('03-1234-5678');
  await userPage.getByTestId('store-category-input').fill('テスト業種');
  await userPage.getByTestId('store-business-hours-input').fill('月-金 10:00-19:00');
  await userPage.getByTestId('store-save-button').click();

  await expect(userPage.locator('text=店舗作成エラー')).toHaveCount(0);
  await expect(userPage.locator('text=42702')).toHaveCount(0);
  await expect(userPage.locator('text=店舗作成完了')).toBeVisible({ timeout: 30_000 });

  const storeSelector = userPage.getByTestId('store-selector');
  await expect(storeSelector).toBeVisible({ timeout: 30_000 });
  await expect(storeSelector).not.toHaveValue('', { timeout: 30_000 });

  await userContext.close();
});
