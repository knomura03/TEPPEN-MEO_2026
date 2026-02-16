import { resolveAuthenticatedUserId } from '../_shared/auth.ts';
import { decryptAesGcm } from '../_shared/crypto.ts';
import { extractProviderErrorMessage, fetchJson, jsonResponse, optionsResponse, readString } from '../_shared/http.ts';
import { resolveMetaPageAccessToken, resolveMetaUserAccessToken } from '../_shared/metaAuth.ts';
import { createServiceRoleClient, requireEnv } from '../_shared/supabase.ts';

type ProviderKey = 'FACEBOOK' | 'INSTAGRAM' | 'GBP';
type ChannelKey = 'REVIEWS' | 'DM';
type ReactionKey = 'LIKE' | 'ANGRY';

type ProviderContext = {
  config: Record<string, unknown>;
  encryptedPayload: string;
};

const parseProvider = (value: unknown): ProviderKey | null => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'FACEBOOK' || normalized === 'INSTAGRAM' || normalized === 'GBP') return normalized;
  return null;
};

const parseChannel = (value: unknown): ChannelKey => {
  return String(value || '').trim().toUpperCase() === 'DM' ? 'DM' : 'REVIEWS';
};

const parseReaction = (value: unknown): ReactionKey | null => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'LIKE' || normalized === 'ANGRY') return normalized;
  return null;
};

const isAlreadyReactedMessage = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('already') ||
    normalized.includes('既に') ||
    normalized.includes('duplicate') ||
    normalized.includes('same reaction')
  );
};

const shouldRetryWithFallbackToken = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('unsupported post request') ||
    normalized.includes('does not exist') ||
    normalized.includes('missing permissions') ||
    normalized.includes('requires permission') ||
    normalized.includes('cannot be loaded')
  );
};

const ensureStoreAccess = async (params: {
  supabaseAdmin: any;
  userId: string;
  storeId: string;
}): Promise<{ ok: boolean; orgId?: string; error?: string }> => {
  const { data: store, error: storeError } = await params.supabaseAdmin
    .from('stores')
    .select('id, org_id')
    .eq('id', params.storeId)
    .maybeSingle();
  if (storeError || !store?.org_id) {
    return { ok: false, error: 'Store not found' };
  }

  const { data: memberships, error: membershipError } = await params.supabaseAdmin
    .from('memberships')
    .select('role, store_id')
    .eq('user_id', params.userId)
    .eq('org_id', store.org_id);
  if (membershipError || !memberships || memberships.length === 0) {
    return { ok: false, error: 'Not allowed' };
  }

  const canAccess = memberships.some((row: { role?: string; store_id?: string | null }) => {
    const role = String(row.role || '').toUpperCase();
    if (role === 'ADMIN' || role === 'SUPERVISOR' || role === 'MANAGER') return true;
    return row.store_id === params.storeId;
  });
  return canAccess ? { ok: true, orgId: store.org_id } : { ok: false, error: 'Not allowed' };
};

const loadProviderContext = async (params: {
  supabaseAdmin: any;
  storeId: string;
  orgId: string;
  provider: ProviderKey;
  encryptionKey: string;
}): Promise<{ context?: ProviderContext; reason?: string }> => {
  const { data: catalog } = await params.supabaseAdmin
    .from('provider_catalog')
    .select('id')
    .eq('org_id', params.orgId)
    .eq('provider_key', params.provider)
    .eq('is_active', true)
    .maybeSingle();
  if (!catalog?.id) return { reason: '連携先カタログが無効です。' };

  const { data: configuration } = await params.supabaseAdmin
    .from('provider_configurations')
    .select('id, config, connection_status, last_error')
    .eq('store_id', params.storeId)
    .eq('provider_catalog_id', catalog.id)
    .maybeSingle();
  if (!configuration) return { reason: '連携設定が未作成です。' };
  const configurationStatus = String(configuration.connection_status || '').toUpperCase();
  if (configurationStatus === 'DISCONNECTED') {
    const detail = typeof configuration.last_error === 'string' && configuration.last_error.trim().length > 0
      ? `（${configuration.last_error.trim()}）`
      : '';
    return { reason: `未接続です。${detail}` };
  }

  const { data: integration } = await params.supabaseAdmin
    .from('integrations')
    .select('id, status, last_error')
    .eq('store_id', params.storeId)
    .eq('provider', params.provider)
    .maybeSingle();
  if (!integration?.id) return { reason: 'integration情報が見つかりません。' };
  const integrationStatus = String(integration.status || '').toUpperCase();
  if (integrationStatus === 'DISCONNECTED') {
    const detail = typeof integration.last_error === 'string' && integration.last_error.trim().length > 0
      ? `（${integration.last_error.trim()}）`
      : '';
    return { reason: `integrationが未接続です。${detail}` };
  }

  const { data: credential } = await params.supabaseAdmin
    .from('integration_credentials')
    .select('encrypted_payload')
    .eq('integration_id', integration.id)
    .maybeSingle();
  if (!credential?.encrypted_payload) return { reason: 'OAuth認証情報が見つかりません。' };

  if (params.provider === 'GBP') {
    const { data: secret } = await params.supabaseAdmin
      .from('provider_secrets')
      .select('encrypted_secret')
      .eq('provider_configuration_id', configuration.id)
      .maybeSingle();
    if (secret?.encrypted_secret) {
      try {
        await decryptAesGcm(String(secret.encrypted_secret), params.encryptionKey);
      } catch {
        return { reason: 'GBPシークレットの復号に失敗しました。' };
      }
    }
  }

  return {
    context: {
      config: configuration.config && typeof configuration.config === 'object'
        ? (configuration.config as Record<string, unknown>)
        : {},
      encryptedPayload: String(credential.encrypted_payload),
    },
  };
};

const applyFacebookReaction = async (params: {
  graphApiVersion: string;
  externalMessageId: string;
  channel: ChannelKey;
  reaction: ReactionKey;
  accessToken: string;
}): Promise<{ ok: boolean; message?: string }> => {
  const headers = {
    Authorization: `Bearer ${params.accessToken}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  if (params.channel === 'REVIEWS') {
    if (params.reaction === 'LIKE') {
      const likeResponse = await fetchJson(
        `https://graph.facebook.com/${params.graphApiVersion}/${encodeURIComponent(params.externalMessageId)}/likes`,
        {
          method: 'POST',
          headers,
        },
      );
      if (likeResponse.ok) return { ok: true };
      const likeError = extractProviderErrorMessage(likeResponse.body);
      if (likeError && isAlreadyReactedMessage(likeError)) return { ok: true };
      return { ok: false, message: likeError || `Facebookリアクションに失敗しました。（status=${likeResponse.status}）` };
    }

    const form = new URLSearchParams();
    form.set('type', 'ANGRY');
    const reactionResponse = await fetchJson(
      `https://graph.facebook.com/${params.graphApiVersion}/${encodeURIComponent(params.externalMessageId)}/reactions`,
      {
        method: 'POST',
        headers,
        body: form.toString(),
      },
    );
    if (reactionResponse.ok) return { ok: true };
    const errorMessage = extractProviderErrorMessage(reactionResponse.body);
    if (errorMessage && isAlreadyReactedMessage(errorMessage)) return { ok: true };
    return { ok: false, message: errorMessage || `Facebookリアクションに失敗しました。（status=${reactionResponse.status}）` };
  }

  const dmForm = new URLSearchParams();
  dmForm.set('reaction', params.reaction === 'LIKE' ? 'love' : 'sad');
  const dmResponse = await fetchJson(
    `https://graph.facebook.com/${params.graphApiVersion}/${encodeURIComponent(params.externalMessageId)}/reactions`,
    {
      method: 'POST',
      headers,
      body: dmForm.toString(),
    },
  );
  if (dmResponse.ok) return { ok: true };
  const dmError = extractProviderErrorMessage(dmResponse.body);
  if (dmError && isAlreadyReactedMessage(dmError)) return { ok: true };
  return { ok: false, message: dmError || `Facebook DMリアクションに失敗しました。（status=${dmResponse.status}）` };
};

const applyInstagramReaction = async (params: {
  graphApiVersion: string;
  externalMessageId: string;
  channel: ChannelKey;
  reaction: ReactionKey;
  accessToken: string;
  fallbackAccessToken?: string;
}): Promise<{ ok: boolean; message?: string }> => {
  if (params.reaction !== 'LIKE') {
    return { ok: false, message: 'Instagramはハートのみ送信できます。' };
  }

  const headers = {
    Authorization: `Bearer ${params.accessToken}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  if (params.channel === 'REVIEWS') {
    const sendLike = async (token: string): Promise<{ ok: boolean; message?: string }> => {
      const response = await fetchJson(
        `https://graph.facebook.com/${params.graphApiVersion}/${encodeURIComponent(params.externalMessageId)}/likes`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );
      if (response.ok) return { ok: true };
      const errorMessage = extractProviderErrorMessage(response.body);
      if (errorMessage && isAlreadyReactedMessage(errorMessage)) return { ok: true };
      return { ok: false, message: errorMessage || `Instagramリアクションに失敗しました。（status=${response.status}）` };
    };

    const firstTry = await sendLike(params.accessToken);
    if (firstTry.ok) return firstTry;
    const fallback = params.fallbackAccessToken;
    if (fallback && fallback !== params.accessToken && firstTry.message && shouldRetryWithFallbackToken(firstTry.message)) {
      const secondTry = await sendLike(fallback);
      if (secondTry.ok) return secondTry;
      return secondTry;
    }
    return firstTry;
  }

  const dmForm = new URLSearchParams();
  dmForm.set('reaction', 'love');
  const dmResponse = await fetchJson(
    `https://graph.facebook.com/${params.graphApiVersion}/${encodeURIComponent(params.externalMessageId)}/reactions`,
    {
      method: 'POST',
      headers,
      body: dmForm.toString(),
    },
  );
  if (dmResponse.ok) return { ok: true };
  const dmError = extractProviderErrorMessage(dmResponse.body);
  if (dmError && isAlreadyReactedMessage(dmError)) return { ok: true };
  return { ok: false, message: dmError || `Instagram DMリアクションに失敗しました。（status=${dmResponse.status}）` };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return optionsResponse();
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  let supabaseUrl = '';
  let serviceRoleKey = '';
  let encryptionKey = '';
  let supabaseAdmin: any;

  try {
    const runtime = createServiceRoleClient();
    supabaseUrl = runtime.supabaseUrl;
    serviceRoleKey = runtime.serviceRoleKey;
    encryptionKey = requireEnv('PROVIDER_CONFIG_ENCRYPTION_KEY');
    supabaseAdmin = runtime.client;
  } catch (error) {
    return jsonResponse(500, { error: error instanceof Error ? error.message : 'Missing env vars' });
  }

  const auth = await resolveAuthenticatedUserId(req, supabaseUrl, serviceRoleKey);
  if (!auth.userId) {
    return jsonResponse(401, { error: auth.error || 'Invalid auth token' });
  }

  let payload: {
    messageId?: string;
    storeId?: string;
    provider?: string;
    externalMessageId?: string;
    channel?: string;
    reaction?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const reaction = parseReaction(payload.reaction);
  if (!reaction) {
    return jsonResponse(400, { error: 'reaction は LIKE / ANGRY のみ指定できます。' });
  }

  let storeId = payload.storeId?.trim() || '';
  let provider = parseProvider(payload.provider);
  let externalMessageId = payload.externalMessageId?.trim() || '';
  let channel = parseChannel(payload.channel);

  const messageId = payload.messageId?.trim();
  if (messageId) {
    const { data: messageRow, error: messageError } = await supabaseAdmin
      .from('inbox_messages')
      .select('id, store_id, provider, external_message_id')
      .eq('id', messageId)
      .maybeSingle();
    if (messageError || !messageRow) {
      return jsonResponse(404, { error: '受信メッセージが見つかりません。' });
    }
    storeId = String(messageRow.store_id || '');
    provider = parseProvider(messageRow.provider);
    externalMessageId = String(messageRow.external_message_id || '');
    channel = 'REVIEWS';
  }

  if (!storeId || !provider || !externalMessageId) {
    return jsonResponse(400, { error: 'storeId/provider/externalMessageId が不足しています。' });
  }

  const access = await ensureStoreAccess({
    supabaseAdmin,
    userId: auth.userId,
    storeId,
  });
  if (!access.ok || !access.orgId) {
    return jsonResponse(403, { error: access.error || 'Not allowed' });
  }

  if (provider === 'GBP') {
    return jsonResponse(400, {
      error: 'Googleビジネスプロフィールの口コミリアクションはAPI未対応です。返信機能をご利用ください。',
    });
  }

  const contextResult = await loadProviderContext({
    supabaseAdmin,
    storeId,
    orgId: access.orgId,
    provider,
    encryptionKey,
  });
  if (!contextResult.context) {
    return jsonResponse(400, { error: contextResult.reason || '連携情報が未設定です。' });
  }

  const graphApiVersion = readString(contextResult.context.config, ['graph_api_version']) || 'v20.0';
  const { accessToken: userAccessToken } = await resolveMetaUserAccessToken({
    encryptedPayload: contextResult.context.encryptedPayload,
    encryptionKey,
  });
  if (!userAccessToken) {
    return jsonResponse(400, { error: 'アクセストークンを取得できませんでした。再連携してください。' });
  }

  const preferredPageId = readString(contextResult.context.config, ['facebook_page_id', 'fb_page_id', 'page_id']);
  const pageResult = await resolveMetaPageAccessToken({
    userAccessToken: userAccessToken,
    graphApiVersion,
    preferredPageId: preferredPageId || undefined,
  });
  if (!pageResult.ok && provider === 'FACEBOOK') {
    return jsonResponse(400, { error: pageResult.error || 'ページアクセストークンを取得できませんでした。' });
  }

  if (provider === 'FACEBOOK' && !pageResult.pageAccessToken) {
    return jsonResponse(400, { error: pageResult.error || 'ページアクセストークンを取得できませんでした。' });
  }

  const reactionResult = provider === 'FACEBOOK'
    ? await applyFacebookReaction({
      graphApiVersion,
      externalMessageId,
      channel,
      reaction,
      accessToken: pageResult.pageAccessToken as string,
    })
    : await applyInstagramReaction({
      graphApiVersion,
      externalMessageId,
      channel,
      reaction,
      accessToken: pageResult.pageAccessToken || userAccessToken,
      fallbackAccessToken: pageResult.pageAccessToken ? userAccessToken : undefined,
    });

  if (!reactionResult.ok) {
    return jsonResponse(400, { error: reactionResult.message || 'リアクション送信に失敗しました。' });
  }

  return jsonResponse(200, {
    ok: true,
    storeId,
    provider,
    channel,
    externalMessageId,
    reaction,
  });
});
