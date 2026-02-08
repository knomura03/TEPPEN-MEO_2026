import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CommandResult, ensureDir, formatTimestampForPath, runCommand, writeJsonFile, writeTextFile } from './lib';

export type StaticAuditResult = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  commands: CommandResult[];
};

const buildOutputDir = (repoRoot: string): string => {
  const base = process.env.AUDIT_OUTPUT_DIR;
  if (base) return base;
  const ts = formatTimestampForPath(new Date());
  return path.join(repoRoot, 'output', 'audit', '_adhoc', 'static', ts);
};

export const runStaticAudit = async (params: {
  repoRoot: string;
  outputDir?: string;
}): Promise<StaticAuditResult> => {
  const outputDir = params.outputDir || buildOutputDir(params.repoRoot);
  await ensureDir(outputDir);

  const startedAt = new Date();
  const commands: { command: string; args: string[]; logName: string }[] = [
    { command: 'npm', args: ['run', 'typecheck'], logName: 'typecheck' },
    { command: 'npm', args: ['run', 'build'], logName: 'build' },
    { command: 'npm', args: ['run', 'smoke:contracts'], logName: 'smoke_contracts' },
  ];

  const results: CommandResult[] = [];
  for (const spec of commands) {
    const res = await runCommand({ cwd: params.repoRoot, command: spec.command, args: spec.args });
    results.push(res);
    await writeTextFile(path.join(outputDir, `${spec.logName}.stdout.log`), res.stdout);
    await writeTextFile(path.join(outputDir, `${spec.logName}.stderr.log`), res.stderr);
    if (res.exitCode !== 0) break;
  }

  const ok = results.every((r) => r.exitCode === 0) && results.length === commands.length;
  const finishedAt = new Date();
  const out: StaticAuditResult = {
    ok,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    commands: results,
  };
  await writeJsonFile(path.join(outputDir, 'staticAudit.json'), out);
  return out;
};

const main = async (): Promise<void> => {
  const repoRoot = process.cwd();
  const outputDir = buildOutputDir(repoRoot);
  const result = await runStaticAudit({ repoRoot, outputDir });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}

