import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureAuditUsers } from './bootstrapUsers';
import { runDbAuditPhase1 } from './dbAuditPhase1';
import { runDbAuditPhase2 } from './dbAuditPhase2';
import { runDbAuditPhase3 } from './dbAuditPhase3';
import { runDbAuditPhase4 } from './dbAuditPhase4';
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
  phase: 'phase1' | 'phase2' | 'phase3' | 'phase4';
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

const runE2ePhase = async (params: {
  repoRoot: string;
  phase: 'phase1' | 'phase2' | 'phase3' | 'phase4';
  baseUrl: string;
  outputDir: string;
}): Promise<PhaseAuditE2eResult> => {
  const artifactsDir = path.join(params.outputDir, 'C_e2e');
  const logsDir = path.join(artifactsDir, 'logs');
  await ensureDir(logsDir);

  const stdoutLogPath = path.join(logsDir, 'playwright.stdout.log');
  const stderrLogPath = path.join(logsDir, 'playwright.stderr.log');
  const installStdoutLogPath = path.join(logsDir, 'playwright.install.stdout.log');
  const installStderrLogPath = path.join(logsDir, 'playwright.install.stderr.log');

  const startedAt = new Date();

  const shouldInstallPlaywrightBrowsers = (run: { stdout: string; stderr: string }): boolean => {
    const combined = `${run.stdout}\n${run.stderr}`;
    return (
      combined.includes('playwright install') &&
      (combined.includes('Executable doesn') ||
        combined.includes('browserType.launch') ||
        combined.includes('Please run') ||
        combined.includes('Missing browser'))
    );
  };

  const runPlaywright = async () =>
    runCommand({
      cwd: params.repoRoot,
      command: 'npm',
      args: ['run', `audit:e2e:${params.phase}`, '--', '--max-failures=1'],
      env: {
        AUDIT_BASE_URL: params.baseUrl,
        AUDIT_OUTPUT_DIR: artifactsDir,
      },
      timeoutMs: 25 * 60 * 1000,
    });

  let res = await runPlaywright();
  if (res.exitCode !== 0 && shouldInstallPlaywrightBrowsers(res)) {
    const installRes = await runCommand({
      cwd: params.repoRoot,
      command: 'npx',
      args: ['playwright', 'install', 'chromium'],
      timeoutMs: 15 * 60 * 1000,
    });
    await writeTextFile(installStdoutLogPath, installRes.stdout);
    await writeTextFile(installStderrLogPath, installRes.stderr);

    res = await runPlaywright();
  }

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
  const phase =
    phaseArg === 'phase1' || phaseArg === 'phase2' || phaseArg === 'phase3' || phaseArg === 'phase4'
      ? phaseArg
      : null;
  if (!phase) {
    throw new Error(`Usage: tsx scripts/audit/runPhaseAudit.ts <phase1|phase2|phase3|phase4>`);
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
      dbAudit =
        phase === 'phase1'
          ? await runDbAuditPhase1({
              repoRoot,
              outputDir: path.join(outputDir, 'B_db'),
            })
          : phase === 'phase2'
            ? await runDbAuditPhase2({
                repoRoot,
                outputDir: path.join(outputDir, 'B_db'),
              })
            : phase === 'phase3'
              ? await runDbAuditPhase3({
                  repoRoot,
                  outputDir: path.join(outputDir, 'B_db'),
                })
              : await runDbAuditPhase4({
                  repoRoot,
                  outputDir: path.join(outputDir, 'B_db'),
                });
    } catch (error) {
      await writeTextFile(path.join(outputDir, 'B_db', 'dbAudit.exception.log'), String(error));
      dbAudit = null;
    }
  }

  let bootstrapUsers: PhaseAuditSummary['bootstrapUsers'] = null;
  if (staticAudit.ok && dbAudit?.ok) {
    bootstrapUsers = await ensureAuditUsers({
      repoRoot,
      outputDir: path.join(outputDir, 'preflight_users'),
    });
  }

  let e2eAudit: PhaseAuditSummary['e2eAudit'] = null;
  if (staticAudit.ok && dbAudit?.ok && bootstrapUsers?.ok) {
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
      e2eAudit = await runE2ePhase({ repoRoot, phase, baseUrl, outputDir });
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
  const ok = Boolean(staticAudit.ok && dbAudit?.ok && bootstrapUsers?.ok && e2eAudit?.ok);

  const summary: PhaseAuditSummary = {
    phase,
    ok,
    gitSha,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    outputDir,
    staticAudit,
    dbAudit,
    bootstrapUsers,
    e2eAudit,
  };

  await writeJsonFile(path.join(outputDir, 'phaseAudit.summary.json'), summary);

  await appendPhaseAuditLog({ repoRoot, summary });
  await commitAndPushAuditLog({ repoRoot, phase, ok });

  process.exit(ok ? 0 : 1);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    if (error instanceof Error) {
      // Keep output user-friendly by default. Opt-in stack via AUDIT_DEBUG=1.
      console.error(error.message);
      if (process.env.AUDIT_DEBUG === '1' && error.stack) {
        console.error(error.stack);
      }
    } else {
      console.error(String(error));
    }
    process.exit(1);
  });
}
