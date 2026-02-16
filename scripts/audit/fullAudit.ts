import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDir, formatTimestampForPath, runCommand, writeJsonFile, writeTextFile } from './lib';

type FullAuditStep = {
  id: string;
  command: string;
  args: string[];
  timeoutMs?: number;
};

type FullAuditStepResult = {
  id: string;
  command: string;
  args: string[];
  exitCode: number;
  durationMs: number;
  stdoutLogPath: string;
  stderrLogPath: string;
};

type FullAuditSummary = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  outputDir: string;
  failedStepId: string | null;
  steps: FullAuditStepResult[];
};

const STEPS: FullAuditStep[] = [
  { id: 'audit:static', command: 'npm', args: ['run', 'audit:static'], timeoutMs: 30 * 60 * 1000 },
  { id: 'audit:db:phase1', command: 'npm', args: ['run', 'audit:db:phase1'] },
  { id: 'audit:db:phase2', command: 'npm', args: ['run', 'audit:db:phase2'] },
  { id: 'audit:db:phase3', command: 'npm', args: ['run', 'audit:db:phase3'] },
  { id: 'audit:db:phase4', command: 'npm', args: ['run', 'audit:db:phase4'] },
  { id: 'audit:db:users', command: 'npm', args: ['run', 'audit:db:users'] },
  { id: 'audit:db:management-units', command: 'npm', args: ['run', 'audit:db:management-units'] },
  { id: 'audit:db:billing-store-plans', command: 'npm', args: ['run', 'audit:db:billing-store-plans'] },
  { id: 'audit:edge:jwt', command: 'npm', args: ['run', 'audit:edge:jwt'] },
  { id: 'audit:bootstrap:users', command: 'npm', args: ['run', 'audit:bootstrap:users'] },
  { id: 'audit:api:user-provisioning', command: 'npm', args: ['run', 'audit:api:user-provisioning'] },
  { id: 'audit:e2e:phase1', command: 'npm', args: ['run', 'audit:e2e:phase1'], timeoutMs: 30 * 60 * 1000 },
  { id: 'audit:e2e:phase2', command: 'npm', args: ['run', 'audit:e2e:phase2'], timeoutMs: 30 * 60 * 1000 },
  { id: 'audit:e2e:phase3', command: 'npm', args: ['run', 'audit:e2e:phase3'], timeoutMs: 30 * 60 * 1000 },
  { id: 'audit:e2e:phase4', command: 'npm', args: ['run', 'audit:e2e:phase4'], timeoutMs: 30 * 60 * 1000 },
  { id: 'audit:e2e:users', command: 'npm', args: ['run', 'audit:e2e:users'], timeoutMs: 30 * 60 * 1000 },
  { id: 'audit:e2e:header-multiselect', command: 'npm', args: ['run', 'audit:e2e:header-multiselect'], timeoutMs: 30 * 60 * 1000 },
  { id: 'audit:e2e:multi-store-db-views', command: 'npm', args: ['run', 'audit:e2e:multi-store-db-views'], timeoutMs: 30 * 60 * 1000 },
  { id: 'audit:e2e:platform-single-store', command: 'npm', args: ['run', 'audit:e2e:platform-single-store'], timeoutMs: 30 * 60 * 1000 },
  { id: 'audit:e2e:store-management-user-edit', command: 'npm', args: ['run', 'audit:e2e:store-management-user-edit'], timeoutMs: 30 * 60 * 1000 },
  { id: 'audit:deploy-ready', command: 'npm', args: ['run', 'audit:deploy-ready'], timeoutMs: 15 * 60 * 1000 },
];

const main = async () => {
  const repoRoot = process.cwd();
  const startedAt = new Date();
  const ts = formatTimestampForPath(startedAt);
  const outputDir = path.join(repoRoot, 'output', 'audit', 'full', ts);
  await ensureDir(outputDir);

  const results: FullAuditStepResult[] = [];
  let failedStepId: string | null = null;

  for (const step of STEPS) {
    // eslint-disable-next-line no-console
    console.log(`[audit:full] running ${step.id}`);
    const result = await runCommand({
      cwd: repoRoot,
      command: step.command,
      args: step.args,
      timeoutMs: step.timeoutMs,
      env: {
        AUDIT_AUTO_COMMIT: process.env.AUDIT_AUTO_COMMIT || '0',
      },
    });
    const stdoutLogPath = path.join(outputDir, `${step.id}.stdout.log`);
    const stderrLogPath = path.join(outputDir, `${step.id}.stderr.log`);
    await writeTextFile(stdoutLogPath, result.stdout);
    await writeTextFile(stderrLogPath, result.stderr);

    results.push({
      id: step.id,
      command: step.command,
      args: step.args,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdoutLogPath,
      stderrLogPath,
    });
    if (result.exitCode !== 0) {
      failedStepId = step.id;
      break;
    }
  }

  const finishedAt = new Date();
  const summary: FullAuditSummary = {
    ok: failedStepId === null,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    outputDir,
    failedStepId,
    steps: results,
  };
  await writeJsonFile(path.join(outputDir, 'summary.json'), summary);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.ok ? 0 : 1);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
