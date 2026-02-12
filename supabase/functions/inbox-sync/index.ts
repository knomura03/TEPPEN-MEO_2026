import { resolveAuthenticatedUserId } from '../_shared/auth.ts';
import { decryptAesGcm } from '../_shared/crypto.ts';
import { ensureGoogleAccessToken } from '../_shared/googleAuth.ts';
import { extractProviderErrorMessage, fetchJson, jsonResponse, optionsResponse, readString } from '../_shared/http.ts';
import { resolveMetaPageAccessToken, resolveMetaUserAccessToken } from '../_shared/metaAuth.ts';
import { createServiceRoleClient, requireEnv } from '../_shared/supabase.ts';

type ProviderKey = 'FACEBOOK' | 'INSTAGRAM' | 'GBP';

type SyncMessage = {
  threadExternalId: string;
  externalMessageId: string;
  senderName: string;
  senderAvatarUrl?: string;
  content: string;
  receivedAt: string;
};

const parseProviders = (input: unknown): ProviderKey[] => {
  if (!Array.isArray(input) || input.length === 0) return ['FACEBOOK', 'INSTAGRAM', 'GBP'];
  const normalized = input
    .map((item) => String(item || '').trim().toUpperCase())
    .filter((item): item is ProviderKey => item === 'FACEBOOK' || item === 'INSTAGRAM' || item === 'GBP');
  return Array.from(new Set(normalized));
};

const toIso = (value: unknown): string => {
  if (typeof value === 'string' && value.trim()) {
    const ts = new Date(value).getTime();
    if (!Number.isNaN(ts)) return new Date(ts).toISOString();
  }
  return new Date().toISOString();
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
}): Promise<{
  configurationId: string;
  config: Record<string, unknown>;
  integrationId: string;
  encryptedPayload: string;
  providerSecret?: string;
} | null> => {
  const { data: catalog } = await params.supabaseAdmin
    .from('provider_catalog')
    .select('id')
    .eq('org_id', params.orgId)
    .eq('provider_key', params.provider)
    .eq('is_active', true)
    .maybeSingle();
  if (!catalog?.id) return null;

  const { data: configuration } = await params.supabaseAdmin
    .from('provider_configurations')
    .select('id, config, connection_status')
    .eq('store_id', params.storeId)
    .eq('provider_catalog_id', catalog.id)
    .maybeSingle();
  if (!configuration || configuration.connection_status !== 'CONNECTED') return null;

  const { data: integration } = await params.supabaseAdmin
    .from('integrations')
    .select('id, status')
    .eq('store_id', params.storeId)
    .eq('provider', params.provider)
    .maybeSingle();
  if (!integration?.id || integration.status !== 'CONNECTED') return null;

  const { data: credential } = await params.supabaseAdmin
    .from('integration_credentials')
    .select('encrypted_payload')
    .eq('integration_id', integration.id)
    .maybeSingle();
  if (!credential?.encrypted_payload) return null;

  let providerSecret = '';
  if (params.provider === 'GBP') {
    const { data: secret } = await params.supabaseAdmin
      .from('provider_secrets')
      .select('encrypted_secret')
      .eq('provider_configuration_id', configuration.id)
      .maybeSingle();

    if (secret?.encrypted_secret) {
      try {
        providerSecret = await decryptAesGcm(String(secret.encrypted_secret), params.encryptionKey);
      } catch {
        providerSecret = '';
      }
    }
  }

  return {
    configurationId: configuration.id,
    config: configuration.config && typeof configuration.config === 'object' ? configuration.config : {},
    integrationId: integration.id,
    encryptedPayload: String(credential.encrypted_payload),
    providerSecret: providerSecret || undefined,
  };
};

const ensureThread = async (params: {
  supabaseAdmin: any;
  storeId: string;
  provider: ProviderKey;
  threadExternalId: string;
  lastMessageAt: string;
}): Promise<string> => {
  const { data: existing } = await params.supabaseAdmin
    .from('inbox_threads')
    .select('id')
    .eq('store_id', params.storeId)
    .eq('provider', params.provider)
    .eq('external_thread_id', params.threadExternalId)
    .maybeSingle();

  if (existing?.id) {
    await params.supabaseAdmin
      .from('inbox_threads')
      .update({ last_message_at: params.lastMessageAt })
      .eq('id', existing.id);
    return existing.id;
  }

  const { data: inserted, error: insertError } = await params.supabaseAdmin
    .from('inbox_threads')
    .insert({
      store_id: params.storeId,
      provider: params.provider,
      external_thread_id: params.threadExternalId,
      status: 'OPEN',
      last_message_at: params.lastMessageAt,
    })
    .select('id')
    .single();

  if (insertError || !inserted?.id) {
    throw new Error(insertError?.message || 'inbox_threads insert failed');
  }

  return inserted.id;
};

const upsertMessages = async (params: {
  supabaseAdmin: any;
  storeId: string;
  provider: ProviderKey;
  messages: SyncMessage[];
}): Promise<number> => {
  let syncedCount = 0;

  for (const message of params.messages) {
    const threadId = await ensureThread({
      supabaseAdmin: params.supabaseAdmin,
      storeId: params.storeId,
      provider: params.provider,
      threadExternalId: message.threadExternalId,
      lastMessageAt: message.receivedAt,
    });

    const { error } = await params.supabaseAdmin
      .from('inbox_messages')
      .upsert(
        {
          thread_id: threadId,
          store_id: params.storeId,
          provider: params.provider,
          external_message_id: message.externalMessageId,
          sender_name: message.senderName || null,
          sender_avatar_url: message.senderAvatarUrl || null,
          content: message.content,
          received_at: message.receivedAt,
        },
        { onConflict: 'store_id,provider,external_message_id' }
      );

    if (!error) {
      syncedCount += 1;
    }
  }

  return syncedCount;
};

const syncFacebookComments = async (params: {
  context: { config: Record<string, unknown>; encryptedPayload: string };
  encryptionKey: string;
  limit: number;
}): Promise<SyncMessage[]> => {
  const { accessToken } = await resolveMetaUserAccessToken({
    encryptedPayload: params.context.encryptedPayload,
    encryptionKey: params.encryptionKey,
  });
  if (!accessToken) return [];

  const graphApiVersion = readString(params.context.config, ['graph_api_version']) || 'v20.0';
  const preferredPageId = readString(params.context.config, ['facebook_page_id', 'fb_page_id', 'page_id']);
  const pageResult = await resolveMetaPageAccessToken({
    userAccessToken: accessToken,
    graphApiVersion,
    preferredPageId: preferredPageId || undefined,
  });
  if (!pageResult.ok || !pageResult.pageId || !pageResult.pageAccessToken) return [];

  const endpoint = `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(pageResult.pageId)}/feed?fields=${encodeURIComponent('id,message,created_time,comments.limit(25){id,message,created_time,from{id,name,picture}}')}&limit=${params.limit}`;
  const feed = await fetchJson(endpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${pageResult.pageAccessToken}` },
  });
  if (!feed.ok || !feed.body || typeof feed.body !== 'object') return [];

  const posts = Array.isArray((feed.body as Record<string, unknown>).data)
    ? ((feed.body as Record<string, unknown>).data as unknown[])
    : [];

  const messages: SyncMessage[] = [];
  for (const post of posts) {
    if (!post || typeof post !== 'object') continue;
    const postRow = post as Record<string, unknown>;
    const postId = typeof postRow.id === 'string' ? postRow.id : '';
    if (!postId) continue;

    const commentsContainer =
      postRow.comments && typeof postRow.comments === 'object'
        ? (postRow.comments as Record<string, unknown>)
        : null;
    const comments = commentsContainer && Array.isArray(commentsContainer.data)
      ? (commentsContainer.data as unknown[])
      : [];

    for (const comment of comments) {
      if (!comment || typeof comment !== 'object') continue;
      const row = comment as Record<string, unknown>;
      const commentId = typeof row.id === 'string' ? row.id : '';
      if (!commentId) continue;
      const from = row.from && typeof row.from === 'object' ? (row.from as Record<string, unknown>) : {};

      messages.push({
        threadExternalId: `fb_post:${postId}`,
        externalMessageId: commentId,
        senderName: typeof from.name === 'string' ? from.name : 'Facebookユーザー',
        senderAvatarUrl:
          from.picture && typeof from.picture === 'object' && typeof (from.picture as Record<string, unknown>).data === 'object'
            ? readString((from.picture as Record<string, unknown>).data as Record<string, unknown>, ['url'])
            : undefined,
        content: typeof row.message === 'string' ? row.message : '',
        receivedAt: toIso(row.created_time),
      });
    }
  }

  return messages;
};

const syncInstagramComments = async (params: {
  context: { config: Record<string, unknown>; encryptedPayload: string };
  encryptionKey: string;
  limit: number;
}): Promise<SyncMessage[]> => {
  const { accessToken } = await resolveMetaUserAccessToken({
    encryptedPayload: params.context.encryptedPayload,
    encryptionKey: params.encryptionKey,
  });
  if (!accessToken) return [];

  const graphApiVersion = readString(params.context.config, ['graph_api_version']) || 'v20.0';
  const preferredPageId = readString(params.context.config, ['facebook_page_id', 'fb_page_id', 'page_id']);
  const pageResult = await resolveMetaPageAccessToken({
    userAccessToken: accessToken,
    graphApiVersion,
    preferredPageId: preferredPageId || undefined,
  });
  if (!pageResult.ok) return [];

  const instagramUserId = readString(params.context.config, ['instagram_user_id', 'ig_user_id']) || pageResult.instagramUserId || '';
  if (!instagramUserId) return [];

  const token = pageResult.pageAccessToken || accessToken;
  const mediaEndpoint = `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(instagramUserId)}/media?fields=${encodeURIComponent('id,caption,permalink,timestamp,comments_count')}&limit=${params.limit}`;
  const mediaResponse = await fetchJson(mediaEndpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!mediaResponse.ok || !mediaResponse.body || typeof mediaResponse.body !== 'object') return [];
  const mediaRows = Array.isArray((mediaResponse.body as Record<string, unknown>).data)
    ? ((mediaResponse.body as Record<string, unknown>).data as unknown[])
    : [];

  const messages: SyncMessage[] = [];

  for (const mediaRow of mediaRows) {
    if (!mediaRow || typeof mediaRow !== 'object') continue;
    const media = mediaRow as Record<string, unknown>;
    const mediaId = typeof media.id === 'string' ? media.id : '';
    if (!mediaId) continue;

    const commentEndpoint = `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(mediaId)}/comments?fields=${encodeURIComponent('id,text,timestamp,username')}&limit=25`;
    const commentResponse = await fetchJson(commentEndpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!commentResponse.ok || !commentResponse.body || typeof commentResponse.body !== 'object') {
      continue;
    }

    const commentRows = Array.isArray((commentResponse.body as Record<string, unknown>).data)
      ? ((commentResponse.body as Record<string, unknown>).data as unknown[])
      : [];

    for (const commentRow of commentRows) {
      if (!commentRow || typeof commentRow !== 'object') continue;
      const comment = commentRow as Record<string, unknown>;
      const commentId = typeof comment.id === 'string' ? comment.id : '';
      if (!commentId) continue;

      messages.push({
        threadExternalId: `ig_media:${mediaId}`,
        externalMessageId: commentId,
        senderName: typeof comment.username === 'string' ? comment.username : 'Instagramユーザー',
        content: typeof comment.text === 'string' ? comment.text : '',
        receivedAt: toIso(comment.timestamp),
      });
    }
  }

  return messages;
};

const resolveGbpReviewsEndpoint = (config: Record<string, unknown>) => {
  const locationName = readString(config, ['location_name', 'gbp_location_name']);
  if (locationName && locationName.startsWith('accounts/')) {
    return `https://mybusiness.googleapis.com/v4/${locationName}/reviews`;
  }

  const accountId = readString(config, ['gbp_account_id', 'account_id']);
  const locationId = readString(config, ['gbp_location_id', 'location_id']);
  if (accountId && locationId) {
    return `https://mybusiness.googleapis.com/v4/accounts/${encodeURIComponent(accountId)}/locations/${encodeURIComponent(locationId)}/reviews`;
  }

  return '';
};

const syncGbpReviews = async (params: {
  supabaseAdmin: any;
  context: { config: Record<string, unknown>; integrationId: string; encryptedPayload: string; providerSecret?: string };
  encryptionKey: string;
}): Promise<{ rows: SyncMessage[]; error?: string }> => {
  const clientId = readString(params.context.config, ['client_id', 'google_client_id']);
  if (!clientId || !params.context.providerSecret) {
    return { rows: [], error: 'GBPの client_id/client_secret が未設定です。' };
  }

  const endpoint = resolveGbpReviewsEndpoint(params.context.config);
  if (!endpoint) {
    return { rows: [], error: 'GBPの account_id / location_id が未設定です。' };
  }

  const token = await ensureGoogleAccessToken({
    supabaseAdmin: params.supabaseAdmin,
    integrationId: params.context.integrationId,
    encryptedPayload: params.context.encryptedPayload,
    encryptionKey: params.encryptionKey,
    clientId,
    clientSecret: params.context.providerSecret,
  });

  if (!token.ok || !token.accessToken) {
    return { rows: [], error: token.error || 'GBP access_token の取得に失敗しました。' };
  }

  const reviewResponse = await fetchJson(endpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token.accessToken}` },
  });

  if (!reviewResponse.ok || !reviewResponse.body || typeof reviewResponse.body !== 'object') {
    return {
      rows: [],
      error: extractProviderErrorMessage(reviewResponse.body) || `GBP口コミの取得に失敗しました。（status=${reviewResponse.status}）`,
    };
  }

  const reviewRows = Array.isArray((reviewResponse.body as Record<string, unknown>).reviews)
    ? ((reviewResponse.body as Record<string, unknown>).reviews as unknown[])
    : [];

  const rows: SyncMessage[] = reviewRows
    .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : null))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((row) => {
      const reviewer = row.reviewer && typeof row.reviewer === 'object' ? (row.reviewer as Record<string, unknown>) : {};
      const reviewId = typeof row.reviewId === 'string' ? row.reviewId : typeof row.name === 'string' ? row.name : '';
      return {
        threadExternalId: `gbp_review:${reviewId}`,
        externalMessageId: reviewId,
        senderName: readString(reviewer, ['displayName']) || 'Googleユーザー',
        senderAvatarUrl: readString(reviewer, ['profilePhotoUrl']) || undefined,
        content: typeof row.comment === 'string' ? row.comment : '(コメントなし)',
        receivedAt: toIso(row.updateTime || row.createTime),
      };
    })
    .filter((row) => row.externalMessageId.length > 0);

  return { rows };
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
    supabaseAdmin = runtime.client;
    encryptionKey = requireEnv('PROVIDER_CONFIG_ENCRYPTION_KEY');
  } catch (error) {
    return jsonResponse(500, { error: error instanceof Error ? error.message : 'Missing env vars' });
  }

  const auth = await resolveAuthenticatedUserId(req, supabaseUrl, serviceRoleKey);
  if (!auth.userId) {
    return jsonResponse(401, { error: auth.error || 'Invalid auth token' });
  }

  let payload: { storeId?: string; providers?: string[]; mode?: 'LATEST_ONLY' | 'FULL' };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const storeId = payload.storeId?.trim();
  if (!storeId) {
    return jsonResponse(400, { error: 'Missing storeId' });
  }

  const access = await ensureStoreAccess({
    supabaseAdmin,
    userId: auth.userId,
    storeId,
  });
  if (!access.ok || !access.orgId) {
    return jsonResponse(403, { error: access.error || 'Not allowed' });
  }

  const providers = parseProviders(payload.providers);
  const fetchLimit = payload.mode === 'FULL' ? 100 : 20;

  const syncedCountByProvider: Record<string, number> = {};
  const errors: Record<string, string> = {};

  for (const provider of providers) {
    syncedCountByProvider[provider] = 0;

    const context = await loadProviderContext({
      supabaseAdmin,
      storeId,
      orgId: access.orgId,
      provider,
      encryptionKey,
    });

    if (!context) {
      errors[provider] = '連携情報が未設定です。';
      continue;
    }

    try {
      let messages: SyncMessage[] = [];
      if (provider === 'FACEBOOK') {
        messages = await syncFacebookComments({
          context,
          encryptionKey,
          limit: fetchLimit,
        });
      } else if (provider === 'INSTAGRAM') {
        messages = await syncInstagramComments({
          context,
          encryptionKey,
          limit: fetchLimit,
        });
      } else {
        const gbp = await syncGbpReviews({
          supabaseAdmin,
          context,
          encryptionKey,
        });
        messages = gbp.rows;
        if (gbp.error) {
          errors[provider] = gbp.error;
        }
      }

      if (messages.length > 0) {
        syncedCountByProvider[provider] = await upsertMessages({
          supabaseAdmin,
          storeId,
          provider,
          messages,
        });
      }

      await supabaseAdmin.from('integrations').upsert(
        {
          store_id: storeId,
          provider,
          status: 'CONNECTED',
          last_sync_at: new Date().toISOString(),
          last_error: errors[provider] || null,
        },
        { onConflict: 'store_id,provider' }
      );
    } catch (error) {
      errors[provider] = error instanceof Error ? error.message : '同期に失敗しました。';
      await supabaseAdmin.from('integrations').upsert(
        {
          store_id: storeId,
          provider,
          status: 'ERROR',
          last_sync_at: null,
          last_error: errors[provider],
        },
        { onConflict: 'store_id,provider' }
      );
    }
  }

  await supabaseAdmin.from('audit_logs').insert({
    org_id: access.orgId,
    store_id: storeId,
    actor_user_id: auth.userId,
    action: 'INBOX_SYNC',
    target_type: 'store',
    target_id: storeId,
    payload: {
      providers,
      syncedCountByProvider,
      errors,
      mode: payload.mode || 'LATEST_ONLY',
    },
  });

  return jsonResponse(200, {
    ok: true,
    storeId,
    syncedCountByProvider,
    errors,
    lastSyncAt: new Date().toISOString(),
  });
});
