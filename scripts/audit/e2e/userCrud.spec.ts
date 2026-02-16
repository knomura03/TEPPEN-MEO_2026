import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';

type AuditCreds = {
  email: string;
  password: string;
};

type AuditEnv = {
  baseUrl: string;
  admin: AuditCreds;
  supervisor: AuditCreds;
  manager: AuditCreds;
  user: AuditCreds;
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

const loadAuditEnv = (): AuditEnv => {
  const repoRoot = process.cwd();
  const envPath = path.join(repoRoot, '.env.audit.local');
  if (!fs.existsSync(envPath)) {
    throw new Error('Missing .env.audit.local. Create it before running user CRUD audit.');
  }
  const env = loadDotEnvFileSync(envPath);
  const manager = {
    email: requireEnv(env, 'AUDIT_MANAGER_EMAIL'),
    password: requireEnv(env, 'AUDIT_MANAGER_PASSWORD'),
  };
  const supervisorEmail = env.AUDIT_SUPERVISOR_EMAIL || manager.email;
  const supervisorPassword = env.AUDIT_SUPERVISOR_PASSWORD || manager.password;

  return {
    baseUrl: process.env.AUDIT_BASE_URL || env.AUDIT_BASE_URL || 'http://localhost:3000',
    admin: {
      email: requireEnv(env, 'AUDIT_ADMIN_EMAIL'),
      password: requireEnv(env, 'AUDIT_ADMIN_PASSWORD'),
    },
    supervisor: {
      email: supervisorEmail,
      password: supervisorPassword,
    },
    manager,
    user: {
      email: requireEnv(env, 'AUDIT_USER_EMAIL'),
      password: requireEnv(env, 'AUDIT_USER_PASSWORD'),
    },
  };
};

const env = loadAuditEnv();
const runId = `USER_AUDIT_${new Date().toISOString().replace(/[:.]/g, '-')}`;

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

const navigateToUserManagement = async (page: Page): Promise<boolean> => {
  const nav = page.locator('#nav-USER_MANAGEMENT');
  if (await nav.isVisible().catch(() => false)) {
    await nav.click();
  } else {
    await page.goto('/?view=USER_MANAGEMENT', { waitUntil: 'domcontentloaded' });
  }
  const heading = page.locator('h1').filter({ hasText: 'ユーザー管理' }).first();
  if (await heading.isVisible().catch(() => false)) {
    return true;
  }
  const accessDenied = page.getByText('アクセス権限がありません。').first();
  if (await accessDenied.isVisible().catch(() => false)) {
    return false;
  }
  return false;
};

const createUserByInviteLink = async (page: Page, params: { name: string; email: string; role?: 'USER' | 'MANAGER' }) => {
  await page.getByRole('button', { name: '新規ユーザー作成' }).click();
  await page.getByTestId('invite-name-input').fill(params.name);
  await page.getByTestId('invite-email-input').fill(params.email);
  if (params.role) {
    await page.getByTestId('invite-role-select').selectOption(params.role);
  }

  const groupSelect = page.locator('label:has-text("グループ（必須）")').locator('xpath=following-sibling::select').first();
  if (await groupSelect.count()) {
    const groupValue = await groupSelect.locator('option').nth(1).getAttribute('value');
    if (groupValue) {
      await groupSelect.selectOption(groupValue);
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
    page.getByText(/URLをクリップボードにコピーしました。/).first()
  ).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'キャンセル' }).click();
  await expect(page.getByTestId('invite-name-input')).toHaveCount(0);
  await page.waitForTimeout(800);
};

const findUserRowByEmail = (page: Page, email: string) =>
  page.locator('tbody tr').filter({ hasText: email }).first();

test.describe('ユーザーCRUD監査', () => {
  test('ADMIN/SUPERVISOR/MANAGER/USERの運用権限が期待どおり', async ({ browser }) => {
    const runAs = async (creds: AuditCreds, callback: (page: Page) => Promise<void>) => {
      const context = await browser.newContext({ baseURL: env.baseUrl });
      const scopedPage = await context.newPage();
      await installClipboardStub(scopedPage);
      await login(scopedPage, creds);
      await callback(scopedPage);
      await context.close();
    };

    await runAs(env.admin, async (scopedPage) => {
      const canAccess = await navigateToUserManagement(scopedPage);
      expect(canAccess).toBe(true);
      await expect(scopedPage.getByRole('button', { name: '新規ユーザー作成' })).toBeVisible();
      await expect(scopedPage.locator('tbody tr').filter({ hasText: '@' }).first()).toBeVisible();

      const emailForRemove = `audit.usercrud.remove.${Date.now()}@example.com`;
      const nameForRemove = `[AUDIT] ${runId} remove`;
      await createUserByInviteLink(scopedPage, {
        name: nameForRemove,
        email: emailForRemove,
        role: 'USER',
      });
      await scopedPage.getByTestId('user-filter-search').fill(emailForRemove);
      const removeTargetRow = findUserRowByEmail(scopedPage, emailForRemove);
      await expect(removeTargetRow).toBeVisible({ timeout: 20_000 });
      await removeTargetRow.getByRole('button', { name: '編集' }).click();
      await scopedPage.getByTestId('user-edit-name-input').fill(`${nameForRemove} updated`);
      await scopedPage.getByTestId('user-edit-save-button').click();
      await expect(removeTargetRow).toContainText('updated', { timeout: 20_000 });

      scopedPage.once('dialog', (dialog) => void dialog.accept());
      await removeTargetRow.locator('button[title="組織から外す"]').click();
      await expect(findUserRowByEmail(scopedPage, emailForRemove)).toHaveCount(0, { timeout: 20_000 });

      await scopedPage.getByTestId('user-filter-search').fill('');
      const nameForFullDelete = `[AUDIT] ${runId} reused`;
      await createUserByInviteLink(scopedPage, {
        name: nameForFullDelete,
        email: emailForRemove,
        role: 'USER',
      });
      await scopedPage.getByTestId('user-filter-search').fill(emailForRemove);
      const fullDeleteTargetRow = findUserRowByEmail(scopedPage, emailForRemove);
      await expect(fullDeleteTargetRow).toBeVisible({ timeout: 20_000 });
      await expect(fullDeleteTargetRow.getByRole('button', { name: '完全削除' })).toBeVisible();
      scopedPage.on('dialog', (dialog) => void dialog.accept());
      await fullDeleteTargetRow.getByRole('button', { name: '完全削除' }).click();
      await expect(findUserRowByEmail(scopedPage, emailForRemove)).toHaveCount(0, { timeout: 30_000 });
    });

    await runAs(env.supervisor, async (scopedPage) => {
      const canAccess = await navigateToUserManagement(scopedPage);
      if (!canAccess) {
        await expect(scopedPage.getByText('アクセス権限がありません。')).toBeVisible();
        return;
      }
      await scopedPage.getByRole('button', { name: '新規ユーザー作成' }).click();
      await expect(scopedPage.locator('option[value="ADMIN"]')).toHaveCount(0);
      await expect(scopedPage.locator('option[value="SUPERVISOR"]')).toHaveCount(0);
      await expect(scopedPage.locator('option[value="MANAGER"]')).toHaveCount(1);
      await expect(scopedPage.locator('option[value="USER"]')).toHaveCount(1);
      await scopedPage.keyboard.press('Escape');
      await expect(scopedPage.getByRole('button', { name: '完全削除' })).toHaveCount(0);
    });

    await runAs(env.manager, async (scopedPage) => {
      const canAccess = await navigateToUserManagement(scopedPage);
      if (!canAccess) {
        await expect(scopedPage.getByText('アクセス権限がありません。')).toBeVisible();
        return;
      }
      await scopedPage.getByRole('button', { name: '新規ユーザー作成' }).click();
      await expect(scopedPage.locator('option[value="ADMIN"]')).toHaveCount(0);
      await expect(scopedPage.locator('option[value="SUPERVISOR"]')).toHaveCount(0);
      await expect(scopedPage.locator('option[value="MANAGER"]')).toHaveCount(0);
      await expect(scopedPage.locator('option[value="USER"]')).toHaveCount(1);
      await scopedPage.keyboard.press('Escape');
      await expect(scopedPage.getByRole('button', { name: '完全削除' })).toHaveCount(0);
    });

    await runAs(env.user, async (scopedPage) => {
      await expect(scopedPage.locator('#nav-USER_MANAGEMENT')).toHaveCount(0);
    });
  });
});
