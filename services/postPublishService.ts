import { PostPublishLog, PostPublishMode, PublishExecutionResult, SocialPlatform } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';

type PublishProviderKey = 'INSTAGRAM' | 'FACEBOOK';

type DbPostRow = {
  id: string;
  store_id: string;
  content: string;
  platforms: SocialPlatform[];
  scheduled_at: string | null;
  approval_status: string;
  status: string;
};

type DbStoreRow = {
  id: string;
  org_id: string;
};

type DbProviderCatalogRow = {
  id: string;
  provider_key: string;
  provider_capabilities?: { can_publish: boolean }[];
};

type DbProviderConfigurationRow = {
  id: string;
  has_gui_config: boolean;
  connection_status: string;
  last_error: string | null;
};

type DbIntegrationRow = {
  id: string;
  status: string;
  last_error: string | null;
};

type DbPostPublishLogRow = {
  id: string;
  post_id: string;
  store_id: string;
  provider: string;
  mode: PostPublishMode;
  status: 'SUCCESS' | 'FAILED';
  message: string | null;
  external_post_id: string | null;
  requested_by_user_id: string | null;
  created_at: string;
};

type FunctionInvokeResult = {
  ok: boolean;
  status: number;
  body: unknown;
};

const providerDisplayName = (provider: PublishProviderKey): string => {
  if (provider === 'INSTAGRAM') return 'Instagram';
  return 'Facebook';
};

const publishFunctionName = (provider: PublishProviderKey): string => {
  if (provider === 'INSTAGRAM') return 'instagram-publish-post';
  return 'facebook-publish-post';
};

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、投稿連携を実行できません。');
  }
  return supabase;
};

const isFutureSchedule = (scheduledAt: string | null): boolean => {
  if (!scheduledAt) return false;
  const ts = new Date(scheduledAt).getTime();
  if (Number.isNaN(ts)) return false;
  return ts > Date.now();
};

const readFunctionContext = async (client: ReturnType<typeof requireSupabase>) => {
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
    throw new Error('ログインセッションが無効です。再ログイン後に再試行してください。');
  }

  return { supabaseUrl, anonKey, accessToken };
};

const invokeFunctionByHttp = async (
  client: ReturnType<typeof requireSupabase>,
  functionName: string,
  payload: Record<string, unknown>
): Promise<FunctionInvokeResult> => {
  const { supabaseUrl, anonKey, accessToken } = await readFunctionContext(client);
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
    body = { raw: text };
  }
  return { ok: response.ok, status: response.status, body };
};

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

const savePublishLog = async (params: {
  postId: string;
  storeId: string;
  actorUserId: string;
  provider: PublishProviderKey;
  mode: PostPublishMode;
  status: 'SUCCESS' | 'FAILED';
  message?: string;
  externalPostId?: string;
}) => {
  const client = requireSupabase();
  const { error } = await client.from('post_publish_logs').insert({
    post_id: params.postId,
    store_id: params.storeId,
    provider: params.provider,
    mode: params.mode,
    status: params.status,
    message: params.message || null,
    external_post_id: params.externalPostId || null,
    requested_by_user_id: params.actorUserId,
  });
  if (error) throw error;
};

const setPostPublished = async (postId: string) => {
  const client = requireSupabase();
  const { error } = await client
    .from('posts')
    .update({
      status: 'PUBLISHED',
      published_at: new Date().toISOString(),
    })
    .eq('id', postId);
  if (error) throw error;
};

const setPostFailed = async (postId: string) => {
  const client = requireSupabase();
  const { error } = await client
    .from('posts')
    .update({
      status: 'FAILED',
    })
    .eq('id', postId);
  if (error) throw error;
};

const resolvePublishMode = async (storeId: string, provider: PublishProviderKey): Promise<PostPublishMode> => {
  const client = requireSupabase();
  const { data: store, error: storeError } = await client
    .from('stores')
    .select('id, org_id')
    .eq('id', storeId)
    .maybeSingle();
  if (storeError || !store) {
    throw new Error('店舗情報の取得に失敗しました。');
  }
  const storeRow = store as DbStoreRow;

  const { data: catalog, error: catalogError } = await client
    .from('provider_catalog')
    .select('id, provider_key, provider_capabilities(can_publish)')
    .eq('org_id', storeRow.org_id)
    .eq('provider_key', provider)
    .eq('is_active', true)
    .maybeSingle();
  if (catalogError || !catalog) {
    throw new Error(`${providerDisplayName(provider)} provider が見つかりません。`);
  }
  const catalogRow = catalog as DbProviderCatalogRow;
  const canPublish = Boolean(catalogRow.provider_capabilities?.[0]?.can_publish);
  if (!canPublish) {
    throw new Error(`${providerDisplayName(provider)} provider の publish 権限が無効です。`);
  }

  const { data: configuration, error: configurationError } = await client
    .from('provider_configurations')
    .select('id, has_gui_config, connection_status, last_error')
    .eq('store_id', storeId)
    .eq('provider_catalog_id', catalogRow.id)
    .maybeSingle();
  if (configurationError) throw configurationError;

  const { data: integration, error: integrationError } = await client
    .from('integrations')
    .select('id, status, last_error')
    .eq('store_id', storeId)
    .eq('provider', provider)
    .maybeSingle();
  if (integrationError) throw integrationError;

  const configRow = configuration as DbProviderConfigurationRow | null;
  const integrationRow = integration as DbIntegrationRow | null;
  const hasGuiConfig = Boolean(configRow?.has_gui_config);
  const isConnected = configRow?.connection_status === 'CONNECTED' && integrationRow?.status === 'CONNECTED';

  if (hasGuiConfig && isConnected) return 'REAL';
  return 'MOCK';
};

const getBodyError = (body: unknown): string => {
  if (!body || typeof body !== 'object') return '';
  const error = (body as Record<string, unknown>).error;
  const message = (body as Record<string, unknown>).message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (typeof message === 'string' && message.trim()) return message.trim();
  return '';
};

const assertPublishablePost = (post: DbPostRow, provider: PublishProviderKey) => {
  const providerDisplay = providerDisplayName(provider);
  if (!(post.platforms || []).includes(provider)) {
    throw new Error(`この投稿は${providerDisplay}を対象にしていません。`);
  }
  if (post.approval_status !== 'APPROVED') {
    throw new Error(`${providerDisplay}投稿は承認済み投稿のみ実行できます。`);
  }
  if (isFutureSchedule(post.scheduled_at)) {
    throw new Error('予約時刻前のため、まだ投稿できません。');
  }
};

const publishByProvider = async (params: {
  post: DbPostRow;
  actorUserId: string;
  provider: PublishProviderKey;
}): Promise<PublishExecutionResult> => {
  const client = requireSupabase();
  const mode = await resolvePublishMode(params.post.store_id, params.provider);
  const providerDisplay = providerDisplayName(params.provider);

  if (mode === 'MOCK') {
    await setPostPublished(params.post.id);
    await savePublishLog({
      postId: params.post.id,
      storeId: params.post.store_id,
      actorUserId: params.actorUserId,
      provider: params.provider,
      mode: 'MOCK',
      status: 'SUCCESS',
      message: `GUI設定未完了のため${providerDisplay}のMOCK投稿として記録しました。`,
    });
    return {
      ok: true,
      provider: params.provider,
      mode: 'MOCK',
      status: 'SUCCESS',
      message: `MOCK投稿として完了しました。`,
    };
  }

  try {
    const result = await invokeFunctionByHttp(client, publishFunctionName(params.provider), {
      postId: params.post.id,
    });
    if (!result.ok) {
      const bodyError = getBodyError(result.body);
      throw new Error(bodyError ? `${bodyError}（status=${result.status}）` : `status=${result.status}`);
    }
    const body = (result.body || {}) as Record<string, unknown>;
    if (!body.ok) {
      throw new Error(getBodyError(result.body) || `${providerDisplay}投稿に失敗しました。`);
    }
    const externalPostId = typeof body.externalPostId === 'string' ? body.externalPostId : undefined;

    await setPostPublished(params.post.id);
    await savePublishLog({
      postId: params.post.id,
      storeId: params.post.store_id,
      actorUserId: params.actorUserId,
      provider: params.provider,
      mode: 'REAL',
      status: 'SUCCESS',
      message: `${providerDisplay} API への投稿に成功しました。`,
      externalPostId,
    });
    return {
      ok: true,
      provider: params.provider,
      mode: 'REAL',
      status: 'SUCCESS',
      message: `${providerDisplay}へ投稿しました。`,
      externalPostId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : `${providerDisplay}投稿に失敗しました。`;
    await setPostFailed(params.post.id);
    await savePublishLog({
      postId: params.post.id,
      storeId: params.post.store_id,
      actorUserId: params.actorUserId,
      provider: params.provider,
      mode: 'REAL',
      status: 'FAILED',
      message,
    });
    throw new Error(message);
  }
};

const loadPostForPublish = async (postId: string): Promise<DbPostRow> => {
  const client = requireSupabase();
  const { data: post, error: postError } = await client
    .from('posts')
    .select('id, store_id, content, platforms, scheduled_at, approval_status, status')
    .eq('id', postId)
    .maybeSingle();
  if (postError || !post) {
    throw new Error('投稿が見つかりません。');
  }
  return post as DbPostRow;
};

export const postPublishService = {
  async publishInstagramPost(params: { postId: string; actorUserId: string }): Promise<PublishExecutionResult> {
    const post = await loadPostForPublish(params.postId);
    assertPublishablePost(post, 'INSTAGRAM');
    return publishByProvider({
      post,
      actorUserId: params.actorUserId,
      provider: 'INSTAGRAM',
    });
  },

  async publishFacebookPost(params: { postId: string; actorUserId: string }): Promise<PublishExecutionResult> {
    const post = await loadPostForPublish(params.postId);
    assertPublishablePost(post, 'FACEBOOK');
    return publishByProvider({
      post,
      actorUserId: params.actorUserId,
      provider: 'FACEBOOK',
    });
  },

  async listByPost(postId: string): Promise<PostPublishLog[]> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('post_publish_logs')
      .select('id, post_id, store_id, provider, mode, status, message, external_post_id, requested_by_user_id, created_at')
      .eq('post_id', postId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return ((data || []) as DbPostPublishLogRow[]).map(mapPublishLog);
  },
};
