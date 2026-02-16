import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

const requiredFiles = [
  'services/providerAdapterRegistry.ts',
  'services/providerReadinessService.ts',
  'services/featureFlagsService.ts',
  'services/postPublishService.ts',
  'services/messageReplyService.ts',
  'services/brandKitService.ts',
  'services/rankKeywordService.ts',
  'services/rankCollectionService.ts',
  'services/competitorService.ts',
  'services/napConsistencyService.ts',
  'services/napAlertService.ts',
  'components/Layout.tsx',
  'components/SettingsView.tsx',
  'components/PostList.tsx',
  'components/PostCreator.tsx',
  'components/RankTrackerView.tsx',
  'components/UnifiedInbox.tsx',
  'supabase/functions/rank-collect/index.ts',
  'supabase/functions/facebook-publish-post/index.ts',
  'supabase/functions/facebook-reply-message/index.ts',
  'supabase/migrations/202602060013_p2_inbox_advanced_workflow.sql',
  'supabase/migrations/202602060014_p2_template_brand_kit.sql',
  'supabase/migrations/202602060015_p3_rank_keyword_management.sql',
  'supabase/migrations/202602060016_p3_rank_daily_collection.sql',
  'supabase/migrations/202602060017_p3_competitor_comparison_collection.sql',
  'supabase/migrations/202602060018_p3_nap_consistency_check.sql',
  'supabase/migrations/202602060019_p3_nap_alert_operations.sql',
];

for (const file of requiredFiles) {
  const full = join(root, file);
  if (!existsSync(full)) {
    throw new Error(`Missing required phase0 file: ${file}`);
  }
}

const collectMissingToken = (file, token, sink) => {
  const text = readFileSync(join(root, file), 'utf8');
  if (!text.includes(token)) {
    sink.push({ file, token });
  }
};

const missingTokens = [];
const assertIncludes = (file, token) => collectMissingToken(file, token, missingTokens);

assertIncludes('services/providerAdapterRegistry.ts', 'registerProviderAdapter');
assertIncludes('services/providerAdapterRegistry.ts', 'resolveProviderAdapter');
assertIncludes('services/providerReadinessService.ts', 'testMode');
assertIncludes('services/providerReadinessService.ts', 'runtimeMode');
assertIncludes('services/featureFlagsService.ts', 'resolveFeatureState');
assertIncludes('components/Layout.tsx', 'featureFlagsService.listByOrg');
assertIncludes('components/PlatformManagementView.tsx', 'providerCatalogService.createProvider');
assertIncludes('components/PlatformManagementView.tsx', 'providerConfigurationService.testConnection');
assertIncludes('components/PlatformManagementView.tsx', 'oauthConnectionService');
assertIncludes('components/PlatformManagementView.tsx', '.start({');
assertIncludes('components/PlatformManagementView.tsx', '.disconnect({');
assertIncludes('services/postPublishService.ts', 'publishFacebookPost');
assertIncludes('services/messageReplyService.ts', 'replyFacebookMessage');
assertIncludes('services/brandKitService.ts', 'upsertBrandKit');
assertIncludes('services/brandKitService.ts', 'createTemplate');
assertIncludes('services/rankKeywordService.ts', 'rank_keywords');
assertIncludes('services/rankCollectionService.ts', 'rank_collection_runs');
assertIncludes('services/rankCollectionService.ts', 'collectByFunction');
assertIncludes('services/rankCollectionService.ts', 'listRunDetailsByStore');
assertIncludes('services/competitorService.ts', 'competitor_targets');
assertIncludes('services/competitorService.ts', 'listSnapshotsByRun');
assertIncludes('services/napConsistencyService.ts', 'nap_consistency_runs');
assertIncludes('services/napConsistencyService.ts', 'runManualCheck');
assertIncludes('services/napAlertService.ts', 'nap_alerts');
assertIncludes('services/napAlertService.ts', 'syncFromRunResults');
assertIncludes('services/inboxService.ts', 'listAssignableUsersByStore');
assertIncludes('services/inboxService.ts', 'updateWorkflow');
assertIncludes('components/PostList.tsx', 'providerPostsService.fetch');
assertIncludes('components/PostList.tsx', 'SocialPlatformBadge');
assertIncludes('components/PostCreator.tsx', 'brandKitService.lintContent');
assertIncludes('components/PostCreator.tsx', 'テンプレート / ブランドキット');
assertIncludes('components/RankTrackerView.tsx', '順位・競合ダッシュボード');
assertIncludes('components/RankTrackerView.tsx', '競合ターゲット');
assertIncludes('components/RankTrackerView.tsx', '店舗情報チェック（名前/住所/電話）');
assertIncludes('components/RankTrackerView.tsx', '店舗情報アラート');
assertIncludes('components/UnifiedInbox.tsx', 'messageReplyService.replyFacebookMessage');
assertIncludes('components/UnifiedInbox.tsx', 'ワークフローを保存');
assertIncludes('components/BrandKitView.tsx', 'brandKitService.upsertBrandKit');
assertIncludes('components/PostTemplatesView.tsx', 'brandKitService.createTemplate');
assertIncludes('supabase/migrations/202602060014_p2_template_brand_kit.sql', 'create table if not exists public.brand_kits');
assertIncludes('supabase/migrations/202602060015_p3_rank_keyword_management.sql', 'create table if not exists public.rank_keywords');
assertIncludes('supabase/functions/rank-collect/index.ts', 'rank_collection_runs');
assertIncludes('supabase/migrations/202602060016_p3_rank_daily_collection.sql', 'create table if not exists public.rank_collection_runs');
assertIncludes('supabase/functions/rank-collect/index.ts', 'competitor_metric_snapshots');
assertIncludes('supabase/migrations/202602060017_p3_competitor_comparison_collection.sql', 'create table if not exists public.competitor_targets');
assertIncludes('supabase/migrations/202602060018_p3_nap_consistency_check.sql', 'create table if not exists public.nap_consistency_runs');
assertIncludes('supabase/migrations/202602060019_p3_nap_alert_operations.sql', 'create table if not exists public.nap_alerts');

if (missingTokens.length > 0) {
  const details = missingTokens.map((item) => `- ${item.file}: ${item.token}`).join('\n');
  throw new Error(`Contract token missing (${missingTokens.length}):\n${details}`);
}

console.log('Contract smoke check passed.');
