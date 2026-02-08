import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type AuditCreds = {
  email: string;
  password: string;
};

type AuditEnv = {
  admin: AuditCreds;
  manager: AuditCreds;
  user: AuditCreds;
  baseUrl: string;
};

const loadDotEnvFileSync = (filePath: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (!key) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
};

const requireEnv = (map: Record<string, string>, key: string): string => {
  const value = map[key];
  if (!value) {
    throw new Error(`Missing required env in .env.audit.local: ${key}`);
  }
  return value;
};

const loadAuditEnv = (): AuditEnv => {
  const repoRoot = process.cwd();
  const envPath = path.join(repoRoot, '.env.audit.local');
  if (!fs.existsSync(envPath)) {
    throw new Error('Missing .env.audit.local. Create it with AUDIT_* credentials before running audit.');
  }
  const env = loadDotEnvFileSync(envPath);
  return {
    baseUrl: process.env.AUDIT_BASE_URL || 'http://localhost:3000',
    admin: {
      email: requireEnv(env, 'AUDIT_ADMIN_EMAIL'),
      password: requireEnv(env, 'AUDIT_ADMIN_PASSWORD'),
    },
    manager: {
      email: requireEnv(env, 'AUDIT_MANAGER_EMAIL'),
      password: requireEnv(env, 'AUDIT_MANAGER_PASSWORD'),
    },
    user: {
      email: requireEnv(env, 'AUDIT_USER_EMAIL'),
      password: requireEnv(env, 'AUDIT_USER_PASSWORD'),
    },
  };
};

const env = loadAuditEnv();
const runId = `AUDIT_${new Date().toISOString().replace(/[:.]/g, '-')}`;

const ensureLoggedOut = async (page: Page) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const loginEmail = page.getByTestId('login-email');
  if (await loginEmail.isVisible().catch(() => false)) return;

  const logout = page.getByRole('button', { name: 'ログアウト' }).first();
  if (await logout.isVisible().catch(() => false)) {
    await logout.click();
  } else {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  await expect(page.getByTestId('login-email')).toBeVisible();
};

const login = async (page: Page, creds: AuditCreds) => {
  const loginEmail = page.getByTestId('login-email');
  if (!(await loginEmail.isVisible().catch(() => false))) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  }
  await expect(page.getByTestId('login-email')).toBeVisible();
  await page.getByTestId('login-email').fill(creds.email);
  await page.getByTestId('login-password').fill(creds.password);
  await page.getByTestId('login-submit').click();
  await expect(page.locator('#nav-DASHBOARD')).toBeVisible();
};

const logout = async (page: Page) => {
  const btn = page.getByRole('button', { name: 'ログアウト' }).first();
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.getByTestId('login-email')).toBeVisible();
  await page.waitForFunction(() => {
    const keys = Object.keys(window.localStorage || {});
    return keys.filter((k) => k.startsWith('sb-') && k.endsWith('-auth-token')).length === 0;
  });
};

const ensureStoreSelected = async (page: Page) => {
  const selector = page.getByTestId('store-selector');
  if (!(await selector.isVisible().catch(() => false))) {
    throw new Error('Store selector not found. The app shell may not be loaded.');
  }
  const current = await selector.inputValue();
  if (current) return;
  const firstValue = await selector.locator('option').first().getAttribute('value');
  if (!firstValue) {
    throw new Error('Store selector has no options.');
  }
  await selector.selectOption(firstValue);
};

const setPlatformSelected = async (page: Page, platform: 'INSTAGRAM' | 'FACEBOOK', enabled: boolean) => {
  const btn = page.getByTestId(`post-platform-${platform}`);
  await expect(btn).toBeVisible();
  const className = (await btn.getAttribute('class')) || '';
  const isSelected = className.includes('bg-indigo-600');
  if (enabled !== isSelected) {
    await btn.click();
  }
};

const waitForPostSaved = async (page: Page) => {
  await expect(page.getByTestId('post-submit')).not.toContainText('保存中');
  await expect(page.getByTestId('post-content')).toHaveValue('');
};

const openSettingsIntegrations = async (page: Page) => {
  await page.locator('#nav-SETTINGS').click();
  await expect(page.getByText('設定')).toBeVisible();
  await page.getByTestId('settings-tab-integrations').click();
  await expect(page.getByText('Provider連携設定')).toBeVisible();
};

const ensureOAuthCycle = async (page: Page, providerKey: string) => {
  const card = page.getByTestId(`provider-card-${providerKey}`);
  if (!(await card.isVisible().catch(() => false))) return false;

  await card.click();
  const status = page.getByTestId(`provider-connection-status-${providerKey}`);
  const toggle = page.getByTestId(`provider-toggle-${providerKey}`);

  const disconnectIfNeeded = async () => {
    const statusText = (await status.textContent()) || '';
    if (statusText.includes('CONNECTED')) {
      await toggle.click();
      await expect(status).toContainText('DISCONNECTED', { timeout: 20_000 });
    }
  };

  await disconnectIfNeeded();
  await toggle.click();

  const oauthModal = page.getByTestId('oauth-modal');
  await expect(oauthModal).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('oauth-auth-url')).toBeVisible();
  await page.getByTestId('oauth-auth-code').fill(`code-${runId}-${providerKey}`);
  await page.getByTestId('oauth-complete').click();
  await expect(oauthModal).not.toBeVisible({ timeout: 20_000 });
  await expect(status).toContainText('CONNECTED', { timeout: 20_000 });

  await toggle.click();
  await expect(status).toContainText('DISCONNECTED', { timeout: 20_000 });
  return true;
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('hasSeenTour', 'true');
  });
});

test('Phase2: OAuth + brand kit/template apply', async ({ page }) => {
  await ensureLoggedOut(page);
  await login(page, env.admin);
  await ensureStoreSelected(page);

  await openSettingsIntegrations(page);

  let oauthChecked = 0;
  for (const providerKey of ['FACEBOOK', 'INSTAGRAM', 'GBP']) {
    const checked = await ensureOAuthCycle(page, providerKey);
    if (checked) oauthChecked += 1;
  }
  if (oauthChecked === 0) {
    throw new Error('No OAUTH2 provider cards found for Phase2 OAuth audit.');
  }

  await page.getByTestId('settings-tab-system').click();
  await expect(page.getByText('ブランドキット')).toBeVisible();

  const toneText = `[AUDIT] tone ${runId}`;
  const bannedWord = `audit-banned-${runId}`;
  const recommendedTag = `audit-tag-${runId}`;
  const signature = `[AUDIT] signature ${runId}`;

  await page.getByTestId('brandkit-tone-guide').fill(toneText);
  await page.getByTestId('brandkit-banned-words').fill(bannedWord);
  await page.getByTestId('brandkit-recommended-hashtags').fill(recommendedTag);
  await page.getByTestId('brandkit-signature').fill(signature);
  await page.getByTestId('brandkit-save').click();
  await expect(page.getByTestId('brandkit-save')).not.toContainText('保存中', { timeout: 20_000 });

  const templateTitle = `[AUDIT] P2 ${runId}`;
  const templateBody = `[AUDIT] template body ${runId}`;
  await page.getByTestId('template-title').fill(templateTitle);
  await page.getByTestId('template-body').fill(templateBody);
  await page.getByTestId('template-platform-FACEBOOK').check();
  await page.getByTestId('template-create').click();
  await expect(page.getByTestId('template-create')).not.toContainText('作成中', { timeout: 20_000 });

  await page.locator('#nav-CREATE_POST').click();
  await expect(page.getByRole('heading', { name: '新規投稿作成' })).toBeVisible();

  const templateSelect = page.getByTestId('post-template-select');
  await expect(templateSelect).toBeVisible();
  await templateSelect.selectOption({ label: templateTitle });
  await page.getByTestId('post-template-apply').click();

  const postContent = page.getByTestId('post-content');
  await expect(postContent).toContainText(templateBody);
  await expect(postContent).toContainText(signature);

  await postContent.fill(`${templateBody}\n${bannedWord}`);
  await expect(page.getByText('NGワードを検知')).toBeVisible();

  await logout(page);
});

test('Phase2: Publish + inbox workflow/reply', async ({ page }) => {
  await ensureLoggedOut(page);

  const igPostContent = `[AUDIT] ${runId} IG publish`;
  const fbPostContent = `[AUDIT] ${runId} FB publish`;

  await login(page, env.user);
  await ensureStoreSelected(page);

  await page.locator('#nav-CREATE_POST').click();
  await expect(page.getByRole('heading', { name: '新規投稿作成' })).toBeVisible();

  await setPlatformSelected(page, 'INSTAGRAM', true);
  await setPlatformSelected(page, 'FACEBOOK', true);
  await page.getByTestId('post-content').fill(igPostContent);
  await page.getByTestId('post-submit').click();
  await waitForPostSaved(page);

  await setPlatformSelected(page, 'INSTAGRAM', true);
  await setPlatformSelected(page, 'FACEBOOK', true);
  await page.getByTestId('post-content').fill(fbPostContent);
  await page.getByTestId('post-submit').click();
  await waitForPostSaved(page);

  await page.locator('#nav-POST_LIST').click();
  await expect(page.getByText('投稿管理')).toBeVisible();

  const igRowUser = page.locator('tr', { hasText: igPostContent });
  const fbRowUser = page.locator('tr', { hasText: fbPostContent });
  await expect(igRowUser).toBeVisible();
  await expect(fbRowUser).toBeVisible();
  await igRowUser.getByRole('button', { name: '承認申請' }).click();
  await fbRowUser.getByRole('button', { name: '承認申請' }).click();

  await logout(page);

  await login(page, env.manager);
  await ensureStoreSelected(page);

  await page.locator('#nav-POST_LIST').click();
  await expect(page.getByText('投稿管理')).toBeVisible();

  const igRowManager = page.locator('tr', { hasText: igPostContent });
  const fbRowManager = page.locator('tr', { hasText: fbPostContent });
  await expect(igRowManager).toBeVisible();
  await expect(fbRowManager).toBeVisible();
  await igRowManager.getByRole('button', { name: '承認' }).click();
  await fbRowManager.getByRole('button', { name: '承認' }).click();

  await igRowManager.getByRole('button', { name: 'Instagram投稿' }).click();
  await expect(page.getByText(/Instagram投稿完了|Instagram投稿エラー/)).toBeVisible({ timeout: 60_000 });

  await fbRowManager.getByRole('button', { name: 'Facebook投稿' }).click();
  await expect(page.getByText(/Facebook投稿完了|Facebook投稿エラー/)).toBeVisible({ timeout: 60_000 });

  await page.locator('#nav-INBOX').click();
  await expect(page.getByText('受信箱')).toBeVisible();

  await page.getByTestId('inbox-platform-filter').selectOption('FACEBOOK');
  const facebookRows = page.locator('[data-testid="inbox-message-item"][data-platform="FACEBOOK"][data-replied="0"]');
  const facebookRowCount = await facebookRows.count();
  if (facebookRowCount === 0) {
    throw new Error('No unreplied FACEBOOK message found for Phase2 reply audit.');
  }

  await facebookRows.first().click();
  await page.getByTestId('inbox-workflow-tags').fill(`audit,${runId}`);
  const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const dueAtLocal = new Date(dueAt.getTime() - dueAt.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, 16);
  await page.getByTestId('inbox-workflow-due-at').fill(dueAtLocal);
  await page.getByTestId('inbox-workflow-save').click();
  await expect(page.getByText('ワークフロー更新')).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('inbox-reply-text').fill(`[AUDIT] reply ${runId}`);
  await page.getByTestId('inbox-send-reply').click();
  await expect(page.getByText('返信送信完了')).toBeVisible({ timeout: 60_000 });

  await logout(page);
});
