import { expect, test } from '@playwright/test';
import { gotoSidebarView, installClipboardStub, loadAuditEnv, loginAs, selectSingleStore } from './_helpers';

const env = loadAuditEnv({ requireManager: true, requireUser: true });
const runId = `AUDIT-P3-${Date.now()}`;

test.beforeEach(async ({ page }) => {
  await installClipboardStub(page);
});

test('Phase3: ADMINが順位・競合の基本データを操作できる', async ({ page }) => {
  await loginAs(page, env.admin);
  await selectSingleStore(page);
  await gotoSidebarView(page, 'RANK_TRACKER');
  await expect(page.getByTestId('rank-tracker-view')).toBeVisible();

  const keyword = `[AUDIT] ${runId}-keyword`;
  await page.getByTestId('rank-keyword-new-input').fill(keyword);
  await page.getByTestId('rank-keyword-note-input').fill('[AUDIT] 監査キーワード');
  await page.getByTestId('rank-keyword-add').click();
  await expect(page.getByText('追加完了')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('rank-keyword-item').filter({ hasText: keyword }).first()).toBeVisible();

  const competitor = `[AUDIT] ${runId}-competitor`;
  await page.getByTestId('rank-competitor-name-input').fill(competitor);
  await page.getByTestId('rank-competitor-note-input').fill('[AUDIT] 監査競合');
  await page.getByTestId('rank-competitor-add').click();
  await expect(page.getByText('追加完了')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('rank-competitor-item').filter({ hasText: competitor }).first()).toBeVisible();
});

test('Phase3: MANAGER/USERが順位チェック画面を閲覧できる', async ({ browser }) => {
  const managerContext = await browser.newContext({ baseURL: env.baseUrl });
  const managerPage = await managerContext.newPage();
  await installClipboardStub(managerPage);
  await loginAs(managerPage, env.manager!);
  await selectSingleStore(managerPage);
  await gotoSidebarView(managerPage, 'RANK_TRACKER');
  await expect(managerPage.getByTestId('rank-tracker-view')).toBeVisible();
  await expect(managerPage.getByText('順位・競合ダッシュボード')).toBeVisible();
  await managerContext.close();

  const userContext = await browser.newContext({ baseURL: env.baseUrl });
  const userPage = await userContext.newPage();
  await installClipboardStub(userPage);
  await loginAs(userPage, env.user!);
  await selectSingleStore(userPage);
  await gotoSidebarView(userPage, 'RANK_TRACKER');
  await expect(userPage.getByTestId('rank-tracker-view')).toBeVisible();
  await expect(userPage.getByText('順位・競合ダッシュボード')).toBeVisible();
  await userContext.close();
});
