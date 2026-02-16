import { expect, test } from '@playwright/test';
import { installClipboardStub, loadAuditEnv, loginAs } from './_helpers';

const env = loadAuditEnv({ requireManager: true });

test.beforeEach(async ({ page }) => {
  await installClipboardStub(page);
});

test('ADMINは店舗プラン割当UIを操作できる', async ({ page }) => {
  await loginAs(page, env.admin);
  await page.goto('/?view=BILLING', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('店舗へのプラン割当')).toBeVisible();
  await expect(page.getByRole('button', { name: /この店舗に割当|予約切替を登録/ })).toBeVisible();
});

test('MANAGERには内部プラン管理UIが表示されない', async ({ page }) => {
  await loginAs(page, env.manager!);
  await page.goto('/?view=BILLING', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('内部: 契約プラン管理')).toHaveCount(0);
});
