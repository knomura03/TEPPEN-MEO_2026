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

const loadAdminCreds = (): AuditCreds => {
  const envPath = path.join(process.cwd(), '.env.audit.local');
  if (!fs.existsSync(envPath)) {
    throw new Error('Missing .env.audit.local.');
  }
  const env = loadDotEnvFileSync(envPath);
  return {
    email: requireEnv(env, 'AUDIT_ADMIN_EMAIL'),
    password: requireEnv(env, 'AUDIT_ADMIN_PASSWORD'),
  };
};

const adminCreds = loadAdminCreds();

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

test('店舗グループUIが新規投稿とユーザー管理から消えている', async ({ page }) => {
  await login(page, adminCreds);

  await page.goto('/?view=CREATE_POST', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('text=店舗グループ')).toHaveCount(0);

  await page.goto('/?view=USER_MANAGEMENT', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('text=店舗グループ管理')).toHaveCount(0);
  await expect(page.locator('text=店舗グループ一括設定')).toHaveCount(0);
});
