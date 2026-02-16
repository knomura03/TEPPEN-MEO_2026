import { expect, test } from '@playwright/test';

import { gotoSidebarView, loadAuditEnv, loginAs, selectSingleStore } from './_helpers';

const env = loadAuditEnv();

test.describe('Platform Management', () => {
  test('単一店舗選択時はプラットフォーム管理の操作が無効化されない', async ({ page }) => {
    await loginAs(page, env.admin);
    await selectSingleStore(page, 0);

    await expect(page.getByTestId('multi-store-sns-disabled-banner')).toBeHidden();

    await gotoSidebarView(page, 'PLATFORM_MANAGEMENT');
    await expect(page.locator('[data-testid^="provider-card-"]').first()).toBeVisible();

    const firstToggle = page.locator('[data-testid^="provider-toggle-"]').first();
    await expect(firstToggle).toBeEnabled();

    await expect(page.getByText('※ 複数店舗選択中は操作できません。')).toHaveCount(0);
  });
});
