import { DEFAULT_FEATURE_VISIBILITY } from '../constants';
import { FeatureFlag, StoreGroupFeatureFlagApplyResult, VisibilityState } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';

type DbFeatureFlagRow = {
  id: string;
  org_id: string;
  store_id: string | null;
  feature_key: string;
  state: VisibilityState;
  note: string | null;
};

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、feature flagを取得できません。');
  }
  return supabase;
};

const mapFeatureFlag = (row: DbFeatureFlagRow): FeatureFlag => ({
  id: row.id,
  orgId: row.org_id,
  storeId: row.store_id || undefined,
  featureKey: row.feature_key,
  state: row.state,
  note: row.note || undefined,
});

export const resolveFeatureState = (
  flags: FeatureFlag[],
  featureKey: string,
  storeId?: string
): VisibilityState => {
  const normalizedKey = featureKey.toLowerCase();
  const storeMatched = storeId
    ? flags.find((flag) => flag.featureKey.toLowerCase() === normalizedKey && flag.storeId === storeId)
    : undefined;
  if (storeMatched) return storeMatched.state;

  const orgMatched = flags.find((flag) => flag.featureKey.toLowerCase() === normalizedKey && !flag.storeId);
  if (orgMatched) return orgMatched.state;

  return DEFAULT_FEATURE_VISIBILITY[normalizedKey] || 'ENABLED';
};

export const featureFlagsService = {
  async listByOrg(orgId: string, storeId?: string): Promise<FeatureFlag[]> {
    const client = requireSupabase();
    let query = client.from('feature_flags').select('id, org_id, store_id, feature_key, state, note').eq('org_id', orgId);
    if (storeId) {
      query = query.or(`store_id.is.null,store_id.eq.${storeId}`);
    }
    const { data, error } = await query;
    if (error) throw error;
    return ((data || []) as DbFeatureFlagRow[]).map(mapFeatureFlag);
  },

  async upsert(params: {
    orgId: string;
    storeId?: string;
    featureKey: string;
    state: VisibilityState;
    note?: string;
    updatedBy?: string;
  }): Promise<void> {
    const client = requireSupabase();
    const normalizedFeatureKey = params.featureKey.toLowerCase();
    const payload = {
      org_id: params.orgId,
      store_id: params.storeId || null,
      feature_key: normalizedFeatureKey,
      state: params.state,
      note: params.note || null,
      updated_by: params.updatedBy || null,
    };

    if (params.storeId) {
      const { error } = await client.from('feature_flags').upsert(payload, {
        onConflict: 'org_id,store_id,feature_key',
      });
      if (error) throw error;
      return;
    }

    const { data: existingRows, error: existingError } = await client
      .from('feature_flags')
      .select('id')
      .eq('org_id', params.orgId)
      .is('store_id', null)
      .eq('feature_key', normalizedFeatureKey);
    if (existingError) throw existingError;

    if (existingRows && existingRows.length > 0) {
      const { error: updateError } = await client
        .from('feature_flags')
        .update({
          state: params.state,
          note: params.note || null,
          updated_by: params.updatedBy || null,
        })
        .eq('org_id', params.orgId)
        .is('store_id', null)
        .eq('feature_key', normalizedFeatureKey);
      if (updateError) throw updateError;
      return;
    }

    const { error: insertError } = await client.from('feature_flags').insert(payload);
    if (insertError) throw insertError;
  },

  async upsertForStoreGroup(params: {
    orgId: string;
    storeIds: string[];
    featureKey: string;
    state: VisibilityState;
    note?: string;
    updatedBy?: string;
  }): Promise<StoreGroupFeatureFlagApplyResult> {
    const client = requireSupabase();
    const uniqueStoreIds = Array.from(new Set((params.storeIds || []).filter((storeId) => Boolean(storeId))));
    if (uniqueStoreIds.length === 0) {
      throw new Error('一括設定の対象店舗がありません。');
    }

    const normalizedFeatureKey = params.featureKey.toLowerCase();
    const payload = uniqueStoreIds.map((storeId) => ({
      org_id: params.orgId,
      store_id: storeId,
      feature_key: normalizedFeatureKey,
      state: params.state,
      note: params.note || null,
      updated_by: params.updatedBy || null,
    }));

    const { error } = await client.from('feature_flags').upsert(payload, {
      onConflict: 'org_id,store_id,feature_key',
    });
    if (error) throw error;

    return {
      appliedStoreCount: uniqueStoreIds.length,
      skippedStoreCount: Math.max((params.storeIds || []).length - uniqueStoreIds.length, 0),
    };
  },
};
