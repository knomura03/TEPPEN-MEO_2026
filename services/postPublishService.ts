import { PostPublishLog, PublishExecutionResult } from '../types';
import { getFunctionErrorMessage, invokeFunctionByHttp, requireSupabaseClient } from './functionHttpClient';

type DbPostPublishLogRow = {
  id: string;
  post_id: string;
  store_id: string;
  provider: string;
  mode: 'REAL' | 'MOCK';
  status: 'SUCCESS' | 'FAILED';
  message: string | null;
  external_post_id: string | null;
  requested_by_user_id: string | null;
  created_at: string;
};

type PublishProvider = 'INSTAGRAM' | 'FACEBOOK' | 'GBP';

const mapPublishLog = (row: DbPostPublishLogRow): PostPublishLog => ({
  id: row.id,
  postId: row.post_id,
  storeId: row.store_id,
  provider: row.provider,
  mode: row.mode,
  status: row.status,
  message: row.message || undefined,
  externalPostId: row.external_post_id || undefined,
  requestedByUserId: row.requested_by_user_id || undefined,
  createdAt: new Date(row.created_at),
});

const normalizeProviderKey = (provider: string): PublishProvider => {
  if (provider === 'INSTAGRAM' || provider === 'FACEBOOK' || provider === 'GBP') return provider;
  if (provider === 'GOOGLE_BUSINESS') return 'GBP';
  return 'FACEBOOK';
};

const toExecutionResult = (raw: Record<string, unknown>): PublishExecutionResult => {
  const provider = normalizeProviderKey(String(raw.provider || 'FACEBOOK'));
  const mode = raw.mode === 'MOCK' ? 'MOCK' : 'REAL';
  const status = raw.status === 'FAILED' ? 'FAILED' : 'SUCCESS';
  return {
    ok: status === 'SUCCESS',
    provider,
    mode,
    status,
    message: typeof raw.message === 'string' ? raw.message : undefined,
    externalPostId: typeof raw.externalPostId === 'string' ? raw.externalPostId : undefined,
  };
};

const invokePublishRun = async (params: { postId: string; providers?: PublishProvider[] }): Promise<PublishExecutionResult[]> => {
  const payload: Record<string, unknown> = {
    postId: params.postId,
  };
  if (params.providers && params.providers.length > 0) {
    payload.providers = params.providers;
  }

  const result = await invokeFunctionByHttp('post-publish-run', payload);
  if (!result.ok) {
    throw new Error(getFunctionErrorMessage(result, '投稿実行に失敗しました。'));
  }

  const body = result.body && typeof result.body === 'object' ? (result.body as Record<string, unknown>) : {};
  const rows = Array.isArray(body.results) ? body.results : [];

  if (rows.length === 0) {
    throw new Error('投稿実行の結果が取得できませんでした。');
  }

  return rows
    .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>) : null))
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .map(toExecutionResult);
};

export const postPublishService = {
  async publishPost(params: { postId: string; providers?: PublishProvider[] }): Promise<PublishExecutionResult[]> {
    return invokePublishRun(params);
  },

  async publishInstagramPost(params: { postId: string; actorUserId?: string }): Promise<PublishExecutionResult> {
    const results = await invokePublishRun({
      postId: params.postId,
      providers: ['INSTAGRAM'],
    });
    return results.find((item) => item.provider === 'INSTAGRAM') || results[0];
  },

  async publishFacebookPost(params: { postId: string; actorUserId?: string }): Promise<PublishExecutionResult> {
    const results = await invokePublishRun({
      postId: params.postId,
      providers: ['FACEBOOK'],
    });
    return results.find((item) => item.provider === 'FACEBOOK') || results[0];
  },

  async publishGoogleBusinessPost(params: { postId: string; actorUserId?: string }): Promise<PublishExecutionResult> {
    const results = await invokePublishRun({
      postId: params.postId,
      providers: ['GBP'],
    });
    return results.find((item) => item.provider === 'GBP') || results[0];
  },

  async listByPostId(postId: string): Promise<PostPublishLog[]> {
    const client = requireSupabaseClient();
    const { data, error } = await client
      .from('post_publish_logs')
      .select('id, post_id, store_id, provider, mode, status, message, external_post_id, requested_by_user_id, created_at')
      .eq('post_id', postId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return ((data || []) as DbPostPublishLogRow[]).map(mapPublishLog);
  },
};
