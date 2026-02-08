import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export type CommandResult = {
  command: string;
  args: string[];
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
};

export const formatTimestampForPath = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}_${hh}${mm}${ss}`;
};

export const ensureDir = async (dirPath: string): Promise<void> => {
  await fs.mkdir(dirPath, { recursive: true });
};

export const writeTextFile = async (filePath: string, text: string): Promise<void> => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, text, 'utf8');
};

export const writeJsonFile = async (filePath: string, data: unknown): Promise<void> => {
  await writeTextFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
};

export const runCommand = async (params: {
  cwd: string;
  command: string;
  args: string[];
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
}): Promise<CommandResult> => {
  const startedAt = Date.now();
  const child = spawn(params.command, params.args, {
    cwd: params.cwd,
    env: { ...process.env, ...(params.env || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

  let timeout: NodeJS.Timeout | undefined;
  if (params.timeoutMs && params.timeoutMs > 0) {
    timeout = setTimeout(() => {
      child.kill('SIGKILL');
    }, params.timeoutMs);
  }

  const exitCode: number = await new Promise((resolve) => {
    child.on('close', (code) => resolve(code ?? 0));
  });

  if (timeout) clearTimeout(timeout);

  return {
    command: params.command,
    args: params.args,
    exitCode,
    durationMs: Date.now() - startedAt,
    stdout: Buffer.concat(stdoutChunks).toString('utf8'),
    stderr: Buffer.concat(stderrChunks).toString('utf8'),
  };
};

export const loadDotEnvFile = async (filePath: string): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  const raw = await fs.readFile(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (!key) continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
};

export const resolveRepoRoot = (): string => {
  return path.resolve(process.cwd());
};

