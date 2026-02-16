import { InboxReplyLog, PostPublishMode, ReplyExecutionResult } from '../types';
import { inboxService } from './inboxService';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import { getFunctionErrorMessage, invokeFunctionByHttp } from './functionHttpClient';

type ReplyProviderKey = 'FACEBOOK' | 'INSTAGRAM' | 'GBP';

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
  provider_capabilities?: { can_reply: boolean }[] | { can_reply: boolean } | null;
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

const providerDisplayName = (provider: ReplyProviderKey): string => {
  if (provider === 'FACEBOOK') return 'Facebook';
  if (provider === 'INSTAGRAM') return 'Instagram';
  return 'Googleビジネスプロフィール';
};

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、返信連携を実行できません。');
  }
  return supabase;
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
  const capabilityRaw = catalogRow.provider_capabilities;
  const canReply = Array.isArray(capabilityRaw)
    ? Boolean(capabilityRaw[0]?.can_reply)
    : Boolean(capabilityRaw && typeof capabilityRaw === 'object' && (capabilityRaw as { can_reply?: boolean }).can_reply);
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

const invokeReplyFunction = async (params: {
  functionName: string;
  payload: Record<string, unknown>;
  fallbackMessage: string;
}): Promise<{ externalReplyId?: string }> => {
  const result = await invokeFunctionByHttp(params.functionName, params.payload);
  if (!result.ok) {
    throw new Error(getFunctionErrorMessage(result, params.fallbackMessage));
  }

  const body = (result.body || {}) as Record<string, unknown>;
  if (!body.ok) {
    throw new Error(getBodyError(result.body) || params.fallbackMessage);
  }

  return {
    externalReplyId: typeof body.externalReplyId === 'string' ? body.externalReplyId : undefined,
  };
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
      const result = await invokeFunctionByHttp('facebook-reply-message', {
        messageId: message.id,
        replyText: params.replyContent,
      });
      if (!result.ok) {
        throw new Error(getFunctionErrorMessage(result, 'Facebook返信に失敗しました。'));
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

  async replyFacebookExternalMessage(params: {
    storeId: string;
    externalMessageId: string;
    replyContent: string;
  }): Promise<ReplyExecutionResult> {
    const mode = await resolveReplyMode(params.storeId, 'FACEBOOK');
    if (mode === 'MOCK') {
      return {
        ok: true,
        provider: 'FACEBOOK',
        mode: 'MOCK',
        status: 'SUCCESS',
        message: 'MOCK返信として完了しました。',
      };
    }

    const result = await invokeFunctionByHttp('facebook-reply-message', {
      storeId: params.storeId,
      externalMessageId: params.externalMessageId,
      replyText: params.replyContent,
    });
    if (!result.ok) {
      throw new Error(getFunctionErrorMessage(result, 'Facebook返信に失敗しました。'));
    }

    const body = (result.body || {}) as Record<string, unknown>;
    if (!body.ok) {
      throw new Error(getBodyError(result.body) || 'Facebook返信に失敗しました。');
    }

    return {
      ok: true,
      provider: 'FACEBOOK',
      mode: 'REAL',
      status: 'SUCCESS',
      externalReplyId: typeof body.externalReplyId === 'string' ? body.externalReplyId : undefined,
      message: 'Facebookへ返信しました。',
    };
  },

  async replyInstagramMessage(params: {
    messageId: string;
    actorUserId: string;
    replyContent: string;
  }): Promise<ReplyExecutionResult> {
    const message = await loadMessageForReply(params.messageId);
    if (message.provider !== 'INSTAGRAM') {
      throw new Error('このメッセージはInstagram返信対象ではありません。');
    }
    if (message.is_replied) {
      throw new Error('このメッセージはすでに返信済みです。');
    }

    const mode = await resolveReplyMode(message.store_id, 'INSTAGRAM');
    if (mode === 'MOCK') {
      await inboxService.replyToMessage(message.id, params.replyContent);
      await saveReplyLog({
        messageId: message.id,
        storeId: message.store_id,
        actorUserId: params.actorUserId,
        provider: 'INSTAGRAM',
        mode: 'MOCK',
        status: 'SUCCESS',
        message: 'GUI設定未完了のためInstagram返信をMOCKとして記録しました。',
      });
      return {
        ok: true,
        provider: 'INSTAGRAM',
        mode: 'MOCK',
        status: 'SUCCESS',
        message: 'MOCK返信として完了しました。',
      };
    }

    try {
      const { externalReplyId } = await invokeReplyFunction({
        functionName: 'instagram-reply-comment',
        payload: {
          messageId: message.id,
          replyText: params.replyContent,
        },
        fallbackMessage: 'Instagram返信に失敗しました。',
      });
      await inboxService.replyToMessage(message.id, params.replyContent);
      await saveReplyLog({
        messageId: message.id,
        storeId: message.store_id,
        actorUserId: params.actorUserId,
        provider: 'INSTAGRAM',
        mode: 'REAL',
        status: 'SUCCESS',
        message: 'Instagram Graph API への返信に成功しました。',
        externalReplyId,
      });
      return {
        ok: true,
        provider: 'INSTAGRAM',
        mode: 'REAL',
        status: 'SUCCESS',
        externalReplyId,
        message: 'Instagramへ返信しました。',
      };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Instagram返信に失敗しました。';
      await saveReplyLog({
        messageId: message.id,
        storeId: message.store_id,
        actorUserId: params.actorUserId,
        provider: 'INSTAGRAM',
        mode: 'REAL',
        status: 'FAILED',
        message: messageText,
      });
      throw new Error(messageText);
    }
  },

  async replyInstagramExternalComment(params: {
    storeId: string;
    externalMessageId: string;
    replyContent: string;
  }): Promise<ReplyExecutionResult> {
    const mode = await resolveReplyMode(params.storeId, 'INSTAGRAM');
    if (mode === 'MOCK') {
      return {
        ok: true,
        provider: 'INSTAGRAM',
        mode: 'MOCK',
        status: 'SUCCESS',
        message: 'MOCK返信として完了しました。',
      };
    }

    const { externalReplyId } = await invokeReplyFunction({
      functionName: 'instagram-reply-comment',
      payload: {
        storeId: params.storeId,
        externalMessageId: params.externalMessageId,
        replyText: params.replyContent,
      },
      fallbackMessage: 'Instagram返信に失敗しました。',
    });

    return {
      ok: true,
      provider: 'INSTAGRAM',
      mode: 'REAL',
      status: 'SUCCESS',
      externalReplyId,
      message: 'Instagramへ返信しました。',
    };
  },

  async replyGbpReview(params: {
    messageId: string;
    actorUserId: string;
    replyContent: string;
  }): Promise<ReplyExecutionResult> {
    const message = await loadMessageForReply(params.messageId);
    if (message.provider !== 'GBP') {
      throw new Error('このメッセージはGoogleビジネスプロフィール返信対象ではありません。');
    }
    if (message.is_replied) {
      throw new Error('このメッセージはすでに返信済みです。');
    }

    const mode = await resolveReplyMode(message.store_id, 'GBP');
    if (mode === 'MOCK') {
      await inboxService.replyToMessage(message.id, params.replyContent);
      await saveReplyLog({
        messageId: message.id,
        storeId: message.store_id,
        actorUserId: params.actorUserId,
        provider: 'GBP',
        mode: 'MOCK',
        status: 'SUCCESS',
        message: 'GUI設定未完了のためGBP返信をMOCKとして記録しました。',
      });
      return {
        ok: true,
        provider: 'GBP',
        mode: 'MOCK',
        status: 'SUCCESS',
        message: 'MOCK返信として完了しました。',
      };
    }

    try {
      const { externalReplyId } = await invokeReplyFunction({
        functionName: 'gbp-reply-review',
        payload: {
          messageId: message.id,
          replyText: params.replyContent,
        },
        fallbackMessage: 'Googleビジネスプロフィール返信に失敗しました。',
      });
      await inboxService.replyToMessage(message.id, params.replyContent);
      await saveReplyLog({
        messageId: message.id,
        storeId: message.store_id,
        actorUserId: params.actorUserId,
        provider: 'GBP',
        mode: 'REAL',
        status: 'SUCCESS',
        message: 'Googleビジネスプロフィール API への返信に成功しました。',
        externalReplyId,
      });
      return {
        ok: true,
        provider: 'GBP',
        mode: 'REAL',
        status: 'SUCCESS',
        externalReplyId,
        message: 'Googleビジネスプロフィールへ返信しました。',
      };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Googleビジネスプロフィール返信に失敗しました。';
      await saveReplyLog({
        messageId: message.id,
        storeId: message.store_id,
        actorUserId: params.actorUserId,
        provider: 'GBP',
        mode: 'REAL',
        status: 'FAILED',
        message: messageText,
      });
      throw new Error(messageText);
    }
  },

  async replyGbpExternalReview(params: {
    storeId: string;
    externalMessageId: string;
    replyContent: string;
  }): Promise<ReplyExecutionResult> {
    const mode = await resolveReplyMode(params.storeId, 'GBP');
    if (mode === 'MOCK') {
      return {
        ok: true,
        provider: 'GBP',
        mode: 'MOCK',
        status: 'SUCCESS',
        message: 'MOCK返信として完了しました。',
      };
    }

    const { externalReplyId } = await invokeReplyFunction({
      functionName: 'gbp-reply-review',
      payload: {
        storeId: params.storeId,
        externalMessageId: params.externalMessageId,
        replyText: params.replyContent,
      },
      fallbackMessage: 'Googleビジネスプロフィール返信に失敗しました。',
    });

    return {
      ok: true,
      provider: 'GBP',
      mode: 'REAL',
      status: 'SUCCESS',
      externalReplyId,
      message: 'Googleビジネスプロフィールへ返信しました。',
    };
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
