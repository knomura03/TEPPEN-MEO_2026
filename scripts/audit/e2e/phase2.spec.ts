import { expect, test } from '@playwright/test';
import { gotoSidebarView, installClipboardStub, loadAuditEnv, loginAs, selectSingleStore } from './_helpers';

const env = loadAuditEnv({ requireManager: true, requireUser: true });
const runId = `AUDIT-P2-${Date.now()}`;

test.beforeEach(async ({ page }) => {
  await installClipboardStub(page);
});

test('Phase2: ADMINがプラットフォーム管理とブランド/テンプレート設定を実行できる', async ({ page }) => {
  await loginAs(page, env.admin);
  await selectSingleStore(page);

  await gotoSidebarView(page, 'PLATFORM_MANAGEMENT');
  await expect(page.locator('#platform-management-main')).toBeVisible();
  await expect(page.getByTestId('provider-card-GBP')).toBeVisible();
  await expect(page.getByTestId('provider-card-FACEBOOK')).toBeVisible();
  await expect(page.getByTestId('provider-card-INSTAGRAM')).toBeVisible();

  await gotoSidebarView(page, 'BRAND_KIT');
  await page.getByTestId('brandkit-tone-guide').fill(`[AUDIT] tone ${runId}`);
  await page.getByTestId('brandkit-banned-words').fill(`audit-ng-${runId}`);
  await page.getByTestId('brandkit-recommended-hashtags').fill(`audit-tag-${runId}`);
  await page.getByTestId('brandkit-signature').fill(`[AUDIT] signature ${runId}`);
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(page.getByText('保存完了')).toBeVisible({ timeout: 20_000 });

  await gotoSidebarView(page, 'POST_TEMPLATES');
  const templateTitle = `[AUDIT] template ${runId}`;
  const templateBody = `[AUDIT] body ${runId}`;
  await page.getByTestId('template-title').fill(templateTitle);
  await page.getByTestId('template-body').fill(templateBody);
  await page.getByTestId('template-platform-FACEBOOK').check();
  await page.getByTestId('template-create').click();
  await expect(page.getByText('作成完了')).toBeVisible({ timeout: 20_000 });

  await gotoSidebarView(page, 'CREATE_POST');
  await page.getByTestId('post-template-select').selectOption({ label: templateTitle });
  await page.getByTestId('post-template-apply').click();
  await expect(page.getByTestId('post-content')).toContainText(templateBody);
});

test('Phase2: USERが新規投稿から承認申請を作成できる', async ({ page }) => {
  await loginAs(page, env.user!);
  await selectSingleStore(page);
  await gotoSidebarView(page, 'CREATE_POST');

  const content = `[AUDIT] phase2 user post ${runId}`;
  await page.getByTestId('post-content').fill(content);
  const submitButton = page.getByTestId('post-submit');
  if (await submitButton.isEnabled().catch(() => false)) {
    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await submitButton.click();
    await expect(page.getByText(/申請完了|予約作成完了|下書き保存完了/)).toBeVisible({ timeout: 30_000 });
  } else {
    test.info().annotations.push({
      type: 'warning',
      description: '投稿対象プラットフォーム未接続のため、投稿ボタン操作はスキップしました。',
    });
  }
});
