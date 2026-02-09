import fs from 'node:fs/promises';
import path from 'node:path';

import { ensureDir, writeTextFile } from './lib';
import { StaticAuditResult } from './staticAudit';
import { AuditBootstrapUsersResult } from './bootstrapUsers';

export type PhaseAuditE2eResult = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  stdoutLogPath: string;
  stderrLogPath: string;
  artifactsDir: string;
};

export type PhaseAuditSummary = {
  phase: 'phase1' | 'phase2' | 'phase3' | 'phase4';
  ok: boolean;
  gitSha: string;
  startedAt: string;
  finishedAt: string;
  outputDir: string;
  staticAudit: StaticAuditResult;
  dbAudit?: DbAuditGenericResult | null;
  bootstrapUsers?: AuditBootstrapUsersResult | null;
  e2eAudit?: PhaseAuditE2eResult | null;
};

export type DbAuditCheckResultLike = {
  name: string;
  ok: boolean;
  kind: string;
  table?: string;
  columns?: string;
  fn?: string;
  error?: {
    message: string;
    code?: string;
    details?: string;
    hint?: string;
  };
};

export type DbAuditGenericResult = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  checks: DbAuditCheckResultLike[];
};

const fmtMs = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 100) / 10;
  return `${sec}s`;
};

const summarizeStatic = (result: StaticAuditResult): string => {
  const parts = result.commands.map((cmd) => {
    const name = cmd.args.join(' ');
    return `${name}=${cmd.exitCode === 0 ? 'OK' : `FAIL(${cmd.exitCode})`}(${fmtMs(cmd.durationMs)})`;
  });
  return parts.join(', ');
};

const pickFirstFailure = <T extends { ok: boolean }>(items: T[]): T | null => {
  for (const item of items) {
    if (!item.ok) return item;
  }
  return null;
};

const summarizeDb = (result: DbAuditGenericResult): string => {
  if (result.ok) return `PASS (${result.checks.length} checks)`;
  const first = pickFirstFailure(result.checks);
  if (!first) return 'FAIL';
  const code = first.error?.code ? ` code=${first.error.code}` : '';
  return `FAIL (${first.name}${code}: ${first.error?.message || 'unknown error'})`;
};

const toRelative = (repoRoot: string, p: string): string => {
  const rel = path.relative(repoRoot, p);
  if (!rel || rel.startsWith('..')) return p;
  return rel;
};

const buildEntryMarkdown = (params: { repoRoot: string; summary: PhaseAuditSummary }): string => {
  const { repoRoot, summary } = params;
  const started = new Date(summary.startedAt);
  const label = summary.ok ? 'PASS' : 'FAIL';
  const outputRel = toRelative(repoRoot, summary.outputDir);
  const staticRel = toRelative(repoRoot, path.join(summary.outputDir, 'A_static'));
  const dbRel = toRelative(repoRoot, path.join(summary.outputDir, 'B_db'));
  const bootstrapRel = toRelative(repoRoot, path.join(summary.outputDir, 'preflight_users'));

  const lines: string[] = [];
  lines.push(`## ${started.toISOString()} ${summary.phase.toUpperCase()} ${label}`);
  lines.push('');
  lines.push(`- command: \`npm run audit:${summary.phase}\``);
  lines.push(`- commit: \`${summary.gitSha}\``);
  lines.push(`- output: \`${outputRel}\``);
  lines.push(`- A(static): ${summary.staticAudit.ok ? 'PASS' : 'FAIL'} (${summarizeStatic(summary.staticAudit)})`);
  if (summary.dbAudit) {
    lines.push(`- B(db): ${summarizeDb(summary.dbAudit)}`);
    lines.push(`  - logs: \`${dbRel}\``);
  } else {
    lines.push(`- B(db): SKIPPED`);
  }
  if (summary.bootstrapUsers) {
    const info = summary.bootstrapUsers.ok ? 'PASS' : `FAIL: ${summary.bootstrapUsers.error || 'unknown error'}`;
    lines.push(`- preflight(users): ${info}`);
    lines.push(`  - logs: \`${bootstrapRel}\``);
  } else {
    lines.push(`- preflight(users): SKIPPED`);
  }
  if (summary.e2eAudit) {
    const e2eRel = toRelative(repoRoot, summary.e2eAudit.artifactsDir);
    lines.push(
      `- C(e2e): ${summary.e2eAudit.ok ? 'PASS' : `FAIL(exit=${summary.e2eAudit.exitCode})`} (artifacts: \`${e2eRel}\`)`
    );
  } else {
    lines.push(`- C(e2e): SKIPPED`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
};

export const appendPhaseAuditLog = async (params: {
  repoRoot: string;
  summary: PhaseAuditSummary;
}): Promise<void> => {
  const logPath = path.join(params.repoRoot, 'docs', '14_PHASE_AUDIT_LOG.md');
  await ensureDir(path.dirname(logPath));

  let existing = '';
  try {
    existing = await fs.readFile(logPath, 'utf8');
  } catch {
    existing = '';
  }

  if (!existing.includes('## Entries')) {
    await writeTextFile(
      logPath,
      `# TEPPEN MEO: Phase Audit Log (AUTO)\n\n最終更新: ${new Date().toISOString().slice(0, 10)}\n\n---\n\n## Entries\n\n`
    );
    existing = await fs.readFile(logPath, 'utf8');
  }

  const entry = buildEntryMarkdown({ repoRoot: params.repoRoot, summary: params.summary });
  const next = existing.endsWith('\n') ? `${existing}${entry}` : `${existing}\n${entry}`;
  await writeTextFile(logPath, next);
};
