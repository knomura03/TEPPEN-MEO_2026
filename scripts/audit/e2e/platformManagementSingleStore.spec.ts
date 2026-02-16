import { expect, test } from '@playwright/test';

import { closeMultiSelectDialog, loadAuditEnv, loginAs, multiSelectClear, openMultiSelectDialog } from './_helpers';

const env = loadAuditEnv();

test.describe('Platform Management', () => {
  test('単一店舗選択時はプラットフォーム管理の操作が無効化されない', async ({ page }) => {
    await loginAs(page, env.admin);

    const storeSelectorId = 'header-store-selector';
    const dialog = await openMultiSelectDialog(page, storeSelectorId);
    await multiSelectClear(dialog, storeSelectorId);
    await dialog.locator('[role="option"]').first().click();
    await closeMultiSelectDialog(page);

    await expect(page.getByTestId('multi-store-sns-disabled-banner')).toBeHidden();

    await page.locator('#nav-PLATFORM_MANAGEMENT').click();
    await expect(page.locator('[data-testid^="provider-card-"]').first()).toBeVisible();

    const firstToggle = page.locator('[data-testid^="provider-toggle-"]').first();
    await expect(firstToggle).toBeEnabled();

    await expect(page.getByText('※ 複数店舗選択中は操作できません。')).toHaveCount(0);
  });
});

