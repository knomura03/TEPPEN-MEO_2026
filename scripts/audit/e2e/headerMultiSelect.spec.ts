import { expect, test } from '@playwright/test';

import {
  ensureAtLeastTwoStores,
  loadAuditEnv,
  loginAs,
  multiSelectSelectAll,
  openMultiSelectDialog,
  selectSingleStore,
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
    await expect(dialog.getByTestId('header-store-selector-search')).toBeVisible();
    await multiSelectSelectAll(dialog, storeSelectorId);
    await page.keyboard.press('Escape');
    await expect(multiBanner).toBeVisible();

    await selectSingleStore(page, 0);
    await expect(multiBanner).toBeHidden();
    await expect(page.getByTestId(storeSelectorId)).not.toContainText('未選択');
  });
});
