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
  'components/Layout.tsx',
  'components/SettingsView.tsx',
  'components/PostList.tsx',
  'components/PostCreator.tsx',
  'components/RankTrackerView.tsx',
  'components/UnifiedInbox.tsx',
  'supabase/functions/facebook-publish-post/index.ts',
  'supabase/functions/facebook-reply-message/index.ts',
  'supabase/migrations/202602060013_p2_inbox_advanced_workflow.sql',
  'supabase/migrations/202602060014_p2_template_brand_kit.sql',
  'supabase/migrations/202602060015_p3_rank_keyword_management.sql',
];

for (const file of requiredFiles) {
  const full = join(root, file);
  if (!existsSync(full)) {
    throw new Error(`Missing required phase0 file: ${file}`);
  }
}

const assertIncludes = (file, token) => {
  const text = readFileSync(join(root, file), 'utf8');
  if (!text.includes(token)) {
    throw new Error(`Contract token not found in ${file}: ${token}`);
  }
};

assertIncludes('services/providerAdapterRegistry.ts', 'registerProviderAdapter');
assertIncludes('services/providerAdapterRegistry.ts', 'resolveProviderAdapter');
assertIncludes('services/providerReadinessService.ts', 'testMode');
assertIncludes('services/providerReadinessService.ts', 'runtimeMode');
assertIncludes('services/featureFlagsService.ts', 'resolveFeatureState');
assertIncludes('components/Layout.tsx', 'featureFlagsService.listByOrg');
assertIncludes('components/SettingsView.tsx', 'providerCatalogService.createProvider');
assertIncludes('components/SettingsView.tsx', 'providerConfigurationService.testConnection');
assertIncludes('services/postPublishService.ts', 'publishFacebookPost');
assertIncludes('services/messageReplyService.ts', 'replyFacebookMessage');
assertIncludes('services/brandKitService.ts', 'upsertBrandKit');
assertIncludes('services/brandKitService.ts', 'createTemplate');
assertIncludes('services/rankKeywordService.ts', 'rank_keywords');
assertIncludes('services/inboxService.ts', 'listAssignableUsersByStore');
assertIncludes('services/inboxService.ts', 'updateWorkflow');
assertIncludes('components/PostList.tsx', 'Facebook投稿');
assertIncludes('components/PostCreator.tsx', 'brandKitService.lintContent');
assertIncludes('components/PostCreator.tsx', 'テンプレート / ブランドキット');
assertIncludes('components/RankTrackerView.tsx', '順位計測');
assertIncludes('components/UnifiedInbox.tsx', 'messageReplyService.replyFacebookMessage');
assertIncludes('components/UnifiedInbox.tsx', 'ワークフローを保存');
assertIncludes('components/SettingsView.tsx', 'ブランドキット');
assertIncludes('components/SettingsView.tsx', 'brandKitService.upsertBrandKit');
assertIncludes('components/SettingsView.tsx', 'brandKitService.createTemplate');
assertIncludes('supabase/migrations/202602060014_p2_template_brand_kit.sql', 'create table if not exists public.brand_kits');
assertIncludes('supabase/migrations/202602060015_p3_rank_keyword_management.sql', 'create table if not exists public.rank_keywords');

console.log('Contract smoke check passed.');
