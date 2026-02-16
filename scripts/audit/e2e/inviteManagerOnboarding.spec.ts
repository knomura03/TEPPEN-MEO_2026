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
    throw new Error('Missing .env.audit.local. Create it before running manager invite onboarding audit.');
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

const createManagerInviteLink = async (page: Page, email: string, name: string): Promise<string> => {
  await page.locator('#nav-USER_MANAGEMENT').click();
  await expect(page.getByRole('heading', { name: 'ユーザー管理' }).first()).toBeVisible();
  await page.getByRole('button', { name: '新規ユーザー作成' }).click();
  await page.getByTestId('invite-name-input').fill(name);
  await page.getByTestId('invite-email-input').fill(email);
  await page.getByTestId('invite-role-select').selectOption('MANAGER');

  const planSelect = page
    .locator('label:has-text("契約プラン")')
    .locator('xpath=following-sibling::select')
    .first();
  if (await planSelect.count()) {
    const currentValue = await planSelect.inputValue();
    if (!currentValue) {
      const options = await planSelect.locator('option').evaluateAll((nodes) =>
        nodes.map((node) => ({ value: (node as HTMLOptionElement).value || '' }))
      );
      const firstUsable = options.find((option) => option.value && option.value.trim().length > 0);
      if (firstUsable?.value) {
        await planSelect.selectOption(firstUsable.value);
      }
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

test('MANAGER招待でも初回パスワード設定が必須になる', async ({ browser }) => {
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await installClipboardStub(adminPage);
  await login(adminPage, adminCreds);

  const auditId = `invite-manager-${Date.now()}`;
  const inviteLink = await createManagerInviteLink(
    adminPage,
    `${auditId}@example.com`,
    `[AUDIT] ${auditId}`
  );
  await adminContext.close();

  const managerContext = await browser.newContext();
  const managerPage = await managerContext.newPage();
  await managerPage.goto(inviteLink, { waitUntil: 'domcontentloaded' });

  await expect(managerPage).toHaveURL(/\/invite/);
  await expect(managerPage.getByTestId('invite-password-input')).toBeVisible({ timeout: 30_000 });
  await expect(managerPage.locator('#nav-DASHBOARD')).toHaveCount(0);

  const password = `Teppen!${Date.now()}Aa`;
  await managerPage.getByTestId('invite-password-input').fill(password);
  await managerPage.getByTestId('invite-password-confirm-input').fill(password);
  await managerPage.getByTestId('invite-password-submit').click();

  await expect(managerPage.locator('#nav-DASHBOARD')).toBeVisible({ timeout: 45_000 });
  await expect(managerPage.locator('#nav-USER_MANAGEMENT')).toBeVisible();

  await managerContext.close();
});
