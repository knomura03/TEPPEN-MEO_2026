import { expect, test } from '@playwright/test';
import { gotoSidebarView, installClipboardStub, loadAuditEnv, loginAs } from './_helpers';

const env = loadAuditEnv({ requireManager: true });

test.beforeEach(async ({ page }) => {
  await installClipboardStub(page);
});

test('MANAGER（未設定時はSUPERVISOR）がグループ作成/名称変更ルールを満たす', async ({ page }) => {
  const actingUser = env.supervisor || env.manager!;
  await loginAs(page, actingUser);
  if ((await page.locator('#nav-GROUP_MANAGEMENT').count()) === 0) {
    test.skip(true, '監査用アカウントにグループ管理権限がありません。');
    return;
  }

  await gotoSidebarView(page, 'GROUP_MANAGEMENT');
  await expect(page.locator('#group-management-main')).toBeVisible();

  const nonce = Date.now().toString().slice(-6);
  const groupName = `[AUDIT] グループ_${nonce}`;
  const initialStoreName = `[AUDIT] 店舗_${nonce}`;
  const renamedGroupName = `${groupName}_更新`;

  const createNameInput = page.getByPlaceholder('グループ名（例: 関東エリア）');
  if (await createNameInput.isVisible().catch(() => false)) {
    await createNameInput.fill(groupName);
    await page.getByPlaceholder('初期店舗名（例: 新宿本店）').fill(initialStoreName);
    await page.getByRole('button', { name: 'グループを作成' }).click();
    await expect(page.getByText(groupName)).toBeVisible({ timeout: 15_000 });
  } else {
    test.info().annotations.push({
      type: 'warning',
      description: 'MANAGER権限のためグループ作成UIは表示されません。名称変更のみ確認します。',
    });
  }

  const renameInput = page.locator('form:has-text("現在のグループ名を変更") input').first();
  await renameInput.fill(renamedGroupName);
  await page.getByRole('button', { name: 'グループ名を更新' }).click();
  await expect(page.getByText('グループ名を更新しました。')).toBeVisible({ timeout: 15_000 });
});
