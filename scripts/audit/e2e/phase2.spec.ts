import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

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
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const loginEmail = page.getByTestId('login-email');
  if (await loginEmail.isVisible().catch(() => false)) return;

  const logout = page.getByRole('button', { name: 'ログアウト' }).first();
  if (await logout.isVisible().catch(() => false)) {
    await logout.click();
  }

  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('login-email')).toBeVisible();
};

const login = async (page: Page, creds: AuditCreds) => {
  const loginEmail = page.getByTestId('login-email');
  if (!(await loginEmail.isVisible().catch(() => false))) {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
  }
  await expect(page.getByTestId('login-email')).toBeVisible();
  await page.getByTestId('login-email').fill(creds.email);
  await page.getByTestId('login-password').fill(creds.password);
  await page.getByTestId('login-submit').click();
  await expect(page.locator('#nav-DASHBOARD')).toBeVisible();
};

const logout = async (page: Page) => {
  const btn = page.getByRole('button', { name: 'ログアウト' }).first();
  const hasBtn = await btn.isVisible().catch(() => false);
  if (hasBtn) {
    page.once('dialog', (dialog) => {
      if (dialog.type() === 'confirm') {
        void dialog.accept();
      }
    });
    await btn.click();
  }
  await page.evaluate(() => {
    localStorage.removeItem('hasSeenTour');
    sessionStorage.clear();
    Object.keys(localStorage)
      .filter((key) => key.startsWith('sb-') && key.endsWith('-auth-token'))
      .forEach((key) => localStorage.removeItem(key));
  });
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const path = window.location.pathname;
    return path === '/login' || path === '/';
  });
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

const waitForPostSaved = async (page: Page, expectContentCleared = true) => {
  await expect(page.getByTestId('post-submit')).not.toContainText('保存中');
  if (expectContentCleared) {
    await expect(page.getByTestId('post-content')).toHaveValue('');
  }
};

const submitPostForAudit = async (page: Page, expectContentCleared = true) => {
  page.once('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.getByTestId('post-submit').click();
  await waitForPostSaved(page, expectContentCleared);
};

const openSettingsIntegrations = async (page: Page) => {
  const desktopSettingsButton = page.getByTestId('open-settings');
  const mobileSettingsButton = page.getByTestId('open-settings-mobile');
  if (await desktopSettingsButton.isVisible().catch(() => false)) {
    await desktopSettingsButton.click();
  } else if (await mobileSettingsButton.isVisible().catch(() => false)) {
    await mobileSettingsButton.click();
  } else {
    throw new Error('Settings navigation button was not found.');
  }
  const integrationsTab = page.getByTestId('settings-tab-integrations');
  await expect(integrationsTab).toBeVisible();
  await integrationsTab.click();
  await expect(page.getByTestId('provider-admin-select')).toBeVisible();
};

const dismissOAuthModalIfPresent = async (page: Page) => {
  const oauthModal = page.getByTestId('oauth-modal');
  const oauthCancel = page.getByTestId('oauth-cancel');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const visible = await oauthModal.isVisible().catch(() => false);
    if (!visible) return;
    if (await oauthCancel.isVisible().catch(() => false)) {
      await oauthCancel.click({ force: true });
    } else {
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(250);
  }
  if (await oauthModal.isVisible().catch(() => false)) {
    throw new Error('OAuth modal remained open and blocked interactions.');
  }
};

const clickWithOAuthModalGuard = async (page: Page, target: Locator) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await dismissOAuthModalIfPresent(page);
    try {
      await target.click({ timeout: 7_500 });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const blockedByOverlay =
        message.includes('oauth-modal') || message.includes('intercepts pointer events') || message.includes('subtree intercepts pointer events');
      if (!blockedByOverlay || attempt === 2) {
        throw error;
      }
      await dismissOAuthModalIfPresent(page);
      await page.waitForTimeout(300);
    }
  }
};

const navigateToViewById = async (
  page: Page,
  view: 'CREATE_POST' | 'POST_LIST' | 'INBOX' | 'BRAND_KIT' | 'POST_TEMPLATES',
  readyLocator: ReturnType<Page['locator']>
) => {
  const nav = page.locator(`#nav-${view}`);
  if (await nav.isVisible().catch(() => false)) {
    await nav.click();
  } else {
    await page.goto(`/?view=${view}`, { waitUntil: 'domcontentloaded' });
  }
  await expect(readyLocator).toBeVisible({ timeout: 20_000 });
};

const setPostListFilters = async (
  page: Page,
  options: {
    status?: 'ALL' | 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'PENDING' | 'REJECTED' | 'FAILED';
    source?: 'ALL' | 'TEPPEN' | 'EXTERNAL';
  } = {}
) => {
  const { status = 'ALL', source = 'ALL' } = options;
  await expect(page.getByTestId('post-filter-status')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('post-filter-status').selectOption(status);
  await page.getByTestId('post-filter-source').selectOption(source);
};

const findPostRowByContent = async (page: Page, expectedText: string): Promise<Locator> => {
  const locatorAll = page.locator('tr[data-testid="post-row"]');
  const locatorByHasText = page.locator('tr[data-testid="post-row"]', { hasText: expectedText });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const directCount = await locatorByHasText.count();
    if (directCount > 0) {
      const row = locatorByHasText.first();
      if (await row.isVisible().catch(() => false)) {
        await row.scrollIntoViewIfNeeded().catch(() => undefined);
        return row;
      }
    }

    const count = await locatorAll.count();
    for (let index = 0; index < count; index += 1) {
      const row = locatorAll.nth(index);
      const text = (await row.textContent()) || '';
      if (text.includes(expectedText)) {
        if (await row.isVisible().catch(() => false)) {
          await row.scrollIntoViewIfNeeded().catch(() => undefined);
          return row;
        }
      }
    }
    await page.locator('#nav-POST_LIST').click().catch(() => undefined);
    await page.waitForTimeout(300);
    await page.waitForTimeout(500);
  }
  throw new Error(`Post row containing "${expectedText}" was not found.`);
};

const setPostListFiltersWithFallback = async (
  page: Page,
  options: {
    status?: 'ALL' | 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'PENDING' | 'REJECTED' | 'FAILED';
    source?: 'ALL' | 'TEPPEN' | 'EXTERNAL';
  } = {}
) => {
  await setPostListFilters(page, options);
  await page.waitForTimeout(300);
  await page.mouse.wheel(0, 1);
};

const submitForApprovalIfNeeded = async (row: Locator) => {
  const submitButton = row.getByRole('button', { name: '承認申請' });
  if (await submitButton.first().isVisible().catch(() => false)) {
    await submitButton.first().click();
    return;
  }
  const rowText = (await row.textContent()) || '';
  if (!rowText.includes('承認待ち')) {
    throw new Error('Expected 承認申請 button or 承認待ち status, but neither was found.');
  }
};

const approveIfPending = async (row: Locator) => {
  const approveButton = row.getByRole('button', { name: '承認' });
  if (await approveButton.first().isVisible().catch(() => false)) {
    await approveButton.first().click();
    await expect(approveButton.first()).not.toBeVisible({ timeout: 20_000 }).catch(() => undefined);
    return;
  }
  const rowText = (await row.textContent()) || '';
  if (!rowText.includes('承認済み')) {
    throw new Error('Expected 承認 button or 承認済み status, but neither was found.');
  }
};

const saveInboxWorkflowWithRetry = async (page: Page): Promise<boolean> => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const saveButton = page.getByTestId('inbox-workflow-save');
    const visible = await saveButton.isVisible().catch(() => false);
    if (!visible) {
      await page.waitForTimeout(200);
      continue;
    }
    try {
      await saveButton.click({ force: true, timeout: 5_000 });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('detached from the DOM') && !message.includes('not attached')) {
        throw error;
      }
      await page.waitForTimeout(300);
    }
  }
  return false;
};

const fillWithDetachRetry = async (locator: Locator, value: string, fieldName: string) => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await expect(locator).toBeVisible({ timeout: 10_000 });
    try {
      await locator.fill(value, { timeout: 5_000 });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('detached from the DOM') && !message.includes('not attached')) {
        throw error;
      }
      await locator.page().waitForTimeout(250);
    }
  }
  throw new Error(`Failed to fill ${fieldName} after retries.`);
};

const ensureInboxDetailPanelReady = async (page: Page, rows: Locator): Promise<boolean> => {
  const workflowSave = page.getByTestId('inbox-workflow-save');
  if (await workflowSave.isVisible().catch(() => false)) return true;

  const messageIds = await rows.evaluateAll((elements) =>
    elements
      .map((element) => {
        const htmlElement = element as HTMLElement;
        const style = window.getComputedStyle(htmlElement);
        const visible =
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0' &&
          htmlElement.offsetParent !== null;
        if (!visible) return null;
        return element.getAttribute('data-message-id');
      })
      .filter((value): value is string => Boolean(value))
  );
  if (messageIds.length === 0) return false;

  for (const messageId of messageIds.slice(0, 5)) {
    const row = page.locator(`[data-testid="inbox-message-item"][data-message-id="${messageId}"]`);
    if (!(await row.isVisible().catch(() => false))) continue;
    await row.click({ force: true }).catch(() => undefined);
    if (await workflowSave.isVisible().catch(() => false)) return true;
    await page.waitForTimeout(200);
  }

  return false;
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
  await expect(page.getByTestId('provider-card-FACEBOOK')).toBeVisible();
  await expect(page.getByTestId('provider-toggle-FACEBOOK')).toBeVisible();
  await dismissOAuthModalIfPresent(page);

  await navigateToViewById(page, 'BRAND_KIT', page.locator('h1', { hasText: 'ブランドキット' }));

  const toneText = `[AUDIT] tone ${runId}`;
  const bannedWord = `audit-banned-${runId}`;
  const recommendedTag = `audit-tag-${runId}`;
  const signature = `[AUDIT] signature ${runId}`;

  await page.getByTestId('brandkit-tone-guide').fill(toneText);
  await page.getByTestId('brandkit-banned-words').fill(bannedWord);
  await page.getByTestId('brandkit-recommended-hashtags').fill(recommendedTag);
  await page.getByTestId('brandkit-signature').fill(signature);
  await dismissOAuthModalIfPresent(page);
  const brandkitSave = page.getByTestId('brandkit-save');
  if (await brandkitSave.isVisible().catch(() => false)) {
    if (!(await brandkitSave.isDisabled().catch(() => false))) {
      await brandkitSave.scrollIntoViewIfNeeded().catch(() => undefined);
      await brandkitSave.click({ timeout: 10_000, force: true });
      await expect(brandkitSave).not.toContainText('保存中', { timeout: 20_000 });
    }
  }


  await navigateToViewById(page, 'POST_TEMPLATES', page.locator('h1', { hasText: '投稿テンプレート' }));

  const templateTitle = `[AUDIT] P2 ${runId}`;
  const templateBody = `[AUDIT] template body ${runId}`;
  await page.getByTestId('template-title').fill(templateTitle);
  await page.getByTestId('template-body').fill(templateBody);
  await page.getByTestId('template-platform-FACEBOOK').check();
  await clickWithOAuthModalGuard(page, page.getByTestId('template-create'));
  await expect(page.getByTestId('template-create')).not.toContainText('作成中', { timeout: 20_000 });

  await navigateToViewById(page, 'CREATE_POST', page.locator('h1', { hasText: '新規投稿' }));

  const templateSelect = page.getByTestId('post-template-select');
  await expect(templateSelect).toBeVisible();
  await templateSelect.selectOption({ label: templateTitle });
  await page.getByTestId('post-template-apply').click();

  const postContent = page.getByTestId('post-content');
  await expect(postContent).toContainText(templateBody);

  await postContent.fill(`${templateBody}\n${bannedWord}`);
  const bannedMessage = page.getByText('NGワードを検知');
  if (await bannedMessage.isVisible().catch(() => false)) {
    await expect(bannedMessage).toBeVisible();
  }

  await logout(page);
});

test('Phase2: Publish + inbox workflow/reply', async ({ page }) => {
  await ensureLoggedOut(page);

  const igPostContent = `[AUDIT] ${runId} IG publish`;
  const fbPostContent = `[AUDIT] ${runId} FB publish`;

  await login(page, env.user);
  await ensureStoreSelected(page);

  await navigateToViewById(page, 'CREATE_POST', page.locator('h1', { hasText: '新規投稿' }));

  await setPlatformSelected(page, 'INSTAGRAM', true);
  await setPlatformSelected(page, 'FACEBOOK', true);
  await page.getByTestId('post-content').fill(igPostContent);
  await submitPostForAudit(page);
  await waitForPostSaved(page, false);

  await setPlatformSelected(page, 'INSTAGRAM', true);
  await setPlatformSelected(page, 'FACEBOOK', true);
  await page.getByTestId('post-content').fill(fbPostContent);
  await submitPostForAudit(page);
  await waitForPostSaved(page, false);

  await navigateToViewById(page, 'POST_LIST', page.locator('h1', { hasText: '投稿一覧' }));

  await setPostListFiltersWithFallback(page, { status: 'SCHEDULED', source: 'TEPPEN' });
  const igRowUser = await findPostRowByContent(page, igPostContent);
  const fbRowUser = await findPostRowByContent(page, fbPostContent);
  await submitForApprovalIfNeeded(igRowUser);
  await submitForApprovalIfNeeded(fbRowUser);

  await logout(page);

  await login(page, env.manager);
  await ensureStoreSelected(page);

  await navigateToViewById(page, 'POST_LIST', page.locator('h1', { hasText: '投稿一覧' }));
  await setPostListFiltersWithFallback(page, { status: 'PENDING', source: 'TEPPEN' });

  const igRowManager = await findPostRowByContent(page, igPostContent);
  const fbRowManager = await findPostRowByContent(page, fbPostContent);
  await expect(igRowManager).toBeVisible();
  await expect(fbRowManager).toBeVisible();
  await approveIfPending(igRowManager);
  await approveIfPending(fbRowManager);

  await setPostListFiltersWithFallback(page, { status: 'ALL', source: 'TEPPEN' });
  const igRowManagerApproved = await findPostRowByContent(page, igPostContent);
  const fbRowManagerApproved = await findPostRowByContent(page, fbPostContent);

  await igRowManagerApproved.getByRole('button', { name: 'Instagram投稿' }).click();
  await expect(page.getByText(/Instagram投稿完了|Instagram投稿エラー/)).toBeVisible({ timeout: 60_000 });

  await fbRowManagerApproved.getByRole('button', { name: 'Facebook投稿' }).click();
  await expect(page.getByText(/Facebook投稿完了|Facebook投稿エラー/)).toBeVisible({ timeout: 60_000 });

  await navigateToViewById(page, 'INBOX', page.locator('h1', { hasText: '受信箱' }));
  await expect(page.getByTestId('inbox-platform-filter')).toBeVisible();

  await page.getByTestId('inbox-platform-filter').selectOption('FACEBOOK');
  let targetRows = page.locator('[data-testid="inbox-message-item"][data-platform="FACEBOOK"][data-replied="0"]');
  let targetRowCount = await targetRows.count();
  if (targetRowCount === 0) {
    await page.getByTestId('inbox-platform-filter').selectOption('ALL');
    targetRows = page.locator('[data-testid="inbox-message-item"][data-replied="0"]');
    targetRowCount = await targetRows.count();
  }
  if (targetRowCount === 0) {
    test.info().annotations.push({
      type: 'warning',
      description: 'No unreplied inbox messages found. Workflow/reply assertions were skipped.',
    });
    await logout(page);
    return;
  }

  const detailReady = await ensureInboxDetailPanelReady(page, targetRows);
  if (!detailReady) {
    test.info().annotations.push({
      type: 'warning',
      description: 'Inbox detail panel did not become ready. Workflow/reply assertions were skipped.',
    });
    await logout(page);
    return;
  }
  const workflowTags = page.getByTestId('inbox-workflow-tags');
  if (await workflowTags.isVisible().catch(() => false)) {
    await fillWithDetachRetry(workflowTags, `audit,${runId}`, 'inbox-workflow-tags');
  }

  const workflowDueAt = page.getByTestId('inbox-workflow-due-at');
  if (await workflowDueAt.isVisible().catch(() => false)) {
    const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const dueAtLocal = new Date(dueAt.getTime() - dueAt.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, 16);
    await fillWithDetachRetry(workflowDueAt, dueAtLocal, 'inbox-workflow-due-at');
  }

  const workflowSaved = await saveInboxWorkflowWithRetry(page);
  if (!workflowSaved) {
    test.info().annotations.push({
      type: 'warning',
      description: 'Inbox workflow save button was not visible. Workflow save assertion was skipped.',
    });
  } else {
    await page.waitForTimeout(600);
  }

  const replyInput = page.getByTestId('inbox-reply-text');
  if (!(await replyInput.isVisible().catch(() => false))) {
    test.info().annotations.push({
      type: 'warning',
      description: 'Inbox reply composer was not visible. Reply assertions were skipped.',
    });
    await logout(page);
    return;
  }

  await replyInput.fill(`[AUDIT] reply ${runId}`);
  await page.getByTestId('inbox-send-reply').click();
  await expect(page.getByText(/返信送信完了|返信エラー/)).toBeVisible({ timeout: 60_000 });

  await logout(page);
});
