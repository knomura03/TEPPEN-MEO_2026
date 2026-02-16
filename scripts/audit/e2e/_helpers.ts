import fs from 'node:fs';
import path from 'node:path';

import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

export type AuditCreds = {
  email: string;
  password: string;
};

export type AuditEnv = {
  baseUrl: string;
  admin: AuditCreds;
  supervisor?: AuditCreds;
  manager?: AuditCreds;
  user?: AuditCreds;
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
  if (!value) throw new Error(`Missing required env in .env.audit.local: ${key}`);
  return value;
};

export const loadAuditEnv = (opts?: { requireSupervisor?: boolean; requireManager?: boolean; requireUser?: boolean }): AuditEnv => {
  const repoRoot = process.cwd();
  const envPath = path.join(repoRoot, '.env.audit.local');
  if (!fs.existsSync(envPath)) {
    throw new Error('Missing .env.audit.local. Create it with AUDIT_* credentials before running audit.');
  }
  const env = loadDotEnvFileSync(envPath);
  const baseUrl = process.env.AUDIT_BASE_URL || 'http://localhost:3000';

  const supervisor =
    env.AUDIT_SUPERVISOR_EMAIL && env.AUDIT_SUPERVISOR_PASSWORD
      ? { email: env.AUDIT_SUPERVISOR_EMAIL, password: env.AUDIT_SUPERVISOR_PASSWORD }
      : undefined;
  const manager =
    env.AUDIT_MANAGER_EMAIL && env.AUDIT_MANAGER_PASSWORD
      ? { email: env.AUDIT_MANAGER_EMAIL, password: env.AUDIT_MANAGER_PASSWORD }
      : undefined;
  const user =
    env.AUDIT_USER_EMAIL && env.AUDIT_USER_PASSWORD ? { email: env.AUDIT_USER_EMAIL, password: env.AUDIT_USER_PASSWORD } : undefined;

  if (opts?.requireSupervisor && !supervisor) throw new Error('Missing required env in .env.audit.local: AUDIT_SUPERVISOR_EMAIL/PASSWORD');
  if (opts?.requireManager && !manager) throw new Error('Missing required env in .env.audit.local: AUDIT_MANAGER_EMAIL/PASSWORD');
  if (opts?.requireUser && !user) throw new Error('Missing required env in .env.audit.local: AUDIT_USER_EMAIL/PASSWORD');

  return {
    baseUrl,
    admin: {
      email: requireEnv(env, 'AUDIT_ADMIN_EMAIL'),
      password: requireEnv(env, 'AUDIT_ADMIN_PASSWORD'),
    },
    supervisor,
    manager,
    user,
  };
};

export const getLoginEmailInput = (page: Page): Locator =>
  page
    .locator('[data-testid="login-email"], input[name="email"], input[type="email"], input[placeholder="you@example.com"]')
    .first();

export const getLoginPasswordInput = (page: Page): Locator =>
  page
    .locator('[data-testid="login-password"], input[name="password"], input[type="password"], input[placeholder="••••••••"]')
    .first();

export const getLoginSubmitButton = (page: Page): Locator =>
  page
    .locator('[data-testid="login-submit"], button[type="submit"], button:has-text("ログイン"), button:has-text("管理画面")')
    .first();

export const clickSidebarLogout = async (page: Page) => {
  const logoutButton = page.locator('#sidebar-logout-button');
  if (!(await logoutButton.isVisible().catch(() => false))) return false;

  page.once('dialog', async (dialog) => {
    if (dialog.type() === 'confirm') {
      await dialog.accept();
      return;
    }
    await dialog.dismiss();
  });
  await logoutButton.click();
  return true;
};

export const ensureLoginScreen = async (page: Page) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const loginEmail = getLoginEmailInput(page);
  if (await loginEmail.isVisible().catch(() => false)) return;

  if (await page.locator('#nav-DASHBOARD').isVisible().catch(() => false)) {
    const didClickLogout = await clickSidebarLogout(page);
    if (didClickLogout) {
      await page.goto('/login', { waitUntil: 'domcontentloaded' });
      if (await loginEmail.isVisible().catch(() => false)) return;
    }
  }

  const landingLogin = page.getByRole('button', { name: 'ログイン' }).first();
  if (await landingLogin.isVisible().catch(() => false)) {
    await landingLogin.click();
    if (await loginEmail.isVisible().catch(() => false)) return;
  }

  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await expect(loginEmail).toBeVisible();
};

export const installClipboardStub = async (page: Page) => {
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

export const readClipboardText = async (page: Page): Promise<string> =>
  page.evaluate(() => (window as unknown as { __auditCopiedText?: string }).__auditCopiedText || '');

export const loginAs = async (page: Page, creds: AuditCreds) => {
  await ensureLoginScreen(page);

  await getLoginEmailInput(page).fill(creds.email);
  await getLoginPasswordInput(page).fill(creds.password);
  await getLoginSubmitButton(page).click();

  await expect(page.locator('#nav-DASHBOARD')).toBeVisible();

  const tourClose = page.getByTestId('tour-close');
  if (await tourClose.isVisible().catch(() => false)) {
    await tourClose.click();
    await expect(tourClose).toHaveCount(0);
  }
};

export const gotoSidebarView = async (page: Page, view: string) => {
  const nav = page.locator(`#nav-${view}`).first();
  if (await nav.isVisible().catch(() => false)) {
    await nav.click();
  } else {
    await page.goto(`/?view=${view}`, { waitUntil: 'domcontentloaded' });
  }
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
};

export const openMultiSelectDialog = async (page: Page, buttonTestId: string) => {
  const openButton = page.getByTestId(buttonTestId);
  await openButton.click();
  const dialog = page.getByTestId(`${buttonTestId}-dialog`);
  await expect(dialog).toBeVisible();
  return dialog;
};

export const multiSelectSelectAll = async (dialog: Locator, buttonTestId: string) => {
  await dialog.getByTestId(`${buttonTestId}-select-all`).click();
};

export const multiSelectClear = async (dialog: Locator, buttonTestId: string) => {
  await dialog.getByTestId(`${buttonTestId}-clear`).click();
};

export const closeMultiSelectDialog = async (page: Page) => {
  await page.keyboard.press('Escape');
};

const clickOptionByIndex = async (dialog: Locator, index: number) => {
  const options = dialog.locator('[role="option"]');
  const count = await options.count();
  if (count === 0) {
    throw new Error('選択候補がありません。');
  }
  const safeIndex = Math.min(Math.max(index, 0), count - 1);
  await options.nth(safeIndex).click();
};

export const selectSingleStore = async (page: Page, index = 0) => {
  const storeSelectorId = 'header-store-selector';
  const dialog = await openMultiSelectDialog(page, storeSelectorId);
  await multiSelectClear(dialog, storeSelectorId);
  await closeMultiSelectDialog(page);
  await page.waitForTimeout(200);

  const multiBanner = page.getByTestId('multi-store-sns-disabled-banner');
  if (await multiBanner.isVisible().catch(() => false)) {
    const retryDialog = await openMultiSelectDialog(page, storeSelectorId);
    await multiSelectClear(retryDialog, storeSelectorId);
    await clickOptionByIndex(retryDialog, index);
    await closeMultiSelectDialog(page);
  }
};

export const selectMultipleStores = async (page: Page, count = 2) => {
  const storeSelectorId = 'header-store-selector';
  const dialog = await openMultiSelectDialog(page, storeSelectorId);
  await multiSelectClear(dialog, storeSelectorId);
  const options = dialog.locator('[role="option"]');
  const optionCount = await options.count();
  if (optionCount < count) {
    throw new Error(`複数店舗選択に必要な店舗数が不足しています。required=${count}, actual=${optionCount}`);
  }
  for (let index = 0; index < count; index += 1) {
    await options.nth(index).click();
  }
  await closeMultiSelectDialog(page);
};

export const ensureAtLeastTwoStores = async (page: Page) => {
  const storeButtonTestId = 'header-store-selector';
  const dialog = await openMultiSelectDialog(page, storeButtonTestId);
  const optionButtons = dialog.locator('[role="option"]');
  const optionCount = await optionButtons.count();
  await closeMultiSelectDialog(page);
  if (optionCount >= 2) return;

  await gotoSidebarView(page, 'STORE_MANAGEMENT');

  const nameInput = page.getByPlaceholder('新規店舗名');
  await expect(nameInput).toBeVisible();
  await nameInput.fill(`[AUDIT] multi-store ${Date.now()}`);
  await page.getByRole('button', { name: '店舗を追加' }).click();

  await expect(page.getByText('作成完了')).toBeVisible({ timeout: 30_000 });
  await gotoSidebarView(page, 'DASHBOARD');
};

export const navigateToUserManagement = async (page: Page) => {
  const nav = page.locator('#nav-USER_MANAGEMENT');
  if (await nav.isVisible().catch(() => false)) {
    await nav.click();
  } else {
    await page.goto('/?view=USER_MANAGEMENT', { waitUntil: 'domcontentloaded' });
  }
  await expect(page.getByRole('heading', { name: 'ユーザー管理' }).first()).toBeVisible();
};

export const createInviteLinkFromUserManagement = async (page: Page, params: { email: string; name: string; role: string }) => {
  const inviteNameInput = page.getByTestId('invite-name-input');
  if (!(await inviteNameInput.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: '新規ユーザー作成' }).click();
  }
  await page.getByTestId('invite-name-input').fill(params.name);
  await page.getByTestId('invite-email-input').fill(params.email);
  await page.getByTestId('invite-role-select').selectOption(params.role);

  const groupSelect = page.locator('div:has(> label:has-text("グループ（必須）")) select').first();
  if (await groupSelect.isVisible().catch(() => false)) {
    const groupValue = await groupSelect.locator('option').nth(1).getAttribute('value');
    if (groupValue) await groupSelect.selectOption(groupValue);
  }

  const storeSelect = page.locator('div:has(> label:has-text("店舗（必須）")) select').first();
  if (await storeSelect.isVisible().catch(() => false)) {
    const storeValue = await storeSelect.locator('option').nth(1).getAttribute('value');
    if (storeValue) await storeSelect.selectOption(storeValue);
  }

  await page.getByTestId('invite-copy-link-button').click();
  await expect(page.getByText(/URLをクリップボードにコピーしました。|招待URLをクリップボードにコピーしました。/).first()).toBeVisible({
    timeout: 20_000,
  });

  const actionLink = await readClipboardText(page);
  expect(actionLink).toContain('/auth/v1/verify');
  const cancelButton = page.getByRole('button', { name: 'キャンセル' }).first();
  if (await cancelButton.isVisible().catch(() => false)) {
    await cancelButton.click();
  }
  return actionLink;
};
