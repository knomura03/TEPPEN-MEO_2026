import { InboxReplyLog, PostPublishMode, ReplyExecutionResult } from '../types';
import { inboxService } from './inboxService';
import { isSupabaseConfigured, supabase } from './supabaseClient';

type ReplyProviderKey = 'FACEBOOK';

type DbInboxMessageRow = {
  id: string;
  store_id: string;
  provider: string;
  is_replied: boolean;
};

type DbStoreRow = {
  id: string;
  org_id: string;
};

type DbProviderCatalogRow = {
  id: string;
  provider_key: string;
  provider_capabilities?: { can_reply: boolean }[];
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

type DbInboxReplyLogRow = {
  id: string;
  message_id: string;
  store_id: string;
  provider: string;
  mode: PostPublishMode;
  status: 'SUCCESS' | 'FAILED';
  message: string | null;
  external_reply_id: string | null;
  requested_by_user_id: string | null;
  created_at: string;
};

type FunctionInvokeResult = {
  ok: boolean;
  status: number;
  body: unknown;
};

const providerDisplayName = (_provider: ReplyProviderKey): string => 'Facebook';

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、返信連携を実行できません。');
  }
  return supabase;
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

const getBodyError = (body: unknown): string => {
  if (!body || typeof body !== 'object') return '';
  const error = (body as Record<string, unknown>).error;
  const message = (body as Record<string, unknown>).message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (typeof message === 'string' && message.trim()) return message.trim();
  return '';
};

const mapReplyLog = (row: DbInboxReplyLogRow): InboxReplyLog => ({
  id: row.id,
  messageId: row.message_id,
  storeId: row.store_id,
  provider: row.provider,
  mode: row.mode,
  status: row.status,
  message: row.message || undefined,
  externalReplyId: row.external_reply_id || undefined,
  requestedByUserId: row.requested_by_user_id || undefined,
  createdAt: new Date(row.created_at),
});

const saveReplyLog = async (params: {
  messageId: string;
  storeId: string;
  actorUserId: string;
  provider: ReplyProviderKey;
  mode: PostPublishMode;
  status: 'SUCCESS' | 'FAILED';
  message?: string;
  externalReplyId?: string;
}) => {
  const client = requireSupabase();
  const { error } = await client.from('inbox_reply_logs').insert({
    message_id: params.messageId,
    store_id: params.storeId,
    provider: params.provider,
    mode: params.mode,
    status: params.status,
    message: params.message || null,
    external_reply_id: params.externalReplyId || null,
    requested_by_user_id: params.actorUserId,
  });
  if (error) throw error;
};

const resolveReplyMode = async (storeId: string, provider: ReplyProviderKey): Promise<PostPublishMode> => {
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
    .select('id, provider_key, provider_capabilities(can_reply)')
    .eq('org_id', storeRow.org_id)
    .eq('provider_key', provider)
    .eq('is_active', true)
    .maybeSingle();
  if (catalogError || !catalog) {
    throw new Error(`${providerDisplayName(provider)} provider が見つかりません。`);
  }
  const catalogRow = catalog as DbProviderCatalogRow;
  const canReply = Boolean(catalogRow.provider_capabilities?.[0]?.can_reply);
  if (!canReply) {
    throw new Error(`${providerDisplayName(provider)} provider の reply 権限が無効です。`);
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

const loadMessageForReply = async (messageId: string): Promise<DbInboxMessageRow> => {
  const client = requireSupabase();
  const { data, error } = await client
    .from('inbox_messages')
    .select('id, store_id, provider, is_replied')
    .eq('id', messageId)
    .maybeSingle();
  if (error || !data) {
    throw new Error('返信対象メッセージが見つかりません。');
  }
  return data as DbInboxMessageRow;
};

export const messageReplyService = {
  async replyFacebookMessage(params: {
    messageId: string;
    actorUserId: string;
    replyContent: string;
  }): Promise<ReplyExecutionResult> {
    const client = requireSupabase();
    const message = await loadMessageForReply(params.messageId);

    if (message.provider !== 'FACEBOOK') {
      throw new Error('このメッセージはFacebook返信対象ではありません。');
    }
    if (message.is_replied) {
      throw new Error('このメッセージはすでに返信済みです。');
    }

    const mode = await resolveReplyMode(message.store_id, 'FACEBOOK');
    if (mode === 'MOCK') {
      await inboxService.replyToMessage(message.id, params.replyContent);
      await saveReplyLog({
        messageId: message.id,
        storeId: message.store_id,
        actorUserId: params.actorUserId,
        provider: 'FACEBOOK',
        mode: 'MOCK',
        status: 'SUCCESS',
        message: 'GUI設定未完了のためFacebook返信をMOCKとして記録しました。',
      });
      return {
        ok: true,
        provider: 'FACEBOOK',
        mode: 'MOCK',
        status: 'SUCCESS',
        message: 'MOCK返信として完了しました。',
      };
    }

    try {
      const result = await invokeFunctionByHttp(client, 'facebook-reply-message', {
        messageId: message.id,
        replyText: params.replyContent,
      });
      if (!result.ok) {
        const bodyError = getBodyError(result.body);
        throw new Error(bodyError ? `${bodyError}（status=${result.status}）` : `status=${result.status}`);
      }
      const body = (result.body || {}) as Record<string, unknown>;
      if (!body.ok) {
        throw new Error(getBodyError(result.body) || 'Facebook返信に失敗しました。');
      }
      const externalReplyId = typeof body.externalReplyId === 'string' ? body.externalReplyId : undefined;

      await inboxService.replyToMessage(message.id, params.replyContent);
      await saveReplyLog({
        messageId: message.id,
        storeId: message.store_id,
        actorUserId: params.actorUserId,
        provider: 'FACEBOOK',
        mode: 'REAL',
        status: 'SUCCESS',
        message: 'Facebook Graph API への返信に成功しました。',
        externalReplyId,
      });
      return {
        ok: true,
        provider: 'FACEBOOK',
        mode: 'REAL',
        status: 'SUCCESS',
        externalReplyId,
        message: 'Facebookへ返信しました。',
      };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Facebook返信に失敗しました。';
      await saveReplyLog({
        messageId: message.id,
        storeId: message.store_id,
        actorUserId: params.actorUserId,
        provider: 'FACEBOOK',
        mode: 'REAL',
        status: 'FAILED',
        message: messageText,
      });
      throw new Error(messageText);
    }
  },

  async listByMessage(messageId: string): Promise<InboxReplyLog[]> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('inbox_reply_logs')
      .select('id, message_id, store_id, provider, mode, status, message, external_reply_id, requested_by_user_id, created_at')
      .eq('message_id', messageId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return ((data || []) as DbInboxReplyLogRow[]).map(mapReplyLog);
  },
};
