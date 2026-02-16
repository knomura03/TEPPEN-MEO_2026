import { expect, test } from '@playwright/test';

import {
  closeMultiSelectDialog,
  createInviteLinkFromUserManagement,
  installClipboardStub,
  loadAuditEnv,
  loginAs,
  multiSelectClear,
  multiSelectSelectAll,
  navigateToUserManagement,
  openMultiSelectDialog,
} from './_helpers';

const env = loadAuditEnv();

test.describe('Store Management', () => {
  test('USER: 自分の店舗を閲覧/更新できる（複数店舗時は編集不可）', async ({ browser }) => {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await installClipboardStub(adminPage);
    await loginAs(adminPage, env.admin);
    await navigateToUserManagement(adminPage);

    const auditId = `store-mgmt-user-${Date.now()}`;
    const inviteEmail = `${auditId}@example.com`;
    const inviteName = `[AUDIT] ${auditId}`;
    const inviteLink = await createInviteLinkFromUserManagement(adminPage, {
      email: inviteEmail,
      name: inviteName,
      role: 'USER',
    });
    await adminContext.close();

    const invitedContext = await browser.newContext();
    const invitedPage = await invitedContext.newPage();
    await invitedPage.goto(inviteLink, { waitUntil: 'domcontentloaded' });
    await expect(invitedPage).toHaveURL(/\/invite/);
    await expect(invitedPage.getByTestId('invite-password-input')).toBeVisible({ timeout: 30_000 });

    const password = `Teppen!${Date.now()}Aa`;
    await invitedPage.getByTestId('invite-password-input').fill(password);
    await invitedPage.getByTestId('invite-password-confirm-input').fill(password);
    await invitedPage.getByTestId('invite-password-submit').click();

    await expect(invitedPage.locator('#nav-DASHBOARD')).toBeVisible({ timeout: 45_000 });
    const tourClose = invitedPage.getByTestId('tour-close');
    if (await tourClose.isVisible().catch(() => false)) {
      await tourClose.click();
    }

    await invitedPage.locator('#nav-STORE_MANAGEMENT').click();
    await expect(invitedPage.getByRole('heading', { level: 1, name: '店舗管理' })).toBeVisible();

    const updateButton = invitedPage.getByRole('button', { name: '店舗情報を更新' });
    await expect(updateButton).toBeEnabled();
    await expect(invitedPage.getByRole('heading', { level: 2, name: '店舗を追加' })).toHaveCount(0);

    const storeSelectorId = 'header-store-selector';
    const dialog = await openMultiSelectDialog(invitedPage, storeSelectorId);
    const optionCount = await dialog.locator('[role="option"]').count();
    await closeMultiSelectDialog(invitedPage);

    if (optionCount >= 2) {
      const dialog2 = await openMultiSelectDialog(invitedPage, storeSelectorId);
      await multiSelectSelectAll(dialog2, storeSelectorId);
      await closeMultiSelectDialog(invitedPage);
      await expect(invitedPage.getByTestId('multi-store-sns-disabled-banner')).toBeVisible();
      await expect(updateButton).toBeDisabled();

      const dialog3 = await openMultiSelectDialog(invitedPage, storeSelectorId);
      await multiSelectClear(dialog3, storeSelectorId);
      await dialog3.locator('[role="option"]').first().click();
      await closeMultiSelectDialog(invitedPage);
      await expect(invitedPage.getByTestId('multi-store-sns-disabled-banner')).toBeHidden();
      await expect(updateButton).toBeEnabled();
    }

    await invitedContext.close();
  });
});
