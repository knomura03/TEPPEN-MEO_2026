import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

type Relationship = {
  foreignKeyName: string;
  sourceTable: string;
  sourceColumns: string[];
  referencedTable: string;
  referencedColumns: string[];
  isOneToOne: boolean;
};

type TableModel = {
  name: string;
  relationships: Relationship[];
};

type DomainGroup = {
  key: string;
  title: string;
  description: string;
  tables: string[];
};

const repoRoot = process.cwd();
const outputPath = path.join(repoRoot, 'docs', '23_DATABASE_ERD.md');

const domainGroups: DomainGroup[] = [
  {
    key: 'core',
    title: 'Core（組織/ユーザー/店舗/設定）',
    description: '組織・店舗・ユーザー・機能公開・監査の基盤データ。',
    tables: [
      'organizations',
      'stores',
      'profiles',
      'memberships',
      'feature_flags',
      'audit_logs',
      'store_groups',
      'store_group_stores',
      'org_store_policies',
      'user_store_controls',
      'brand_kits',
    ],
  },
  {
    key: 'billing',
    title: 'Billing（契約プラン/請求）',
    description: 'プラン定義、組織契約、予約切替、利用実績、請求情報。',
    tables: [
      'billing_plans',
      'org_subscriptions',
      'org_subscription_plan_schedules',
      'subscription_usage_events',
      'billing_invoices',
    ],
  },
  {
    key: 'integrations',
    title: 'Integrations / OAuth（SNS連携）',
    description: '連携カタログ、店舗連携設定、シークレット、OAuthセッション、資格情報。',
    tables: [
      'provider_catalog',
      'provider_capabilities',
      'provider_configurations',
      'provider_secrets',
      'integrations',
      'integration_credentials',
      'oauth_sessions',
      'gbp_locations',
    ],
  },
  {
    key: 'operations',
    title: 'Operations（投稿/受信箱/アンケート/順位/PWA）',
    description: '日常運用データ（投稿、受信、アンケート、順位計測、PWA）。',
    tables: [
      'posts',
      'post_media',
      'post_publish_logs',
      'post_approval_comments',
      'post_templates',
      'inbox_threads',
      'inbox_messages',
      'inbox_reply_logs',
      'surveys',
      'survey_responses',
      'survey_events',
      'rank_keywords',
      'rank_collection_runs',
      'rank_collection_results',
      'competitor_targets',
      'competitor_metric_snapshots',
      'nap_consistency_runs',
      'nap_consistency_results',
      'nap_alerts',
      'pwa_installations',
    ],
  },
];

const runCommand = async (command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
    child.on('close', (code) => {
      resolve({
        code: code ?? 0,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
    });
  });

const parseQuotedItems = (raw: string): string[] => {
  const items: string[] = [];
  const regex = /"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    items.push(match[1]);
  }
  return items;
};

const parseRelationshipsBlock = (block: string, sourceTable: string): Relationship[] => {
  const relationships: Relationship[] = [];
  const relRegex =
    /foreignKeyName:\s*"([^"]+)"[\s\S]*?columns:\s*\[([^\]]*)\][\s\S]*?isOneToOne:\s*(true|false)[\s\S]*?referencedRelation:\s*"([^"]+)"[\s\S]*?referencedColumns:\s*\[([^\]]*)\]/g;

  let match: RegExpExecArray | null;
  while ((match = relRegex.exec(block)) !== null) {
    relationships.push({
      foreignKeyName: match[1],
      sourceTable,
      sourceColumns: parseQuotedItems(match[2]),
      isOneToOne: match[3] === 'true',
      referencedTable: match[4],
      referencedColumns: parseQuotedItems(match[5]),
    });
  }
  return relationships;
};

const parseTableModels = (typesText: string): TableModel[] => {
  const lines = typesText.split(/\r?\n/);
  let inPublicTables = false;
  let activeTableName = '';
  let braceDepth = 0;
  const tableLines: string[] = [];
  const models: TableModel[] = [];

  for (const line of lines) {
    if (!inPublicTables) {
      if (line.trim() === 'Tables: {') {
        inPublicTables = true;
      }
      continue;
    }

    if (!activeTableName && line.trim() === 'Views: {') {
      break;
    }

    if (!activeTableName) {
      const matched = line.match(/^ {6}([a-z0-9_]+): \{$/);
      if (!matched) continue;
      activeTableName = matched[1];
      braceDepth = 1;
      tableLines.length = 0;
      tableLines.push(line);
      continue;
    }

    tableLines.push(line);
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    braceDepth += opens - closes;

    if (braceDepth === 0) {
      const block = tableLines.join('\n');
      models.push({
        name: activeTableName,
        relationships: parseRelationshipsBlock(block, activeTableName),
      });
      activeTableName = '';
      tableLines.length = 0;
    }
  }

  return models;
};

const createMermaidForGroup = (group: DomainGroup, modelMap: Map<string, TableModel>): string => {
  const inGroup = new Set(group.tables);
  const relationLines = new Set<string>();

  for (const tableName of group.tables) {
    const model = modelMap.get(tableName);
    if (!model) continue;
    for (const rel of model.relationships) {
      if (!inGroup.has(rel.referencedTable)) continue;
      const connector = rel.isOneToOne ? '||--||' : '||--o{';
      relationLines.add(
        `  ${rel.referencedTable} ${connector} ${rel.sourceTable} : "${rel.foreignKeyName}"`
      );
    }
  }

  const lines: string[] = ['```mermaid', 'erDiagram'];
  for (const tableName of group.tables) {
    lines.push(`  ${tableName} {`);
    lines.push('    uuid id');
    lines.push('  }');
  }
  if (relationLines.size === 0) {
    lines.push('  %% no relationship lines in this group');
  } else {
    lines.push(...Array.from(relationLines).sort());
  }
  lines.push('```');
  return lines.join('\n');
};

const buildDocument = (tableModels: TableModel[]): string => {
  const modelMap = new Map<string, TableModel>(tableModels.map((model) => [model.name, model]));
  const allTables = new Set(tableModels.map((model) => model.name));
  const coveredTables = new Set(domainGroups.flatMap((group) => group.tables));
  const uncoveredTables = Array.from(allTables).filter((tableName) => !coveredTables.has(tableName)).sort();

  if (uncoveredTables.length > 0) {
    const operationsGroup = domainGroups.find((group) => group.key === 'operations');
    if (operationsGroup) {
      operationsGroup.tables.push(...uncoveredTables);
      operationsGroup.tables = Array.from(new Set(operationsGroup.tables)).sort();
    }
  }

  const sections: string[] = [
    '# TEPPEN MEO：Database ERD（Mermaid）',
    '',
    `最終更新: ${new Date().toISOString().slice(0, 10)}`,
    '',
    'このファイルは `npm run docs:erd` で再生成できます。',
    '',
  ];

  for (const group of domainGroups) {
    const normalizedTables = Array.from(new Set(group.tables)).sort();
    sections.push(`## ${group.title}`);
    sections.push('');
    sections.push(group.description);
    sections.push('');
    sections.push(`含めるテーブル: ${normalizedTables.join(', ')}`);
    sections.push('');
    sections.push(createMermaidForGroup({ ...group, tables: normalizedTables }, modelMap));
    sections.push('');
  }

  return `${sections.join('\n')}\n`;
};

const main = async () => {
  const commandResult = await runCommand('supabase', ['gen', 'types', 'typescript', '--linked', '--schema', 'public']);
  if (commandResult.code !== 0) {
    throw new Error(`supabase gen types failed: ${commandResult.stderr || commandResult.stdout}`);
  }

  const models = parseTableModels(commandResult.stdout);
  if (models.length === 0) {
    throw new Error('Tablesセクションの解析に失敗しました。');
  }

  const markdown = buildDocument(models);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, markdown, 'utf8');
  console.log(`[generateErd] generated: ${path.relative(repoRoot, outputPath)} (${models.length} tables)`);
};

void main().catch((error) => {
  console.error('[generateErd] failed:', error);
  process.exitCode = 1;
});
