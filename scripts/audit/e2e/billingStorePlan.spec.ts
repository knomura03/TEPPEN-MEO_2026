import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type AuditCreds = {
  email: string;
  password: string;
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

const loadCreds = (): { admin: AuditCreds; manager: AuditCreds } => {
  const envPath = path.join(process.cwd(), '.env.audit.local');
  if (!fs.existsSync(envPath)) {
    throw new Error('Missing .env.audit.local.');
  }
  const env = loadDotEnvFileSync(envPath);
  return {
    admin: {
      email: requireEnv(env, 'AUDIT_ADMIN_EMAIL'),
      password: requireEnv(env, 'AUDIT_ADMIN_PASSWORD'),
    },
    manager: {
      email: requireEnv(env, 'AUDIT_MANAGER_EMAIL'),
      password: requireEnv(env, 'AUDIT_MANAGER_PASSWORD'),
    },
  };
};

const creds = loadCreds();

const login = async (page: Page, cred: AuditCreds) => {
  await page.addInitScript(() => {
    localStorage.setItem('hasSeenTour', 'true');
  });
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"], input[type="email"]').first().fill(cred.email);
  await page.locator('input[name="password"], input[type="password"]').first().fill(cred.password);
  await page.locator('button[type="submit"], [data-testid="login-submit"]').first().click();
  await expect(page.locator('#nav-DASHBOARD')).toBeVisible();
};

test('ADMINは店舗プラン割当UIを操作できる', async ({ page }) => {
  await login(page, creds.admin);
  await page.goto('/?view=BILLING', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('店舗へのプラン割当')).toBeVisible();
  await expect(page.getByRole('button', { name: /この店舗に割当|予約切替を登録/ })).toBeVisible();
});

test('MANAGERには内部プラン管理UIが表示されない', async ({ page }) => {
  await login(page, creds.manager);
  await page.goto('/?view=BILLING', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('内部: 契約プラン管理')).toHaveCount(0);
});
