import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  createInviteLinkFromUserManagement,
  installClipboardStub,
  loadAuditEnv,
  loginAs,
  navigateToUserManagement,
  selectSingleStore,
} from './_helpers';

const env = loadAuditEnv({ requireManager: true, requireUser: true });
const runId = `USER-CRUD-${Date.now()}`;

const expectRoleOptions = async (page: Page, expectedRoles: string[]) => {
  const roleSelect = page.getByTestId('invite-role-select');
  const options = await roleSelect.locator('option').allTextContents();
  for (const role of expectedRoles) {
    const hasRole = options.some((label) => label.trim() === role || label.includes(`${role}（`) || label.startsWith(`${role} `));
    expect(hasRole).toBeTruthy();
  }
};

test.beforeEach(async ({ page }) => {
  await installClipboardStub(page);
});

test('ユーザーCRUDの権限制御がロールごとに成立する', async ({ browser }) => {
  const adminContext = await browser.newContext({ baseURL: env.baseUrl });
  const adminPage = await adminContext.newPage();
  await installClipboardStub(adminPage);
  await loginAs(adminPage, env.admin);
  await selectSingleStore(adminPage);
  await navigateToUserManagement(adminPage);

  await adminPage.getByRole('button', { name: '新規ユーザー作成' }).click();
  await expectRoleOptions(adminPage, ['ADMIN', 'SUPERVISOR', 'MANAGER', 'USER']);
  await adminPage.getByRole('button', { name: 'キャンセル' }).click();

  const targetEmail = `audit.usercrud.${Date.now()}@example.com`;
  await createInviteLinkFromUserManagement(adminPage, {
    name: `[AUDIT] ${runId}`,
    email: targetEmail,
    role: 'USER',
  });
  await adminPage.getByTestId('user-filter-search').fill(targetEmail);
  const targetRow = adminPage.locator('tbody tr').filter({ hasText: targetEmail }).first();
  await expect(targetRow).toBeVisible({ timeout: 20_000 });

  await expect(targetRow.locator('[data-testid^="user-remove-"]').first()).toBeVisible();
  await adminContext.close();

  if (env.supervisor) {
    const supervisorContext = await browser.newContext({ baseURL: env.baseUrl });
    const supervisorPage = await supervisorContext.newPage();
    await installClipboardStub(supervisorPage);
    await loginAs(supervisorPage, env.supervisor);
    await selectSingleStore(supervisorPage);
    await navigateToUserManagement(supervisorPage);
    await supervisorPage.getByRole('button', { name: '新規ユーザー作成' }).click();
    const supervisorRoleSelect = supervisorPage.getByTestId('invite-role-select');
    await expectRoleOptions(supervisorPage, ['MANAGER', 'USER']);
    await expect(supervisorRoleSelect.locator('option[value="ADMIN"]')).toHaveCount(0);
    await expect(supervisorRoleSelect.locator('option[value="SUPERVISOR"]')).toHaveCount(0);
    await supervisorPage.getByRole('button', { name: 'キャンセル' }).click();
    await expect(supervisorPage.getByRole('button', { name: '完全削除' })).toHaveCount(0);
    await supervisorContext.close();
  }

  const managerContext = await browser.newContext({ baseURL: env.baseUrl });
  const managerPage = await managerContext.newPage();
  await installClipboardStub(managerPage);
  await loginAs(managerPage, env.manager!);
  await selectSingleStore(managerPage);
  await navigateToUserManagement(managerPage);
  await managerPage.getByRole('button', { name: '新規ユーザー作成' }).click();
  const managerRoleSelect = managerPage.getByTestId('invite-role-select');
  await expect(managerRoleSelect.locator('option[value="USER"]')).toHaveCount(1);
  await expect(managerRoleSelect.locator('option[value="ADMIN"]')).toHaveCount(0);
  await expect(managerRoleSelect.locator('option[value="SUPERVISOR"]')).toHaveCount(0);
  await expect(managerRoleSelect.locator('option[value="MANAGER"]')).toHaveCount(0);
  await managerPage.getByRole('button', { name: 'キャンセル' }).click();
  await expect(managerPage.getByRole('button', { name: '完全削除' })).toHaveCount(0);
  await managerContext.close();

  const userContext = await browser.newContext({ baseURL: env.baseUrl });
  const userPage = await userContext.newPage();
  await installClipboardStub(userPage);
  await loginAs(userPage, env.user!);
  await expect(userPage.locator('#nav-USER_MANAGEMENT')).toHaveCount(0);
  await userContext.close();
});
