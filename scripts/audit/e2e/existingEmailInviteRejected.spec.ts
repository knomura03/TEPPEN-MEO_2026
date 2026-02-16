import type { Locator } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { installClipboardStub, loadAuditEnv, loginAs, navigateToUserManagement } from './_helpers';

const env = loadAuditEnv({ requireUser: true });

const pickFirstRequiredSelectOption = async (selector: Locator) => {
  const optionValue = await selector.locator('option').nth(1).getAttribute('value');
  if (optionValue) {
    await selector.selectOption(optionValue);
  }
};

test.beforeEach(async ({ page }) => {
  await installClipboardStub(page);
});

test('既存メールで新規招待すると固定エラーを返す', async ({ page }) => {
  await loginAs(page, env.admin);
  await navigateToUserManagement(page);

  await page.getByRole('button', { name: '新規ユーザー作成' }).click();
  await page.getByTestId('invite-name-input').fill('[AUDIT] existing-email');
  await page.getByTestId('invite-email-input').fill(env.user!.email);

  const groupSelect = page.locator('div:has(> label:has-text("グループ（必須）")) select').first();
  if (await groupSelect.isVisible().catch(() => false)) {
    await pickFirstRequiredSelectOption(groupSelect);
  }

  const storeSelect = page.locator('div:has(> label:has-text("店舗（必須）")) select').first();
  if (await storeSelect.isVisible().catch(() => false)) {
    await pickFirstRequiredSelectOption(storeSelect);
  }

  await page.getByRole('button', { name: '招待を送信' }).click();
  await expect(
    page.getByText('すでに存在しているユーザーのため招待できません。別のメールアドレスを指定してください。')
  ).toBeVisible({ timeout: 20_000 });
});
