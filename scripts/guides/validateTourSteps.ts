import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VIEW_STATES = [
  'DASHBOARD',
  'BILLING',
  'CALENDAR',
  'SURVEY',
  'CREATE_POST',
  'POST_LIST',
  'INBOX',
  'RANK_TRACKER',
  'USER_MANAGEMENT',
  'SETTINGS',
] as const;

const ALLOWED_POSITIONS = new Set(['top', 'bottom', 'left', 'right', 'center']);

type JsonObject = Record<string, unknown>;

const fail = (message: string): never => {
  throw new Error(`[guides:validate] ${message}`);
};

const ensureString = (value: unknown, path: string) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${path} は空でない文字列が必要です`);
  }
};

const ensureStep = (value: unknown, path: string) => {
  if (!value || typeof value !== 'object') fail(`${path} はオブジェクトである必要があります`);
  const step = value as JsonObject;
  ensureString(step.title, `${path}.title`);
  ensureString(step.content, `${path}.content`);
  if (step.id !== undefined) ensureString(step.id, `${path}.id`);
  if (step.targetId !== undefined) ensureString(step.targetId, `${path}.targetId`);
  if (step.position !== undefined) {
    ensureString(step.position, `${path}.position`);
    if (!ALLOWED_POSITIONS.has(step.position as string)) {
      fail(`${path}.position は ${Array.from(ALLOWED_POSITIONS).join(', ')} のいずれかにしてください`);
    }
  }
};

const validate = () => {
  const jsonPath = resolve(process.cwd(), 'components/guides/tourSteps.json');
  const source = readFileSync(jsonPath, 'utf-8');
  const parsed = JSON.parse(source) as JsonObject;

  const pageSummaryByView = parsed.pageSummaryByView as JsonObject;
  const sidebarSteps = parsed.sidebarSteps as unknown[];
  const pageStepsByView = parsed.pageStepsByView as JsonObject;

  if (!pageSummaryByView || typeof pageSummaryByView !== 'object') {
    fail('pageSummaryByView が見つかりません');
  }
  if (!Array.isArray(sidebarSteps) || sidebarSteps.length === 0) {
    fail('sidebarSteps は1件以上の配列である必要があります');
  }
  if (!pageStepsByView || typeof pageStepsByView !== 'object') {
    fail('pageStepsByView が見つかりません');
  }

  for (const [index, step] of sidebarSteps.entries()) {
    ensureStep(step, `sidebarSteps[${index}]`);
    const maybeId = (step as JsonObject).id;
    if (typeof maybeId !== 'string' || maybeId.trim().length === 0) {
      fail(`sidebarSteps[${index}].id は必須です`);
    }
  }

  for (const view of VIEW_STATES) {
    ensureString(pageSummaryByView[view], `pageSummaryByView.${view}`);
    const steps = pageStepsByView[view];
    if (!Array.isArray(steps) || steps.length === 0) {
      fail(`pageStepsByView.${view} は1件以上の配列である必要があります`);
    }
    const typedSteps = steps as unknown[];
    for (const [index, step] of typedSteps.entries()) {
      ensureStep(step, `pageStepsByView.${view}[${index}]`);
    }
  }

  console.log(`[guides:validate] OK: ${VIEW_STATES.length} view(s), ${sidebarSteps.length} sidebar step(s)`);
};

validate();
