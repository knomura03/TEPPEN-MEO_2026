import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runDbAuditPhase1 } from './dbAuditPhase1';
import { ensureDir, formatTimestampForPath, loadDotEnvFile, runCommand, writeJsonFile, writeTextFile } from './lib';
import { appendPhaseAuditLog, PhaseAuditE2eResult, PhaseAuditSummary } from './report';
import { runStaticAudit } from './staticAudit';

const isLocalUrl = (baseUrl: string): boolean => {
  return (
    baseUrl.startsWith('http://localhost:') ||
    baseUrl.startsWith('http://127.0.0.1:') ||
    baseUrl.startsWith('http://0.0.0.0:') ||
    baseUrl === 'http://localhost' ||
    baseUrl === 'http://127.0.0.1'
  );
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const waitForHttpOk = async (url: string, timeoutMs: number): Promise<void> => {
  const startedAt = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for HTTP OK: ${url}`);
    }
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.ok) return;
    } catch {
      // ignore
    }
    await sleep(500);
  }
};

const killProcessGroup = async (pid: number): Promise<void> => {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    // ignore
  }
  await sleep(1200);
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // ignore
  }
};

const getGitSha = async (repoRoot: string): Promise<string> => {
  const res = await runCommand({ cwd: repoRoot, command: 'git', args: ['rev-parse', 'HEAD'] });
  if (res.exitCode !== 0) {
    throw new Error(`git rev-parse failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout.trim();
};

const commitAndPushAuditLog = async (params: {
  repoRoot: string;
  phase: 'phase1';
  ok: boolean;
}): Promise<void> => {
  const filePath = path.join('docs', '14_PHASE_AUDIT_LOG.md');
  await runCommand({ cwd: params.repoRoot, command: 'git', args: ['add', filePath] });

  const diff = await runCommand({
    cwd: params.repoRoot,
    command: 'git',
    args: ['diff', '--cached', '--name-only', '--', filePath],
  });
  if (diff.exitCode !== 0) return;
  if (!diff.stdout.trim()) return;

  const label = params.ok ? 'PASS' : 'FAIL';
  const commit = await runCommand({
    cwd: params.repoRoot,
    command: 'git',
    args: ['commit', '-m', `audit(${params.phase}): ${label}`],
  });
  if (commit.exitCode !== 0) {
    throw new Error(`git commit failed: ${commit.stderr || commit.stdout}`);
  }

  const push = await runCommand({ cwd: params.repoRoot, command: 'git', args: ['push'] });
  if (push.exitCode !== 0) {
    throw new Error(`git push failed: ${push.stderr || push.stdout}`);
  }
};

const runE2ePhase1 = async (params: {
  repoRoot: string;
  baseUrl: string;
  outputDir: string;
}): Promise<PhaseAuditE2eResult> => {
  const artifactsDir = path.join(params.outputDir, 'C_e2e');
  const logsDir = path.join(artifactsDir, 'logs');
  await ensureDir(logsDir);

  const stdoutLogPath = path.join(logsDir, 'playwright.stdout.log');
  const stderrLogPath = path.join(logsDir, 'playwright.stderr.log');

  const startedAt = new Date();

  const res = await runCommand({
    cwd: params.repoRoot,
    command: 'npm',
    args: ['run', 'audit:e2e:phase1', '--', '--max-failures=1'],
    env: {
      AUDIT_BASE_URL: params.baseUrl,
      AUDIT_OUTPUT_DIR: artifactsDir,
    },
    timeoutMs: 25 * 60 * 1000,
  });

  await writeTextFile(stdoutLogPath, res.stdout);
  await writeTextFile(stderrLogPath, res.stderr);

  const finishedAt = new Date();
  return {
    ok: res.exitCode === 0,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    exitCode: res.exitCode,
    stdoutLogPath,
    stderrLogPath,
    artifactsDir,
  };
};

const main = async (): Promise<void> => {
  const repoRoot = process.cwd();
  const phaseArg = process.argv[2] || '';
  const phase = phaseArg === 'phase1' ? 'phase1' : null;
  if (!phase) {
    throw new Error(`Usage: tsx scripts/audit/runPhaseAudit.ts phase1`);
  }

  const startedAt = new Date();
  const ts = formatTimestampForPath(startedAt);
  const outputDir = path.join(repoRoot, 'output', 'audit', phase, ts);
  await ensureDir(outputDir);

  const gitSha = await getGitSha(repoRoot);

  const envAudit = await loadDotEnvFile(path.join(repoRoot, '.env.audit.local'));
  const baseUrl = envAudit.AUDIT_BASE_URL || process.env.AUDIT_BASE_URL || 'http://localhost:3000';

  const runnerLogDir = path.join(outputDir, 'runner');
  await ensureDir(runnerLogDir);

  let devServerPid: number | null = null;
  let devServer: ReturnType<typeof spawn> | null = null;
  let devStdout: fs.WriteStream | null = null;
  let devStderr: fs.WriteStream | null = null;

  const staticAudit = await runStaticAudit({
    repoRoot,
    outputDir: path.join(outputDir, 'A_static'),
  });

  let dbAudit: PhaseAuditSummary['dbAudit'] = null;
  if (staticAudit.ok) {
    try {
      dbAudit = await runDbAuditPhase1({
        repoRoot,
        outputDir: path.join(outputDir, 'B_db'),
      });
    } catch (error) {
      await writeTextFile(path.join(outputDir, 'B_db', 'dbAudit.exception.log'), String(error));
      dbAudit = null;
    }
  }

  let e2eAudit: PhaseAuditSummary['e2eAudit'] = null;
  if (staticAudit.ok && dbAudit?.ok) {
    if (isLocalUrl(baseUrl)) {
      const devOutPath = path.join(runnerLogDir, 'devserver.stdout.log');
      const devErrPath = path.join(runnerLogDir, 'devserver.stderr.log');
      devStdout = fs.createWriteStream(devOutPath, { flags: 'a' });
      devStderr = fs.createWriteStream(devErrPath, { flags: 'a' });

      devServer = spawn('npm', ['run', 'dev'], {
        cwd: repoRoot,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
      devServerPid = devServer.pid ?? null;
      devServer.stdout?.pipe(devStdout);
      devServer.stderr?.pipe(devStderr);

      await waitForHttpOk(baseUrl, 90_000);
    }

    try {
      e2eAudit = await runE2ePhase1({ repoRoot, baseUrl, outputDir });
    } finally {
      if (devStdout) devStdout.end();
      if (devStderr) devStderr.end();
      if (devServerPid) {
        await killProcessGroup(devServerPid);
      } else if (devServer) {
        devServer.kill('SIGTERM');
      }
    }
  }

  const finishedAt = new Date();
  const ok = Boolean(staticAudit.ok && dbAudit?.ok && e2eAudit?.ok);

  const summary: PhaseAuditSummary = {
    phase,
    ok,
    gitSha,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    outputDir,
    staticAudit,
    dbAudit,
    e2eAudit,
  };

  await writeJsonFile(path.join(outputDir, 'phaseAudit.summary.json'), summary);

  await appendPhaseAuditLog({ repoRoot, summary });
  await commitAndPushAuditLog({ repoRoot, phase, ok });

  process.exit(ok ? 0 : 1);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}

