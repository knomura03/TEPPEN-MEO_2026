import { expect, test } from '@playwright/test';
import { gotoSidebarView, installClipboardStub, loadAuditEnv, loginAs, selectSingleStore } from './_helpers';

const env = loadAuditEnv({ requireManager: true, requireUser: true });
const runId = `AUDIT-P1-${Date.now()}`;

test.beforeEach(async ({ page }) => {
  await installClipboardStub(page);
});

test('Phase1: USERが主要画面を利用できる（アンケート/投稿/受信箱）', async ({ page }) => {
  await loginAs(page, env.user!);
  await selectSingleStore(page);

  await gotoSidebarView(page, 'SURVEY');
  await expect(page.getByTestId('survey-title')).toBeVisible();
  await expect(page.getByTestId('survey-create-draft')).toBeVisible();

  await gotoSidebarView(page, 'CREATE_POST');
  const content = `[AUDIT] phase1 post ${runId}`;
  await page.getByTestId('post-content').fill(content);
  const submitButton = page.getByTestId('post-submit');
  const canSubmit = await submitButton.isEnabled().catch(() => false);
  if (canSubmit) {
    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await submitButton.click();
    await expect(page.getByText(/申請完了|予約作成完了|下書き保存完了/)).toBeVisible({ timeout: 30_000 });
  } else {
    test.info().annotations.push({
      type: 'warning',
      description: '投稿対象プラットフォームが未接続のため、投稿ボタン操作はスキップしました。',
    });
  }

  await gotoSidebarView(page, 'POST_LIST');
  if (canSubmit) {
    await page.getByTestId('post-filter-search').fill(content);
    await expect(page.locator('[data-testid="post-row"]').filter({ hasText: content }).first()).toBeVisible({ timeout: 30_000 });
  }

  await gotoSidebarView(page, 'INBOX');
  await expect(page.getByTestId('inbox-platform-filter')).toBeVisible();
});

test('Phase1: MANAGERが投稿一覧とユーザー管理を開ける', async ({ page }) => {
  await loginAs(page, env.manager!);
  await selectSingleStore(page);

  await gotoSidebarView(page, 'POST_LIST');
  await expect(page.getByTestId('post-filter-status')).toBeVisible();

  await gotoSidebarView(page, 'USER_MANAGEMENT');
  await expect(page.getByRole('heading', { name: 'ユーザー管理' }).first()).toBeVisible();
});
