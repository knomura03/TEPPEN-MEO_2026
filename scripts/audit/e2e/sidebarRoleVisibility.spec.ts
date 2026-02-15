import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type AuditCreds = {
  email: string;
  password: string;
};

type AuditCredSet = {
  admin: AuditCreds;
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

const loadCreds = (env: Record<string, string>, emailKey: string, passwordKey: string): AuditCreds => ({
  email: requireEnv(env, emailKey),
  password: requireEnv(env, passwordKey),
});

const loadAuditCreds = (): AuditCredSet => {
  const envPath = path.join(process.cwd(), '.env.audit.local');
  if (!fs.existsSync(envPath)) {
    throw new Error('Missing .env.audit.local. Create it before running sidebar role audit.');
  }
  const env = loadDotEnvFileSync(envPath);
  return {
    admin: loadCreds(env, 'AUDIT_ADMIN_EMAIL', 'AUDIT_ADMIN_PASSWORD'),
    user: loadCreds(env, 'AUDIT_USER_EMAIL', 'AUDIT_USER_PASSWORD'),
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
  const dashboardNav = page.locator('#nav-DASHBOARD');
  const inviteStartButton = page.getByRole('button', { name: 'パスワードを設定して開始' });
  await page.waitForTimeout(1000);

  const loginError = page.getByText('Invalid login credentials');
  const demoUserButton = page.getByRole('button', { name: 'User' });
  if (await loginError.isVisible().catch(() => false)) {
    await demoUserButton.click();
    await page.waitForTimeout(500);
  }

  await Promise.race([
    dashboardNav.waitFor({ state: 'visible', timeout: 20_000 }),
    inviteStartButton.waitFor({ state: 'visible', timeout: 20_000 }),
  ]).catch(() => undefined);
  if (await inviteStartButton.isVisible().catch(() => false)) {
    const passwordInput = page.locator('input[placeholder="8文字以上"]').first();
    const passwordConfirmInput = page.locator('input[placeholder="確認用"]').first();
    await passwordInput.fill(creds.password);
    await passwordConfirmInput.fill(creds.password);
    await inviteStartButton.click();
    const passwordDiffError = page.getByText(/New password should be different from the old password/i);
    if (await passwordDiffError.isVisible().catch(() => false)) {
      const rotatedPassword = `${creds.password}!A1`;
      creds.password = rotatedPassword;
      await passwordInput.fill(rotatedPassword);
      await passwordConfirmInput.fill(rotatedPassword);
      await inviteStartButton.click();
    }
  }
  await expect(dashboardNav).toBeVisible();
};

const assertNavVisibility = async (page: Page, visibleNavIds: string[], hiddenNavIds: string[]) => {
  await page.goto('/?view=DASHBOARD', { waitUntil: 'domcontentloaded' });
  for (const navId of visibleNavIds) {
    await expect(page.locator(`#nav-${navId}`)).toBeVisible();
  }
  for (const navId of hiddenNavIds) {
    await expect(page.locator(`#nav-${navId}`)).toHaveCount(0);
  }
};

const cleanupUserByEmail = async (page: Page, email: string) => {
  await page.goto('/?view=USER_MANAGEMENT', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('user-filter-search').fill(email);
  const row = page.locator('tbody tr', { hasText: email }).first();
  if ((await row.count()) === 0) return;

  const fullDeleteButton = row.getByRole('button', { name: '完全削除' }).first();
  if (!(await fullDeleteButton.isVisible().catch(() => false))) return;

  const dialogHandler = async (dialog: { accept: () => Promise<void> }) => {
    await dialog.accept();
  };
  page.on('dialog', dialogHandler);
  try {
    await fullDeleteButton.click();
    await expect(row).toHaveCount(0, { timeout: 30_000 });
  } finally {
    page.off('dialog', dialogHandler);
  }
};

const createRoleUserByAdmin = async (page: Page, role: 'SUPERVISOR' | 'MANAGER', label: string): Promise<AuditCreds> => {
  const timestamp = Date.now();
  const rolePrefix = role === 'SUPERVISOR' ? 'supervisor' : 'manager';
  const passwordPrefix = role === 'SUPERVISOR' ? 'AuditSup!' : 'AuditMgr!';
  const user: AuditCreds = {
    email: `audit-${rolePrefix}-nav-${timestamp}@example.com`,
    password: `${passwordPrefix}${String(timestamp).slice(-6)}`,
  };

  await page.goto('/?view=USER_MANAGEMENT', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '新規ユーザー作成' }).click();
  await page.getByTestId('invite-name-input').fill(`[AUDIT] Sidebar ${label} ${timestamp}`);
  await page.getByTestId('invite-email-input').fill(user.email);
  await page.getByTestId('invite-role-select').selectOption(role);

  const existingGroupButton = page.getByRole('button', { name: '既存グループを選ぶ' });
  if (await existingGroupButton.isVisible().catch(() => false)) {
    await existingGroupButton.click();
  }
  const groupSelect = page.locator('label:has-text("グループ（必須）")').locator('xpath=following-sibling::select').first();
  await expect(groupSelect).toBeVisible();
  await expect.poll(async () => {
    return await groupSelect.locator('option').count();
  }, { timeout: 20_000 }).toBeGreaterThan(1);
  const groupOptionValue = await groupSelect.locator('option').nth(1).getAttribute('value');
  if (!groupOptionValue) {
    throw new Error('既存グループが取得できません。');
  }
  await groupSelect.selectOption(groupOptionValue);

  const existingStoreButton = page.getByRole('button', { name: '既存店舗を選ぶ' });
  if (await existingStoreButton.isVisible().catch(() => false)) {
    await existingStoreButton.click();
  }
  const storeSelect = page.locator('label:has-text("店舗（必須）")').locator('xpath=following-sibling::select').first();
  await expect(storeSelect).toBeVisible();
  await expect.poll(async () => {
    return await storeSelect.locator('option').count();
  }, { timeout: 20_000 }).toBeGreaterThan(1);
  const storeOptionValue = await storeSelect.locator('option').nth(1).getAttribute('value');
  if (!storeOptionValue) {
    throw new Error('既存店舗が取得できません。');
  }
  await storeSelect.selectOption(storeOptionValue);

  await page.locator('summary:has-text("詳細（監査用）")').click();
  await page.getByTestId('invite-password-input').fill(user.password);
  const inviteSubmitButton = page.getByRole('button', { name: '招待を送信' });
  await inviteSubmitButton.scrollIntoViewIfNeeded();
  await inviteSubmitButton.evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  await expect(page.getByText('ユーザーを作成しました。')).toBeVisible({ timeout: 20_000 });

  return user;
};

const creds = loadAuditCreds();

test('サイドバー権限: ADMIN', async ({ page }) => {
  await login(page, creds.admin);
  await assertNavVisibility(page, ['STORE_MANAGEMENT', 'GROUP_MANAGEMENT', 'MANAGEMENT_UNIT_MANAGEMENT'], []);
});

test('サイドバー権限: MANAGER', async ({ page, browser }) => {
  await login(page, creds.admin);
  let manager: AuditCreds | null = null;
  let managerContext: Awaited<ReturnType<typeof browser.newContext>> | null = null;
  try {
    manager = await createRoleUserByAdmin(page, 'MANAGER', 'MANAGER');
    managerContext = await browser.newContext({
      baseURL: process.env.AUDIT_BASE_URL || 'http://localhost:3000',
    });
    const managerPage = await managerContext.newPage();
    await login(managerPage, manager);
    await assertNavVisibility(managerPage, ['STORE_MANAGEMENT', 'GROUP_MANAGEMENT'], ['MANAGEMENT_UNIT_MANAGEMENT']);
  } finally {
    if (managerContext) {
      await managerContext.close();
    }
    if (manager) {
      await cleanupUserByEmail(page, manager.email);
    }
  }
});

test('サイドバー権限: USER', async ({ page }) => {
  await login(page, creds.user);
  await assertNavVisibility(page, [], ['STORE_MANAGEMENT', 'GROUP_MANAGEMENT', 'MANAGEMENT_UNIT_MANAGEMENT']);
});

test('サイドバー権限: SUPERVISOR', async ({ page, browser }) => {
  await login(page, creds.admin);
  let supervisor: AuditCreds | null = null;
  let supervisorContext: Awaited<ReturnType<typeof browser.newContext>> | null = null;
  try {
    supervisor = await createRoleUserByAdmin(page, 'SUPERVISOR', 'SUPERVISOR');
    supervisorContext = await browser.newContext({
      baseURL: process.env.AUDIT_BASE_URL || 'http://localhost:3000',
    });
    const supervisorPage = await supervisorContext.newPage();
    await login(supervisorPage, supervisor);
    await assertNavVisibility(supervisorPage, ['STORE_MANAGEMENT', 'GROUP_MANAGEMENT'], ['MANAGEMENT_UNIT_MANAGEMENT']);
  } finally {
    if (supervisorContext) {
      await supervisorContext.close();
    }
    if (supervisor) {
      await cleanupUserByEmail(page, supervisor.email);
    }
  }
});
