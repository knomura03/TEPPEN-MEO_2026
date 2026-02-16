import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDir, formatTimestampForPath, loadDotEnvFile, runCommand, writeJsonFile } from './lib';

type DeployReadinessResult = {
  ready: boolean;
  checkedAt: string;
  projectRef: string;
  blockingIssues: string[];
  warnings: string[];
  diagnostics: {
    migrationListExitCode: number;
    functionsListExitCode: number;
    edgeJwtProbeExitCode: number;
  };
};

const REQUIRED_EDGE_FUNCTIONS = [
  'dashboard-metrics',
  'inbox-sync',
  'facebook-reply-message',
  'instagram-reply-comment',
  'gbp-reply-review',
  'inbox-apply-reaction',
  'post-publish-run',
  'scheduled-post-publisher',
  'provider-posts-fetch',
  'oauth-start',
  'oauth-callback',
  'admin-create-user',
  'admin-auth-link',
  'admin-user-update',
  'admin-user-delete',
  'admin-user-attach-existing',
  'group-create',
  'group-rename',
  'admin-store-subscription-set-plan',
];

const parseProjectRef = (supabaseUrl: string): string => {
  try {
    const parsed = new URL(supabaseUrl);
    const hostname = parsed.hostname || '';
    const projectRef = hostname.split('.')[0] || '';
    if (!projectRef) throw new Error('missing hostname');
    return projectRef;
  } catch (error) {
    throw new Error(`VITE_SUPABASE_URL から project ref を解決できませんでした: ${supabaseUrl} (${String(error)})`);
  }
};

const parseMigrationMismatches = (stdout: string): string[] => {
  const issues: string[] = [];
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*(\d{12})?\s*\|\s*(\d{12})?\s*\|\s*(\d{12})?\s*$/);
    if (!match) continue;
    const local = (match[1] || '').trim();
    const remote = (match[2] || '').trim();
    if (!local && !remote) continue;
    if (!local || !remote || local !== remote) {
      issues.push(`migration mismatch: local=${local || '(none)'} remote=${remote || '(none)'}`);
    }
  }
  return issues;
};

const parseFunctionsStatus = (stdout: string): Map<string, string> => {
  const map = new Map<string, string>();
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const cols = line.split('|').map((col) => col.trim());
    if (cols.length < 5) continue;
    if (!/^[0-9a-f-]{36}$/i.test(cols[0] || '')) continue;
    const slug = cols[2] || '';
    const status = cols[3] || '';
    if (slug) map.set(slug, status);
  }
  return map;
};

export const runDeployReadiness = async (params?: { repoRoot?: string; outputDir?: string }): Promise<DeployReadinessResult> => {
  const repoRoot = params?.repoRoot || process.cwd();
  const ts = formatTimestampForPath(new Date());
  const outputDir =
    params?.outputDir ||
    path.join(repoRoot, 'output', 'audit', '_adhoc', 'deploy_readiness', ts);
  await ensureDir(outputDir);

  const localEnv = await loadDotEnvFile(path.join(repoRoot, '.env.local'));
  const supabaseUrl = localEnv.VITE_SUPABASE_URL || '';
  if (!supabaseUrl) {
    throw new Error('VITE_SUPABASE_URL が未設定です。');
  }
  const projectRef = parseProjectRef(supabaseUrl);

  const blockingIssues: string[] = [];
  const warnings: string[] = [];

  const migrationList = await runCommand({
    cwd: repoRoot,
    command: 'supabase',
    args: ['migration', 'list', '--linked'],
    timeoutMs: 120_000,
  });
  if (migrationList.exitCode !== 0) {
    blockingIssues.push(`supabase migration list --linked failed: ${migrationList.stderr || migrationList.stdout}`);
  } else {
    blockingIssues.push(...parseMigrationMismatches(migrationList.stdout));
  }
  if (`${migrationList.stdout}\n${migrationList.stderr}`.includes('A new version of Supabase CLI is available')) {
    warnings.push('Supabase CLIの更新案内が出ています。必要に応じて更新してください。');
  }

  const functionsList = await runCommand({
    cwd: repoRoot,
    command: 'supabase',
    args: ['functions', 'list', '--project-ref', projectRef],
    timeoutMs: 120_000,
  });
  if (functionsList.exitCode !== 0) {
    blockingIssues.push(`supabase functions list failed: ${functionsList.stderr || functionsList.stdout}`);
  } else {
    const statusBySlug = parseFunctionsStatus(functionsList.stdout);
    for (const functionName of REQUIRED_EDGE_FUNCTIONS) {
      const status = statusBySlug.get(functionName);
      if (!status) {
        blockingIssues.push(`required function is missing: ${functionName}`);
        continue;
      }
      if (status !== 'ACTIVE') {
        blockingIssues.push(`required function is not ACTIVE: ${functionName} (${status})`);
      }
    }
  }

  const edgeJwtProbe = await runCommand({
    cwd: repoRoot,
    command: 'npm',
    args: ['run', 'audit:edge:jwt'],
    timeoutMs: 240_000,
  });
  if (edgeJwtProbe.exitCode !== 0) {
    blockingIssues.push('edge JWT到達性監査に失敗しました（npm run audit:edge:jwt）。');
  }

  const result: DeployReadinessResult = {
    ready: blockingIssues.length === 0,
    checkedAt: new Date().toISOString(),
    projectRef,
    blockingIssues,
    warnings,
    diagnostics: {
      migrationListExitCode: migrationList.exitCode,
      functionsListExitCode: functionsList.exitCode,
      edgeJwtProbeExitCode: edgeJwtProbe.exitCode,
    },
  };

  await writeJsonFile(path.join(outputDir, 'deployReadiness.result.json'), result);
  await writeJsonFile(path.join(outputDir, 'migration.list.stdout.json'), {
    stdout: migrationList.stdout,
    stderr: migrationList.stderr,
    exitCode: migrationList.exitCode,
  });
  await writeJsonFile(path.join(outputDir, 'functions.list.stdout.json'), {
    stdout: functionsList.stdout,
    stderr: functionsList.stderr,
    exitCode: functionsList.exitCode,
  });
  await writeJsonFile(path.join(outputDir, 'edge.jwt.stdout.json'), {
    stdout: edgeJwtProbe.stdout,
    stderr: edgeJwtProbe.stderr,
    exitCode: edgeJwtProbe.exitCode,
  });

  return result;
};

const main = async () => {
  const result = await runDeployReadiness();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ready ? 0 : 1);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
