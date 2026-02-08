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
  await page.goto('/', { waitUntil: 'domcontentloaded' });
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
};

const ensureStoreSelected = async (page: Page) => {
  const selector = page.getByTestId('store-selector');
  if (!(await selector.isVisible().catch(() => false))) {
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

const waitForPostSaved = async (page: Page) => {
  await expect(page.getByTestId('post-submit')).not.toContainText('保存中');
  await expect(page.getByTestId('post-content')).toHaveValue('');
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('hasSeenTour', 'true');
  });
});

test('Phase1: Survey create/publish/respond/assets', async ({ page }, testInfo) => {
  await ensureLoggedOut(page);
  await login(page, env.admin);
  await ensureStoreSelected(page);

  await page.locator('#nav-SURVEY').click();
  await expect(page.getByText('アンケート管理')).toBeVisible();

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
      await page.getByRole('button', { name: 'アーカイブ' }).click();

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
  await page.getByTestId('survey-positive-threshold').selectOption('4');
  await page.getByTestId('survey-create-draft').click();

  await expect(page.getByTestId('survey-publish')).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId('survey-publish').click();

  const publicUrlLocator = page.locator('p').filter({ hasText: '/#/survey/' }).first();
  const publishErrorHeading = page.getByRole('heading', { name: '公開エラー' }).first();
  const publishOutcome = await Promise.race([
    publicUrlLocator.waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'published' as const),
    publishErrorHeading.waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'error' as const),
  ]);
  if (publishOutcome === 'error') {
    const toastCard = publishErrorHeading.locator('..').locator('..');
    const toastMessage = (await toastCard.locator('p').first().textContent())?.trim() || '';

    const constraintText = '公開中アンケートはユーザーごとに1件までです。';
    if (toastMessage.includes(constraintText)) {
      // Try once more: archive any published [AUDIT] survey in the current list and re-publish.
      await archivePublishedAuditSurveysInList();
      await page.getByTestId('survey-publish').click();
      await expect(publicUrlLocator).toBeVisible({ timeout: 20_000 });
    } else {
      throw new Error(`Survey publish failed: ${toastMessage || '公開に失敗しました。'}`);
    }
  }

  const publicUrl = (await publicUrlLocator.textContent())?.trim();
  if (!publicUrl) throw new Error('Public survey URL not found after publish.');

  // Submit responses (positive + negative) to validate branching + metrics.
  await page.goto(publicUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '5' }).click();
  await page.getByRole('button', { name: '回答を送信する' }).click();
  await expect(page.getByText('ご回答ありがとうございました')).toBeVisible();

  // Re-answer on the same public URL. `page.goto()` to the same hash URL can be a no-op in SPA state,
  // so force a full reload to reset the page state.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '3' }).click();
  await page.getByRole('button', { name: '回答を送信する' }).click();
  await expect(page.getByText('ご回答ありがとうございました')).toBeVisible();

  // Return to app and validate CSV contains branch_type.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#nav-SURVEY')).toBeVisible();
  await page.locator('#nav-SURVEY').click();

  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('survey-download-csv').click(),
  ]).then(([dl]) => dl);
  const csvPath = testInfo.outputPath('survey_responses.csv');
  await download.saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, 'utf8');
  expect(csv).toContain('branch_type');
  expect(csv).toMatch(/POSITIVE/);
  expect(csv).toMatch(/NEGATIVE/);

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

  await page.locator('#nav-CREATE_POST').click();
  await expect(page.getByRole('heading', { name: '新規投稿作成' })).toBeVisible();
  await page.getByRole('button', { name: 'FACEBOOK' }).click();
  await page.getByTestId('post-content').fill(approveContent);
  await page.getByTestId('post-submit').click();
  await waitForPostSaved(page);

  await page.getByRole('button', { name: 'FACEBOOK' }).click();
  await page.getByTestId('post-content').fill(rejectContent);
  await page.getByTestId('post-submit').click();
  await waitForPostSaved(page);

  await logout(page);

  page.on('dialog', (dialog) => {
    const message = dialog.message();
    if (message.includes('差し戻し理由')) {
      void dialog.accept('[AUDIT] reject reason');
      return;
    }
    void dialog.accept();
  });

  await login(page, env.manager);
  await ensureStoreSelected(page);

  await page.locator('#nav-POST_LIST').click();
  await expect(page.getByText('投稿管理')).toBeVisible();

  const approveRow = page.locator('tr', { hasText: approveContent });
  await expect(approveRow).toBeVisible();
  await approveRow.getByRole('button', { name: '承認' }).click();

  const rejectRow = page.locator('tr', { hasText: rejectContent });
  await expect(rejectRow).toBeVisible();
  await rejectRow.getByRole('button', { name: '差し戻し' }).click();

  // Ensure history opens (P1-07) and is not empty.
  await approveRow.getByRole('button', { name: '履歴' }).click();
  await expect(page.getByText('差し戻しコメント履歴')).toBeVisible();
  await expect(page.getByText('履歴はまだありません。')).not.toBeVisible();

  await logout(page);
});

test('Phase1: Store group CRUD + per-user controls + CSV import', async ({ page }, testInfo) => {
  await ensureLoggedOut(page);
  await login(page, env.admin);
  await ensureStoreSelected(page);

  await page.locator('#nav-USER_MANAGEMENT').click();
  await expect(page.getByText('ユーザー・契約管理')).toBeVisible();

  // Create store group with the first store only (minimal).
  await page.getByTestId('store-group-add').click();
  await expect(page.getByText('店舗グループ作成')).toBeVisible();
  const groupModal = page.getByTestId('store-group-modal');
  const groupName = `[AUDIT] ${runId} group`;
  await page.getByTestId('store-group-name').fill(groupName);
  await groupModal.locator('input[type="checkbox"]').first().check();
  await page.getByTestId('store-group-save').click();
  await expect(page.getByText(groupName)).toBeVisible();

  // P1-09: bulk apply a visibility setting to the group.
  const bulkGroupSelect = page.getByTestId('store-group-bulk-group-select');
  const bulkOption = bulkGroupSelect.locator('option').filter({ hasText: groupName }).first();
  const bulkGroupId = await bulkOption.getAttribute('value');
  if (bulkGroupId) {
    await bulkGroupSelect.selectOption(bulkGroupId);
  }
  await page.getByTestId('store-group-bulk-state-select').selectOption('ADMIN_ONLY');
  await page.getByTestId('store-group-bulk-apply').click();
  await expect(page.getByText('一括設定完了')).toBeVisible();

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

  // Build a valid CSV (1 row) and execute import.
  const csvBody = [
    'store_name,address,phone,category,business_hours,website,note',
    `"${groupName} store","Tokyo","03-1234-9999","Cafe","Mon:10:00-19:00","","audit"`,
    '',
  ].join('\n');
  const csvPath = testInfo.outputPath('stores.csv');
  fs.writeFileSync(csvPath, csvBody, 'utf8');

  await page.getByTestId('store-csv-file-input').setInputFiles(csvPath);
  await expect(page.getByText(/CSV検証OK/)).toBeVisible();

  await page.getByTestId('store-csv-execute').click();
  await expect(page.getByText(/CSV実行中/)).toBeVisible();
  await expect(page.getByText(/CSV実行中/)).not.toBeVisible({ timeout: 120_000 });

  // Invalid CSV should surface validation errors (overall failure).
  const invalidCsvBody = ['store_name,address,phone,category,business_hours,website,note', '"","",,,', ''].join('\n');
  const invalidCsvPath = testInfo.outputPath('stores_invalid.csv');
  fs.writeFileSync(invalidCsvPath, invalidCsvBody, 'utf8');
  await page.getByTestId('store-csv-file-input').setInputFiles(invalidCsvPath);
  await expect(page.getByText('CSV検証エラー（先頭20件）')).toBeVisible();

  await logout(page);
});
