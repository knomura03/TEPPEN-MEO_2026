import { expect, test } from '@playwright/test';

import {
  closeMultiSelectDialog,
  ensureAtLeastTwoStores,
  loadAuditEnv,
  loginAs,
  multiSelectClear,
  multiSelectSelectAll,
  openMultiSelectDialog,
} from './_helpers';

const env = loadAuditEnv();

test.describe('Header Multi Select', () => {
  test('ADMIN: スコープ選択（管理ユニット/グループ/店舗）が操作できる', async ({ page }) => {
    await loginAs(page, env.admin);

    await expect(page.getByTestId('header-management-unit-selector')).toBeVisible();
    await expect(page.getByTestId('header-group-selector')).toBeVisible();
    await expect(page.getByTestId('header-store-selector')).toBeVisible();

    await ensureAtLeastTwoStores(page);

    const storeSelectorId = 'header-store-selector';
    const multiBanner = page.getByTestId('multi-store-sns-disabled-banner');

    const dialog = await openMultiSelectDialog(page, storeSelectorId);
    await multiSelectSelectAll(dialog, storeSelectorId);
    await closeMultiSelectDialog(page);
    await expect(multiBanner).toBeVisible();

    const dialog2 = await openMultiSelectDialog(page, storeSelectorId);
    await multiSelectClear(dialog2, storeSelectorId);
    const searchInput = dialog2.getByTestId('header-store-selector-search');
    await expect(searchInput).toBeVisible();
    await searchInput.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await closeMultiSelectDialog(page);
    await expect(multiBanner).toBeHidden();
    await expect(page.getByTestId(storeSelectorId)).not.toContainText('未選択');

    const dialog3 = await openMultiSelectDialog(page, storeSelectorId);
    await multiSelectClear(dialog3, storeSelectorId);
    await dialog3.locator('[role="option"]').first().click();
    await closeMultiSelectDialog(page);
    await expect(multiBanner).toBeHidden();
  });
});
