import path from 'node:path';
import { defineConfig } from '@playwright/test';

const baseURL = process.env.AUDIT_BASE_URL || 'http://localhost:3000';

const resolveOutputDir = (): string => {
  const root = process.env.AUDIT_OUTPUT_DIR;
  if (!root) return path.join(process.cwd(), 'test-results');
  return path.join(root, 'playwright');
};

export default defineConfig({
  testDir: './scripts/audit/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  outputDir: resolveOutputDir(),
  use: {
    baseURL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
  },
});

