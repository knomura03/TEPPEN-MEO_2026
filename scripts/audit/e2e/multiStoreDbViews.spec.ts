import { expect, test } from '@playwright/test';

import {
  closeMultiSelectDialog,
  ensureAtLeastTwoStores,
  loadAuditEnv,
  loginAs,
  multiSelectSelectAll,
  openMultiSelectDialog,
} from './_helpers';

const env = loadAuditEnv();

test.describe('Multi Store Views', () => {
  test('複数店舗選択中でもDBビューは表示でき、SNS API操作は無効化される', async ({ page }) => {
    await loginAs(page, env.admin);
    await ensureAtLeastTwoStores(page);

    const storeSelectorId = 'header-store-selector';
    const dialog = await openMultiSelectDialog(page, storeSelectorId);
    await multiSelectSelectAll(dialog, storeSelectorId);
    await closeMultiSelectDialog(page);

    await expect(page.getByTestId('multi-store-sns-disabled-banner')).toBeVisible();

    // 投稿一覧: 外部投稿取得（API）は無効
    await page.locator('#nav-POST_LIST').click();
    await expect(page.getByTestId('post-list-fetch-external')).toBeDisabled();
    await expect(page.getByTestId('post-filter-search')).toBeVisible();

    // カレンダー: 表示はOK（投稿作成は単一店舗のみ）
    await page.locator('#nav-CALENDAR').click();
    await expect(page.locator('#calendar-grid')).toBeVisible();

    // 受信箱: 表示はOK（外部同期はせず表示更新のみ）
    await page.locator('#nav-INBOX').click();
    await expect(page.getByTestId('inbox-sync-button')).toContainText('表示を更新');

    // プラットフォーム管理: 連携操作は無効
    await page.locator('#nav-PLATFORM_MANAGEMENT').click();
    await expect(page.locator('[data-testid^="provider-card-"]').first()).toBeVisible();
    await expect(page.locator('[data-testid^="provider-toggle-"]').first()).toBeDisabled();
  });
});

