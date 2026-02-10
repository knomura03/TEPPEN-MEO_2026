import { RankKeyword } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import { migrationRequiredMessage } from './migrationRequiredMessage';

type DbRankKeywordRow = {
  id: string;
  store_id: string;
  keyword: string;
  note: string | null;
  is_active: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

const MIGRATION_ERROR_MESSAGE = migrationRequiredMessage('順位チェック（キーワード管理）');

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、順位キーワード管理を利用できません。');
  }
  return supabase;
};

const isMissingRelationError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: string }).code || '') : '';
  const message = 'message' in error ? String((error as { message?: string }).message || '') : '';
  return code === '42P01' || message.includes('does not exist');
};

const mapRankKeyword = (row: DbRankKeywordRow): RankKeyword => ({
  id: row.id,
  storeId: row.store_id,
  keyword: row.keyword,
  note: row.note || undefined,
  isActive: row.is_active,
  createdBy: row.created_by || undefined,
  updatedBy: row.updated_by || undefined,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

const normalizeKeyword = (keyword: string): string => keyword.trim().replace(/\s+/g, ' ');

const parseDuplicateKeywordError = (error: unknown): string | null => {
  if (!error || typeof error !== 'object') return null;
  const code = 'code' in error ? String((error as { code?: string }).code || '') : '';
  const message = 'message' in error ? String((error as { message?: string }).message || '') : '';
  if (code === '23505' || message.includes('rank_keywords_store_keyword_unique_idx')) {
    return '同じキーワードが既に登録されています。';
  }
  return null;
};

export const rankKeywordService = {
  normalizeKeyword,

  async listActiveByStore(storeId: string): Promise<RankKeyword[]> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('rank_keywords')
      .select('id, store_id, keyword, note, is_active, created_by, updated_by, created_at, updated_at')
      .eq('store_id', storeId)
      .eq('is_active', true)
      .order('updated_at', { ascending: false });
    if (error && isMissingRelationError(error)) throw new Error(MIGRATION_ERROR_MESSAGE);
    if (error) throw error;
    return ((data || []) as DbRankKeywordRow[]).map(mapRankKeyword);
  },

  async create(params: { storeId: string; keyword: string; note?: string; createdBy: string }): Promise<RankKeyword> {
    const client = requireSupabase();
    const normalizedKeyword = normalizeKeyword(params.keyword);
    if (!normalizedKeyword) {
      throw new Error('キーワードを入力してください。');
    }
    if (normalizedKeyword.length > 80) {
      throw new Error('キーワードは80文字以内で入力してください。');
    }
    const payload = {
      store_id: params.storeId,
      keyword: normalizedKeyword,
      note: params.note?.trim() || null,
      is_active: true,
      created_by: params.createdBy,
      updated_by: params.createdBy,
    };
    const { data, error } = await client
      .from('rank_keywords')
      .insert(payload)
      .select('id, store_id, keyword, note, is_active, created_by, updated_by, created_at, updated_at')
      .single();
    if (error && isMissingRelationError(error)) throw new Error(MIGRATION_ERROR_MESSAGE);
    if (error) {
      const message = parseDuplicateKeywordError(error);
      if (message) throw new Error(message);
      throw error;
    }
    return mapRankKeyword(data as DbRankKeywordRow);
  },

  async update(params: { id: string; keyword: string; note?: string; updatedBy: string }): Promise<RankKeyword> {
    const client = requireSupabase();
    const normalizedKeyword = normalizeKeyword(params.keyword);
    if (!normalizedKeyword) {
      throw new Error('キーワードを入力してください。');
    }
    if (normalizedKeyword.length > 80) {
      throw new Error('キーワードは80文字以内で入力してください。');
    }

    const { data, error } = await client
      .from('rank_keywords')
      .update({
        keyword: normalizedKeyword,
        note: params.note?.trim() || null,
        updated_by: params.updatedBy,
      })
      .eq('id', params.id)
      .select('id, store_id, keyword, note, is_active, created_by, updated_by, created_at, updated_at')
      .single();
    if (error && isMissingRelationError(error)) throw new Error(MIGRATION_ERROR_MESSAGE);
    if (error) {
      const message = parseDuplicateKeywordError(error);
      if (message) throw new Error(message);
      throw error;
    }
    return mapRankKeyword(data as DbRankKeywordRow);
  },

  async archive(params: { id: string; updatedBy: string }): Promise<void> {
    const client = requireSupabase();
    const { error } = await client
      .from('rank_keywords')
      .update({ is_active: false, updated_by: params.updatedBy })
      .eq('id', params.id);
    if (error && isMissingRelationError(error)) throw new Error(MIGRATION_ERROR_MESSAGE);
    if (error) throw error;
  },
};
