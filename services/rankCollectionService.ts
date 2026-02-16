import {
  CompetitorMetricSnapshot,
  RankCollectionExecutionResult,
  RankCollectionMode,
  RankCollectionRunDetail,
  RankCollectionResult,
  RankCollectionRun,
} from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import { migrationRequiredMessage } from './migrationRequiredMessage';
import { getFunctionErrorMessage, invokeFunctionByHttp } from './functionHttpClient';

type DbRankCollectionRunRow = {
  id: string;
  store_id: string;
  trigger_type: 'MANUAL' | 'SCHEDULED';
  mode: RankCollectionMode;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  message: string | null;
  requested_by_user_id: string | null;
  started_at: string;
  finished_at: string | null;
  created_at: string;
};

type DbRankCollectionResultRow = {
  id: string;
  run_id: string;
  store_id: string;
  rank_keyword_id: string;
  keyword: string;
  position: number | null;
  mode: RankCollectionMode;
  status: 'SUCCESS' | 'FAILED';
  message: string | null;
  raw: Record<string, unknown> | null;
  created_at: string;
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
  mode: RankCollectionMode;
  status: 'SUCCESS' | 'FAILED';
  message: string | null;
  raw: Record<string, unknown> | null;
  collected_at: string;
  created_at: string;
};

const MIGRATION_ERROR_MESSAGE = migrationRequiredMessage('順位チェック（順位収集）');
const COMPETITOR_MIGRATION_ERROR_MESSAGE = migrationRequiredMessage('順位チェック（競合比較）');

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、順位収集を実行できません。');
  }
  return supabase;
};

const isMissingRelationError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: string }).code || '') : '';
  const message = 'message' in error ? String((error as { message?: string }).message || '') : '';
  return code === '42P01' || message.includes('does not exist');
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== 'object') return '';
  if ('message' in error) return String((error as { message?: string }).message || '');
  return '';
};

const mapRun = (row: DbRankCollectionRunRow): RankCollectionRun => ({
  id: row.id,
  storeId: row.store_id,
  triggerType: row.trigger_type,
  mode: row.mode,
  status: row.status,
  message: row.message || undefined,
  requestedByUserId: row.requested_by_user_id || undefined,
  startedAt: new Date(row.started_at),
  finishedAt: row.finished_at ? new Date(row.finished_at) : undefined,
  createdAt: new Date(row.created_at),
});

const mapResult = (row: DbRankCollectionResultRow): RankCollectionResult => ({
  id: row.id,
  runId: row.run_id,
  storeId: row.store_id,
  rankKeywordId: row.rank_keyword_id,
  keyword: row.keyword,
  position: row.position || undefined,
  mode: row.mode,
  status: row.status,
  message: row.message || undefined,
  raw: row.raw || {},
  createdAt: new Date(row.created_at),
});

const mapCompetitorSnapshot = (row: DbCompetitorMetricSnapshotRow): CompetitorMetricSnapshot => ({
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

export const rankCollectionService = {
  async listRunsByStore(storeId: string, limit = 20): Promise<RankCollectionRun[]> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('rank_collection_runs')
      .select('id, store_id, trigger_type, mode, status, message, requested_by_user_id, started_at, finished_at, created_at')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error && isMissingRelationError(error)) throw new Error(MIGRATION_ERROR_MESSAGE);
    if (error) throw error;
    return ((data || []) as DbRankCollectionRunRow[]).map(mapRun);
  },

  async listResultsByRun(runId: string): Promise<RankCollectionResult[]> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('rank_collection_results')
      .select('id, run_id, store_id, rank_keyword_id, keyword, position, mode, status, message, raw, created_at')
      .eq('run_id', runId)
      .order('created_at', { ascending: true });
    if (error && isMissingRelationError(error)) throw new Error(MIGRATION_ERROR_MESSAGE);
    if (error) throw error;
    return ((data || []) as DbRankCollectionResultRow[]).map(mapResult);
  },

  async listCompetitorSnapshotsByRun(runId: string): Promise<CompetitorMetricSnapshot[]> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('competitor_metric_snapshots')
      .select(
        'id, run_id, store_id, competitor_target_id, competitor_name, map_rank, review_count, rating, mode, status, message, raw, collected_at, created_at'
      )
      .eq('run_id', runId)
      .order('created_at', { ascending: true });
    if (error && isMissingRelationError(error)) throw new Error(COMPETITOR_MIGRATION_ERROR_MESSAGE);
    if (error) throw error;
    return ((data || []) as DbCompetitorMetricSnapshotRow[]).map(mapCompetitorSnapshot);
  },

  async listRunDetailsByStore(storeId: string, limit = 14): Promise<RankCollectionRunDetail[]> {
    const runs = await this.listRunsByStore(storeId, limit);
    const details = await Promise.all(
      runs.map(async (run): Promise<RankCollectionRunDetail> => {
        const results = await this.listResultsByRun(run.id);
        try {
          const competitorSnapshots = await this.listCompetitorSnapshotsByRun(run.id);
          return { run, results, competitorSnapshots };
        } catch (error) {
          const message = toErrorMessage(error);
          if (message === COMPETITOR_MIGRATION_ERROR_MESSAGE) {
            return {
              run,
              results,
              competitorSnapshots: [],
              competitorSkippedReason: message,
            };
          }
          throw error;
        }
      })
    );
    return details.sort((left, right) => left.run.startedAt.getTime() - right.run.startedAt.getTime());
  },

  async collectByFunction(params: { storeId: string; mode?: RankCollectionMode }): Promise<RankCollectionExecutionResult> {
    const result = await invokeFunctionByHttp('rank-collect', {
      storeId: params.storeId,
      mode: params.mode || 'MOCK',
      triggerType: 'MANUAL',
    });

    const bodyError =
      result.body && typeof result.body === 'object'
        ? String((result.body as Record<string, unknown>).error || (result.body as Record<string, unknown>).message || '')
        : '';
    if (!result.ok) {
      throw new Error(bodyError ? `${bodyError}（status=${result.status}）` : getFunctionErrorMessage(result, '順位収集の実行に失敗しました。'));
    }

    const mappedBody = (result.body || {}) as Record<string, unknown>;
    return {
      ok: Boolean(mappedBody.ok),
      runId: String(mappedBody.runId || ''),
      mode: (String(mappedBody.mode || 'MOCK').toUpperCase() as RankCollectionMode) || 'MOCK',
      status: (String(mappedBody.status || 'FAILED').toUpperCase() as RankCollectionRun['status']) || 'FAILED',
      collectedCount: Number(mappedBody.collectedCount || 0),
      collectedCompetitorCount: Number(mappedBody.collectedCompetitorCount || 0),
      competitorSkippedReason: mappedBody.competitorSkippedReason
        ? String(mappedBody.competitorSkippedReason)
        : undefined,
      message: mappedBody.message ? String(mappedBody.message) : undefined,
    };
  },
};
