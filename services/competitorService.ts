import { CompetitorMetricSnapshot, CompetitorTarget } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';

type DbCompetitorTargetRow = {
  id: string;
  store_id: string;
  name: string;
  note: string | null;
  is_active: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type DbCompetitorMetricSnapshotRow = {
  id: string;
  run_id: string;
  store_id: string;
  competitor_target_id: string;
  competitor_name: string;
  map_rank: number | null;
  review_count: number;
  rating: number | null;
  mode: 'REAL' | 'MOCK';
  status: 'SUCCESS' | 'FAILED';
  message: string | null;
  raw: Record<string, unknown> | null;
  collected_at: string;
  created_at: string;
};

const MIGRATION_ERROR_MESSAGE = 'P3-03 migration（competitor collection）の適用後に再試行してください。';

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、競合比較機能を利用できません。');
  }
  return supabase;
};

const isMissingRelationError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: string }).code || '') : '';
  const message = 'message' in error ? String((error as { message?: string }).message || '') : '';
  return code === '42P01' || message.includes('does not exist');
};

const normalizeName = (name: string): string => name.trim().replace(/\s+/g, ' ');

const parseDuplicateNameError = (error: unknown): string | null => {
  if (!error || typeof error !== 'object') return null;
  const code = 'code' in error ? String((error as { code?: string }).code || '') : '';
  const message = 'message' in error ? String((error as { message?: string }).message || '') : '';
  if (code === '23505' || message.includes('competitor_targets_store_name_unique_idx')) {
    return '同じ競合名が既に登録されています。';
  }
  return null;
};

const mapCompetitorTarget = (row: DbCompetitorTargetRow): CompetitorTarget => ({
  id: row.id,
  storeId: row.store_id,
  name: row.name,
  note: row.note || undefined,
  isActive: row.is_active,
  createdBy: row.created_by || undefined,
  updatedBy: row.updated_by || undefined,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

const mapSnapshot = (row: DbCompetitorMetricSnapshotRow): CompetitorMetricSnapshot => ({
  id: row.id,
  runId: row.run_id,
  storeId: row.store_id,
  competitorTargetId: row.competitor_target_id,
  competitorName: row.competitor_name,
  mapRank: row.map_rank || undefined,
  reviewCount: row.review_count,
  rating: typeof row.rating === 'number' ? row.rating : undefined,
  mode: row.mode,
  status: row.status,
  message: row.message || undefined,
  raw: row.raw || {},
  collectedAt: new Date(row.collected_at),
  createdAt: new Date(row.created_at),
});

export const competitorService = {
  normalizeName,

  async listActiveByStore(storeId: string): Promise<CompetitorTarget[]> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('competitor_targets')
      .select('id, store_id, name, note, is_active, created_by, updated_by, created_at, updated_at')
      .eq('store_id', storeId)
      .eq('is_active', true)
      .order('updated_at', { ascending: false });
    if (error && isMissingRelationError(error)) throw new Error(MIGRATION_ERROR_MESSAGE);
    if (error) throw error;
    return ((data || []) as DbCompetitorTargetRow[]).map(mapCompetitorTarget);
  },

  async create(params: { storeId: string; name: string; note?: string; createdBy: string }): Promise<CompetitorTarget> {
    const client = requireSupabase();
    const normalizedName = normalizeName(params.name);
    if (!normalizedName) {
      throw new Error('競合名を入力してください。');
    }
    if (normalizedName.length > 120) {
      throw new Error('競合名は120文字以内で入力してください。');
    }

    const payload = {
      store_id: params.storeId,
      name: normalizedName,
      note: params.note?.trim() || null,
      is_active: true,
      created_by: params.createdBy,
      updated_by: params.createdBy,
    };

    const { data, error } = await client
      .from('competitor_targets')
      .insert(payload)
      .select('id, store_id, name, note, is_active, created_by, updated_by, created_at, updated_at')
      .single();
    if (error && isMissingRelationError(error)) throw new Error(MIGRATION_ERROR_MESSAGE);
    if (error) {
      const message = parseDuplicateNameError(error);
      if (message) throw new Error(message);
      throw error;
    }
    return mapCompetitorTarget(data as DbCompetitorTargetRow);
  },

  async archive(params: { id: string; updatedBy: string }): Promise<void> {
    const client = requireSupabase();
    const { error } = await client
      .from('competitor_targets')
      .update({ is_active: false, updated_by: params.updatedBy })
      .eq('id', params.id);
    if (error && isMissingRelationError(error)) throw new Error(MIGRATION_ERROR_MESSAGE);
    if (error) throw error;
  },

  async listSnapshotsByRun(runId: string): Promise<CompetitorMetricSnapshot[]> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('competitor_metric_snapshots')
      .select(
        'id, run_id, store_id, competitor_target_id, competitor_name, map_rank, review_count, rating, mode, status, message, raw, collected_at, created_at'
      )
      .eq('run_id', runId)
      .order('created_at', { ascending: true });
    if (error && isMissingRelationError(error)) throw new Error(MIGRATION_ERROR_MESSAGE);
    if (error) throw error;
    return ((data || []) as DbCompetitorMetricSnapshotRow[]).map(mapSnapshot);
  },
};
