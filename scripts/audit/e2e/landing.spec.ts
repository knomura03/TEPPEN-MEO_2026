import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('hasSeenTour', 'true');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {},
      },
    });
  });
});

test('Landing: hero is visible on top page', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '店舗集客を、ひとつの画面で。' })).toBeVisible();
});

test('Landing: login button navigates to /login', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'ログイン' }).first().click();
  await expect(page).toHaveURL(/\/login\/?$/);
  await expect(page.getByTestId('login-email')).toBeVisible();
});

test('Landing: contact form copy shows success message', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#contact').scrollIntoViewIfNeeded();

  await page.getByLabel(/お名前/).fill('テスト太郎');
  await page.getByLabel(/メールアドレス/).fill('test@example.com');
  await page.getByLabel(/店舗名\/会社名/).fill('TEPPENテスト店');
  await page.getByLabel(/電話番号/).fill('0312345678');
  await page.getByLabel(/お問い合わせ内容/).fill('導入相談を希望します。');

  await page.getByRole('button', { name: '内容をコピー' }).click();
  await expect(
    page.getByText('コピーしました。メールやチャットに貼り付けてお送りください。')
  ).toBeVisible();
});
