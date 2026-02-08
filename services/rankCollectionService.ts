import {
  RankCollectionExecutionResult,
  RankCollectionMode,
  RankCollectionResult,
  RankCollectionRun,
} from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';

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

type FunctionInvokeResult = {
  ok: boolean;
  status: number;
  body: unknown;
};

const MIGRATION_ERROR_MESSAGE = 'P3-02 migration（rank daily collection）の適用後に再試行してください。';

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

const requireFunctionRequestContext = async (client: ReturnType<typeof requireSupabase>) => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase環境変数が不足しています。VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を確認してください。');
  }

  const { data, error } = await client.auth.getSession();
  if (error) {
    throw new Error(`ログインセッションの取得に失敗しました。（${error.message}）`);
  }
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new Error('ログインセッションが無効です。いったんログアウトして再ログインしてください。');
  }

  return { supabaseUrl, anonKey, accessToken };
};

const invokeFunctionByHttp = async (
  client: ReturnType<typeof requireSupabase>,
  functionName: string,
  payload: Record<string, unknown>
): Promise<FunctionInvokeResult> => {
  const { supabaseUrl, anonKey, accessToken } = await requireFunctionRequestContext(client);
  const requestUrl = `${supabaseUrl}/functions/v1/${functionName}?client=direct-http-v3`;
  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
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

  async collectByFunction(params: { storeId: string; mode?: RankCollectionMode }): Promise<RankCollectionExecutionResult> {
    const client = requireSupabase();
    const result = await invokeFunctionByHttp(client, 'rank-collect', {
      storeId: params.storeId,
      mode: params.mode || 'MOCK',
      triggerType: 'MANUAL',
    });

    const bodyError =
      result.body && typeof result.body === 'object'
        ? String((result.body as Record<string, unknown>).error || (result.body as Record<string, unknown>).message || '')
        : '';
    if (!result.ok) {
      throw new Error(bodyError ? `${bodyError}（status=${result.status}）` : `順位収集の実行に失敗しました。（status=${result.status}）`);
    }

    const mappedBody = (result.body || {}) as Record<string, unknown>;
    return {
      ok: Boolean(mappedBody.ok),
      runId: String(mappedBody.runId || ''),
      mode: (String(mappedBody.mode || 'MOCK').toUpperCase() as RankCollectionMode) || 'MOCK',
      status: (String(mappedBody.status || 'FAILED').toUpperCase() as RankCollectionRun['status']) || 'FAILED',
      collectedCount: Number(mappedBody.collectedCount || 0),
      message: mappedBody.message ? String(mappedBody.message) : undefined,
    };
  },
};
