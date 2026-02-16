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

const getLoginEmailInput = (page: Page) =>
  page
    .locator(
      '[data-testid="login-email"], input[name="email"], input[type="email"], input[placeholder="you@example.com"]'
    )
    .first();

const getLoginPasswordInput = (page: Page) =>
  page
    .locator(
      '[data-testid="login-password"], input[name="password"], input[type="password"], input[placeholder="••••••••"]'
    )
    .first();

const getLoginSubmitButton = (page: Page) =>
  page
    .locator(
      '[data-testid="login-submit"], button[type="submit"], button:has-text("ログイン"), button:has-text("管理画面")'
    )
    .first();

const clickSidebarLogout = async (page: Page) => {
  const logoutButton = page.locator('#sidebar-logout-button');
  if (!(await logoutButton.isVisible().catch(() => false))) return false;

  page.once('dialog', async (dialog) => {
    if (dialog.type() === 'confirm') {
      await dialog.accept();
      return;
    }
    await dialog.dismiss();
  });
  await logoutButton.click();
  return true;
};

const ensureLoginScreen = async (page: Page) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const loginEmail = getLoginEmailInput(page);
  if (await loginEmail.isVisible().catch(() => false)) return;

  if (await page.locator('#nav-DASHBOARD').isVisible().catch(() => false)) {
    const didClickLogout = await clickSidebarLogout(page);
    if (didClickLogout) {
      await page.goto('/login', { waitUntil: 'domcontentloaded' });
      if (await loginEmail.isVisible().catch(() => false)) return;
    }
  }

  const landingLogin = page.getByRole('button', { name: 'ログイン' }).first();
  if (await landingLogin.isVisible().catch(() => false)) {
    await landingLogin.click();
    if (await loginEmail.isVisible().catch(() => false)) return;
  }

  // Last resort for stale client state.
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await expect(loginEmail).toBeVisible();
};

const ensureLoggedOut = async (page: Page) => {
  await ensureLoginScreen(page);
  const loginEmail = getLoginEmailInput(page);
  if (await loginEmail.isVisible().catch(() => false)) return;

  if (await clickSidebarLogout(page)) {
    await ensureLoginScreen(page);
  } else {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await ensureLoginScreen(page);
  }
  await ensureLoginScreen(page);
};

const login = async (page: Page, creds: AuditCreds) => {
  await ensureLoginScreen(page);
  await expect(getLoginEmailInput(page)).toBeVisible();
  await getLoginEmailInput(page).fill(creds.email);
  await getLoginPasswordInput(page).fill(creds.password);
  await getLoginSubmitButton(page).click();
  await expect(page.locator('#nav-DASHBOARD')).toBeVisible();
};

const logout = async (page: Page) => {
  const btn = page.locator('#sidebar-logout-button');
  await expect(btn).toBeVisible();
  await clickSidebarLogout(page);
  await ensureLoginScreen(page);
  // Ensure Supabase session is fully cleared before the next login.
  // `authService.logout()` is async but not awaited in the UI handler.
  await page.waitForFunction(() => {
    const keys = Object.keys(window.localStorage || {});
    return keys.filter((k) => k.startsWith('sb-') && k.endsWith('-auth-token')).length === 0;
  });
};

const ensureStoreSelected = async (page: Page) => {
  const selectorByTestId = page.getByTestId('store-selector');
  const selectorByHeader = page.getByRole('banner').getByRole('combobox').first();

  await Promise.race([
    selectorByTestId.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {}),
    selectorByHeader.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {}),
  ]);

  const selector = (await selectorByTestId.isVisible().catch(() => false))
    ? selectorByTestId
    : (await selectorByHeader.isVisible().catch(() => false))
      ? selectorByHeader
      : null;

  if (!selector) {
    const storeMissing = page.getByRole('button', { name: /店舗が未設定|店舗取得エラー/ }).first();
    if (await storeMissing.isVisible().catch(() => false)) {
      throw new Error('No stores available for this user. Prepare at least one store (and membership) before running audit.');
    }
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

const readCurrentStoreId = async (page: Page): Promise<string | null> => {
  const selectorByTestId = page.getByTestId('store-selector');
  if (await selectorByTestId.isVisible().catch(() => false)) {
    const value = await selectorByTestId.inputValue().catch(() => '');
    return value || null;
  }

  const selectorByHeader = page.getByRole('banner').getByRole('combobox').first();
  if (await selectorByHeader.isVisible().catch(() => false)) {
    const value = await selectorByHeader.inputValue().catch(() => '');
    return value || null;
  }

  return null;
};

const selectStoreByIdIfAvailable = async (page: Page, storeId: string | null) => {
  if (!storeId) return;
  const selector = page.getByTestId('store-selector');
  if (!(await selector.isVisible().catch(() => false))) return;
  const targetOption = selector.locator(`option[value="${storeId}"]`);
  if ((await targetOption.count()) === 0) return;
  await selector.selectOption(storeId);
};

const waitForPostSaved = async (page: Page) => {
  await expect(page.getByTestId('post-submit')).not.toContainText('保存中');
  await expect(page.getByTestId('post-content')).toHaveValue('', { timeout: 30_000 });
};

const submitPost = async (page: Page) => {
  page.once('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.getByTestId('post-submit').click();
  await waitForPostSaved(page);
};

const navigateToView = async (
  page: Page,
  view: 'SURVEY' | 'CREATE_POST' | 'POST_LIST' | 'USER_MANAGEMENT',
  readyLocator: ReturnType<Page['locator']>
) => {
  const nav = page.locator(`#nav-${view}`);
  if (await nav.isVisible().catch(() => false)) {
    await nav.click();
  } else {
    await page.goto(`/?view=${view}`, { waitUntil: 'domcontentloaded' });
  }
  await expect(readyLocator).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('hasSeenTour', 'true');
  });
});

test('Phase1: Survey create/publish/respond/assets', async ({ page, browser }, testInfo) => {
  await ensureLoggedOut(page);
  await login(page, env.user);
  await ensureStoreSelected(page);

  await navigateToView(page, 'SURVEY', page.getByTestId('survey-title'));

  // Wait for the survey list to finish its initial load. Otherwise, the component effect that
  // initializes `selectedSurveyId` can overwrite our edits.
  await Promise.race([
    page.getByTestId('survey-list-item').first().waitFor({ state: 'visible', timeout: 20_000 }),
    page.getByText('アンケートがありません。右側で作成してください。').waitFor({ state: 'visible', timeout: 20_000 }),
  ]);

  const archivePublishedAuditSurveysInList = async () => {
    const publishedAudit = page.locator(
      '[data-testid="survey-list-item"][data-survey-status="PUBLISHED"][data-survey-title*="[AUDIT]"]'
    );
    // Keep the audit safe: only auto-archive existing published [AUDIT] surveys.
    // (A published non-[AUDIT] survey may exist in another store and still block publishing.)
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const count = await publishedAudit.count();
      if (count === 0) return;

      const item = publishedAudit.first();
      const surveyId = await item.getAttribute('data-survey-id');
      await item.click();
      await page.getByTestId('survey-archive').click();

      if (surveyId) {
        await expect(
          page.locator(
            `[data-testid="survey-list-item"][data-survey-id="${surveyId}"][data-survey-status="ARCHIVED"]`
          )
        ).toBeVisible({ timeout: 20_000 });
      } else {
        await expect(publishedAudit).toHaveCount(count - 1, { timeout: 20_000 });
      }
    }
  };

  await archivePublishedAuditSurveysInList();

  const auditSurveyTitle = `[AUDIT] ${runId} Survey`;

  await page.getByTestId('survey-title').fill(auditSurveyTitle);
  await page.getByPlaceholder('https://...').fill('');
  await page.getByTestId('survey-positive-threshold').selectOption('4');
  await page.getByTestId('survey-create-draft').click();

  await expect(page.getByTestId('survey-publish')).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId('survey-publish').click();

  const publicUrlLocator = page.getByTestId('survey-public-url');
  const publishErrorHeading = page.getByRole('heading', { name: '公開エラー' }).first();
  let usedSurveyTitle = auditSurveyTitle;
  let usedSurveyId: string | null = null;
  let usedExistingPublishedSurvey = false;
  const publishOutcome = await Promise.race([
    publicUrlLocator.waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'published' as const),
    publishErrorHeading.waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'error' as const),
  ]);
  if (publishOutcome === 'error') {
    const toastCard = publishErrorHeading.locator('..').locator('..');
    const toastMessage = (await toastCard.locator('p').first().textContent())?.trim() || '';

    const constraintText = '公開中アンケートはユーザーごとに1件までです。';
    if (toastMessage.includes(constraintText)) {
      // Keep existing non-audit published survey as-is and reuse it.
      await archivePublishedAuditSurveysInList();
      const existingPublished = page
        .locator('[data-testid="survey-list-item"][data-survey-status="PUBLISHED"]')
        .first();
      await expect(existingPublished).toBeVisible({ timeout: 20_000 });
      await existingPublished.click();
      usedSurveyId = await existingPublished.getAttribute('data-survey-id');
      usedSurveyTitle = (await existingPublished.getAttribute('data-survey-title')) || usedSurveyTitle;
      usedExistingPublishedSurvey = true;
      await expect(publicUrlLocator).toBeVisible({ timeout: 20_000 });
    } else {
      throw new Error(`Survey publish failed: ${toastMessage || '公開に失敗しました。'}`);
    }
  } else {
    const createdSurvey = page
      .locator('[data-testid="survey-list-item"]', { hasText: auditSurveyTitle })
      .first();
    usedSurveyId = await createdSurvey.getAttribute('data-survey-id');
  }

  const resolvePublicUrlFromCurrentSurvey = async () => {
    await expect(publicUrlLocator).toBeVisible({ timeout: 20_000 });
    const popup = await Promise.all([
      page.waitForEvent('popup'),
      page.getByTestId('survey-open-public-url').click(),
    ]).then(([p]) => p);
    await popup.waitForLoadState('domcontentloaded');
    const popupUrl = popup.url();
    await popup.close();
    if (!popupUrl || !popupUrl.includes('/survey/')) {
      throw new Error(`Public survey URL is invalid: ${popupUrl || 'empty'}`);
    }
    return popupUrl;
  };

  const publicUrl = await resolvePublicUrlFromCurrentSurvey();

  const submitSurveyResponse = async (rating: '3' | '5') => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const responderContext = await browser.newContext();
      const responderPage = await responderContext.newPage();
      try {
        await responderPage.goto(publicUrl, { waitUntil: 'domcontentloaded' });
        await responderPage.getByRole('button', { name: rating }).click();
        await responderPage.getByRole('button', { name: '回答を送信する' }).click();

        const thanksMessage = responderPage.getByText('ご回答ありがとうございました');
        const submitErrorMessage = responderPage.getByText('回答の送信に失敗しました');
        const submitOutcome = await Promise.race([
          thanksMessage.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'ok' as const),
          submitErrorMessage.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'error' as const),
        ]);
        if (submitOutcome === 'ok') return;

        const detail = (await responderPage.locator('body').innerText()).slice(0, 500);
        if (attempt === 1) {
          throw new Error(`Public survey response failed after retry: ${detail}`);
        }
      } finally {
        await responderContext.close();
      }
    }
  };

  if (usedExistingPublishedSurvey) {
    // Existing production surveys may redirect to external review URLs on high-rating branch.
    // Keep audit stable by validating only the low-rating branch.
    await submitSurveyResponse('3');
  } else {
    await submitSurveyResponse('5');
    await submitSurveyResponse('3');
  }

  // Return to app and validate CSV contains branch_type.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await navigateToView(page, 'SURVEY', page.getByTestId('survey-title'));

  const targetSurveyItem = usedSurveyId
    ? page.locator(`[data-testid="survey-list-item"][data-survey-id="${usedSurveyId}"]`).first()
    : page.locator('[data-testid="survey-list-item"]', { hasText: usedSurveyTitle }).first();
  await expect(targetSurveyItem).toBeVisible({ timeout: 20_000 });
  await targetSurveyItem.click();

  let csv = '';
  const expectedBranches = usedExistingPublishedSurvey ? ['NEGATIVE'] : ['POSITIVE', 'NEGATIVE'];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('survey-download-csv').click(),
    ]).then(([dl]) => dl);
    const csvPath = testInfo.outputPath(`survey_responses_${attempt}.csv`);
    await download.saveAs(csvPath);
    csv = fs.readFileSync(csvPath, 'utf8');
    if (expectedBranches.every((branch) => csv.includes(branch))) break;

    await page.waitForTimeout(4_000);
    await page.getByRole('button', { name: '再読み込み' }).click();
    await expect(targetSurveyItem).toBeVisible({ timeout: 20_000 });
    await targetSurveyItem.click();
  }

  expect(csv).toContain('branch_type');
  for (const expectedBranch of expectedBranches) {
    expect(csv).toContain(expectedBranch);
  }

  // QR download
  const qrDownload = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('survey-download-qr').click(),
  ]).then(([dl]) => dl);
  await qrDownload.saveAs(testInfo.outputPath('survey_qr.png'));

  // POP print window (popup)
  const popup = await Promise.all([
    page.waitForEvent('popup'),
    page.getByTestId('survey-print-pop').click(),
  ]).then(([p]) => p);
  await expect(popup.getByText('印刷 / PDF保存')).toBeVisible();
  await popup.close();

  // Cleanup: archive the published [AUDIT] surveys to avoid blocking the next audit run.
  await archivePublishedAuditSurveysInList();

  await logout(page);
});

test('Phase1: Approval workflow (USER -> MANAGER approve/reject)', async ({ page }) => {
  await ensureLoggedOut(page);

  const approveContent = `[AUDIT] ${runId} post approve`;
  const rejectContent = `[AUDIT] ${runId} post reject`;

  await login(page, env.user);
  await ensureStoreSelected(page);
  const userStoreId = await readCurrentStoreId(page);

  await navigateToView(page, 'CREATE_POST', page.getByTestId('post-content'));
  await page.getByRole('button', { name: 'FACEBOOK' }).click();
  await page.getByTestId('post-content').fill(approveContent);
  await submitPost(page);

  await page.getByRole('button', { name: 'FACEBOOK' }).click();
  await page.getByTestId('post-content').fill(rejectContent);
  await submitPost(page);

  await logout(page);

  await login(page, env.manager);
  await ensureStoreSelected(page);
  await selectStoreByIdIfAvailable(page, userStoreId);

  await navigateToView(page, 'POST_LIST', page.locator('h1', { hasText: '投稿一覧' }).first());

  const approveRow = page.locator('tr', { hasText: approveContent });
  await expect(approveRow).toBeVisible();
  await approveRow.getByRole('button', { name: '承認' }).click();

  const rejectRow = page.locator('tr', { hasText: rejectContent });
  await expect(rejectRow).toBeVisible();
  page.once('dialog', (dialog) => {
    const message = dialog.message();
    if (message.includes('差し戻し理由')) {
      void dialog.accept('[AUDIT] reject reason');
      return;
    }
    void dialog.dismiss();
  });
  await rejectRow.getByRole('button', { name: '差し戻し' }).click();

  // Ensure history opens (P1-07) and is not empty.
  await approveRow.getByRole('button', { name: '履歴' }).click();
  await expect(page.getByText('差し戻しコメント履歴')).toBeVisible();
  // Wait until history finishes loading, then assert it is non-empty.
  await expect(page.getByText('履歴を読み込み中...')).not.toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('履歴はまだありません。')).not.toBeVisible();

  // Close modal before logout to avoid the overlay intercepting clicks.
  await page.getByRole('button', { name: '閉じる' }).click();
  await expect(page.getByText('差し戻しコメント履歴')).not.toBeVisible();

  await logout(page);
});

test('Phase1: User controls + CSV import', async ({ page }, testInfo) => {
  await ensureLoggedOut(page);
  await login(page, env.admin);
  await ensureStoreSelected(page);

  await navigateToView(page, 'USER_MANAGEMENT', page.locator('h1', { hasText: 'ユーザー管理' }).first());

  const csvStoreName = `[AUDIT] ${runId} store`;

  // Prepare CSV target user (first option) and enable CSV + increase store limit.
  const userSelect = page.getByTestId('store-csv-user-select');
  await expect(userSelect).toBeVisible();
  const firstUserOption = userSelect.locator('option').nth(1);
  const targetUserId = await firstUserOption.getAttribute('value');
  if (!targetUserId) {
    throw new Error('No USER accounts available for CSV import test.');
  }
  await userSelect.selectOption(targetUserId);

  await page.getByTestId(`user-max-stores-${targetUserId}`).fill('20');
  await page.getByTestId(`user-allow-csv-${targetUserId}`).check();
  await page.getByTestId(`user-control-save-${targetUserId}`).click();
  const userControlSaveSuccess = page.getByText('保存完了');
  const userControlSaveError = page.getByText('保存エラー');
  await Promise.race([
    userControlSaveSuccess.waitFor({ state: 'visible', timeout: 20_000 }),
    userControlSaveError.waitFor({ state: 'visible', timeout: 20_000 }).then(async () => {
      throw new Error('User store control save failed');
    }),
  ]);
  await expect(page.getByTestId(`user-max-stores-${targetUserId}`)).toHaveValue('20');

  // Build a valid CSV (1 row) and execute import.
  const csvBody = [
    'store_name,address,phone,category,business_hours,website,note',
    `"${csvStoreName}","Tokyo","03-1234-9999","Cafe","Mon:10:00-19:00","","audit"`,
    '',
  ].join('\n');
  const csvPath = testInfo.outputPath('stores.csv');
  fs.writeFileSync(csvPath, csvBody, 'utf8');

  await page.getByTestId('store-csv-file-input').setInputFiles(csvPath);
  await expect(page.getByText(/CSV検証OK/)).toBeVisible();

  const csvExecuteButton = page.getByTestId('store-csv-execute');
  await csvExecuteButton.click();
  await expect(csvExecuteButton).toHaveText('CSV実行中...', { timeout: 20_000 });
  await expect(csvExecuteButton).toHaveText('CSV一括作成を実行', { timeout: 120_000 });
  const csvExecutionErrorsHeading = page.getByText('CSV実行エラー（先頭20件）');
  if (await csvExecutionErrorsHeading.isVisible()) {
    const firstExecutionError = (await page.locator('[data-testid^="store-csv-exec-error-"]').first().textContent())?.trim();
    throw new Error(`CSV execution failed: ${firstExecutionError || 'unknown'}`);
  }
  await expect(page.getByText('CSV実行完了')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('store-csv-execute')).toHaveText('CSV一括作成を実行');

  // Invalid CSV should surface validation errors (overall failure).
  const invalidCsvBody = ['store_name,address,phone,category,business_hours,website,note', '"","",,,', ''].join('\n');
  const invalidCsvPath = testInfo.outputPath('stores_invalid.csv');
  fs.writeFileSync(invalidCsvPath, invalidCsvBody, 'utf8');
  await page.getByTestId('store-csv-file-input').setInputFiles(invalidCsvPath);
  await expect(page.getByText('CSV検証エラー（先頭20件）')).toBeVisible();

  await logout(page);
});
