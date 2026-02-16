import { expect, test } from '@playwright/test';
import { gotoSidebarView, installClipboardStub, loadAuditEnv, loginAs, selectSingleStore } from './_helpers';

const env = loadAuditEnv({ requireManager: true });

test.beforeEach(async ({ page }) => {
  await installClipboardStub(page);
});

test('Phase4: ADMINは契約プラン管理とPWA導線を確認できる', async ({ page }) => {
  await loginAs(page, env.admin);
  await selectSingleStore(page);
  await gotoSidebarView(page, 'BILLING');

  await expect(page.getByTestId('billing-view-root')).toBeVisible();
  await expect(page.getByTestId('billing-plan-current')).toBeVisible();
  await expect(page.getByText('内部: 契約プラン管理')).toBeVisible();
  await expect(page.getByRole('heading', { name: '店舗へのプラン割当' })).toBeVisible();
  await expect(page.getByTestId('pwa-install-button')).toBeVisible();
});

test('Phase4: MANAGERは内部契約プラン管理を操作できない', async ({ page }) => {
  await loginAs(page, env.manager!);
  await selectSingleStore(page);
  await gotoSidebarView(page, 'BILLING');
  await expect(page.getByTestId('billing-view-root')).toBeVisible();
  await expect(page.getByText('内部: 契約プラン管理')).toHaveCount(0);
});
