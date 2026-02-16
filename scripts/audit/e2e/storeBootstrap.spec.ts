import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  createInviteLinkFromUserManagement,
  gotoSidebarView,
  installClipboardStub,
  loadAuditEnv,
  loginAs,
  navigateToUserManagement,
} from './_helpers';

const env = loadAuditEnv({ requireUser: true });

const completeInvitePasswordSetup = async (invitePage: Page, inviteLink: string) => {
  await invitePage.goto(inviteLink, { waitUntil: 'domcontentloaded' });
  await expect(invitePage).toHaveURL(/\/invite/);

  const password = `Teppen!${Date.now()}Aa`;
  await invitePage.getByTestId('invite-password-input').fill(password);
  await invitePage.getByTestId('invite-password-confirm-input').fill(password);
  await invitePage.getByTestId('invite-password-submit').click();
  await expect(invitePage.locator('#nav-DASHBOARD')).toBeVisible({ timeout: 45_000 });
};

test('招待ユーザーが店舗管理で自店舗情報を更新できる', async ({ browser, page }) => {
  await installClipboardStub(page);
  await loginAs(page, env.admin);
  await navigateToUserManagement(page);

  const runId = `store-bootstrap-${Date.now()}`;
  const inviteEmail = `${runId}@example.com`;
  const inviteLink = await createInviteLinkFromUserManagement(page, {
    name: `[AUDIT] ${runId}`,
    email: inviteEmail,
    role: 'USER',
  });

  const inviteContext = await browser.newContext({ baseURL: env.baseUrl });
  const invitePage = await inviteContext.newPage();
  await invitePage.addInitScript(() => {
    localStorage.setItem('hasSeenTour', 'true');
  });
  await completeInvitePasswordSetup(invitePage, inviteLink);

  await gotoSidebarView(invitePage, 'STORE_MANAGEMENT');
  await expect(invitePage.locator('#store-management-main')).toBeVisible();

  await invitePage.getByPlaceholder('店舗名').fill(`[AUDIT] ${runId} 店舗`);
  await invitePage.getByPlaceholder('住所').fill('東京都渋谷区道玄坂1-1-1');
  await invitePage.getByPlaceholder('電話番号').fill('03-1234-5678');
  await invitePage.getByPlaceholder('カテゴリ').fill('テスト業種');
  await invitePage.getByPlaceholder('営業時間').fill('月-金 10:00-19:00');
  await invitePage.getByRole('button', { name: '店舗情報を更新' }).click();

  await expect(invitePage.getByText('更新完了')).toBeVisible({ timeout: 30_000 });
  await inviteContext.close();
});
