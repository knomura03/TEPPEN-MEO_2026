import { isSupabaseConfigured, supabase } from './supabaseClient';
import { SocialPlatform } from '../types';

type DbIntegrationRow = {
  id: string;
  store_id: string;
  provider: string;
  status: string;
  last_sync_at: string | null;
  last_error: string | null;
};

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、連携状態を取得できません。');
  }
  return supabase;
};

const providerFromPlatform = (platform: SocialPlatform): string => {
  if (platform === 'GOOGLE_BUSINESS') return 'GBP';
  return platform;
};

const platformFromProvider = (provider: string): SocialPlatform => {
  if (provider === 'GBP') return 'GOOGLE_BUSINESS';
  if (provider === 'INSTAGRAM') return 'INSTAGRAM';
  if (provider === 'FACEBOOK') return 'FACEBOOK';
  if (provider === 'TIKTOK') return 'TIKTOK';
  return 'GOOGLE_BUSINESS';
};

export type IntegrationStatus = {
  platform: SocialPlatform;
  isConnected: boolean;
  lastSyncAt?: Date;
  lastError?: string;
};

const mapDbIntegration = (row: DbIntegrationRow): IntegrationStatus => {
  return {
    platform: platformFromProvider(row.provider),
    isConnected: row.status === 'CONNECTED',
    lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at) : undefined,
    lastError: row.last_error || undefined,
  };
};

export const integrationsService = {
  async listByStore(storeId: string): Promise<IntegrationStatus[]> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('integrations')
      .select('id, store_id, provider, status, last_sync_at, last_error')
      .eq('store_id', storeId);
    if (error) throw error;
    return (data || []).map((row) => mapDbIntegration(row as DbIntegrationRow));
  },

  async setConnection(
    storeId: string,
    platform: SocialPlatform,
    isConnected: boolean
  ): Promise<IntegrationStatus> {
    const client = requireSupabase();
    const provider = providerFromPlatform(platform);
    const { data, error } = await client
      .from('integrations')
      .upsert(
        {
          store_id: storeId,
          provider,
          status: isConnected ? 'CONNECTED' : 'DISCONNECTED',
          last_error: null,
        },
        { onConflict: 'store_id,provider' }
      )
      .select('id, store_id, provider, status, last_sync_at, last_error')
      .single();
    if (error) throw error;
    return mapDbIntegration(data as DbIntegrationRow);
  },
};
