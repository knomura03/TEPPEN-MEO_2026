import { resolveAuthenticatedUserId } from '../_shared/auth.ts';
import { decryptAesGcm } from '../_shared/crypto.ts';
import { ensureGoogleAccessToken } from '../_shared/googleAuth.ts';
import { extractProviderErrorMessage, fetchJson, jsonResponse, optionsResponse, readString } from '../_shared/http.ts';
import { resolveMetaPageAccessToken, resolveMetaUserAccessToken } from '../_shared/metaAuth.ts';
import { createServiceRoleClient, requireEnv } from '../_shared/supabase.ts';

type ProviderKey = 'FACEBOOK' | 'INSTAGRAM' | 'GBP';

type SyncChannel = 'REVIEWS' | 'DM';
type SyncAttachmentType = 'IMAGE' | 'VIDEO';

type SyncMediaAttachment = {
  type: SyncAttachmentType;
  url: string;
  thumbnailUrl?: string;
  mimeType?: string;
};

type SyncMessage = {
  provider: ProviderKey;
  platform: 'FACEBOOK' | 'INSTAGRAM' | 'GOOGLE_BUSINESS';
  channel: SyncChannel;
  threadExternalId: string;
  externalMessageId: string;
  senderName: string;
  senderAvatarUrl?: string;
  content: string;
  receivedAt: string;
  permalink?: string;
  mediaAttachments?: SyncMediaAttachment[];
  isReplied?: boolean;
  replyContent?: string;
  replySentAt?: string;
  tags?: string[];
  assignedUserId?: string;
  dueAt?: string;
  slaStatus?: 'ON_TRACK' | 'AT_RISK' | 'OVERDUE' | 'COMPLETED';
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

const parseBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  if (typeof value === 'number') return value > 0;
  return false;
};

const asObject = (value: unknown): Record<string, unknown> => {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
};

const asArray = (value: unknown): unknown[] => {
  return Array.isArray(value) ? value : [];
};

const normalizeMediaUrl = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return '';
};

const normalizeMediaType = (value: unknown): SyncAttachmentType | null => {
  const type = String(value || '').trim().toLowerCase();
  if (!type) return null;
  if (type.includes('video')) return 'VIDEO';
  if (type.includes('image') || type.includes('photo')) return 'IMAGE';
  return null;
};

const uniqueMediaAttachments = (items: SyncMediaAttachment[]): SyncMediaAttachment[] => {
  const seen = new Set<string>();
  const results: SyncMediaAttachment[] = [];
  for (const item of items) {
    if (!item.url) continue;
    const key = `${item.type}:${item.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(item);
  }
  return results;
};

const parseMetaAttachmentMedia = (attachment: Record<string, unknown>): SyncMediaAttachment[] => {
  const media = asObject(attachment.media);
  const image = asObject(media.image);
  const imageData = asObject(attachment.image_data);
  const videoData = asObject(attachment.video_data);

  const urlCandidates = [
    normalizeMediaUrl((media as Record<string, unknown>).source),
    normalizeMediaUrl((image as Record<string, unknown>).src),
    normalizeMediaUrl((attachment as Record<string, unknown>).url),
    normalizeMediaUrl((attachment as Record<string, unknown>).file_url),
    normalizeMediaUrl((videoData as Record<string, unknown>).url),
    normalizeMediaUrl((imageData as Record<string, unknown>).url),
  ].filter(Boolean);

  if (urlCandidates.length === 0) return [];

  const attachmentType =
    normalizeMediaType((attachment as Record<string, unknown>).type) ||
    normalizeMediaType((attachment as Record<string, unknown>).mime_type) ||
    normalizeMediaType((media as Record<string, unknown>).type) ||
    normalizeMediaType((videoData as Record<string, unknown>).mime_type) ||
    normalizeMediaType((imageData as Record<string, unknown>).mime_type) ||
    'IMAGE';

  const thumbnailUrl =
    normalizeMediaUrl((image as Record<string, unknown>).src) ||
    normalizeMediaUrl((videoData as Record<string, unknown>).preview_url) ||
    undefined;

  return uniqueMediaAttachments(
    urlCandidates.map((url) => ({
      type: attachmentType,
      url,
      thumbnailUrl,
      mimeType:
        (typeof (attachment as Record<string, unknown>).mime_type === 'string'
          ? ((attachment as Record<string, unknown>).mime_type as string)
          : undefined) ||
        (typeof (videoData as Record<string, unknown>).mime_type === 'string'
          ? ((videoData as Record<string, unknown>).mime_type as string)
          : undefined) ||
        (typeof (imageData as Record<string, unknown>).mime_type === 'string'
          ? ((imageData as Record<string, unknown>).mime_type as string)
          : undefined),
    }))
  );
};

const parseMetaAttachments = (payload: unknown): SyncMediaAttachment[] => {
  const rows = asArray(asObject(payload).data);
  const items = rows
    .map((row) => (row && typeof row === 'object' ? parseMetaAttachmentMedia(row as Record<string, unknown>) : []))
    .flat();
  return uniqueMediaAttachments(items);
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
  context?: {
    configurationId: string;
    config: Record<string, unknown>;
    integrationId: string;
    encryptedPayload: string;
    providerSecret?: string;
  };
  reason?: string;
}> => {
  const { data: catalog } = await params.supabaseAdmin
    .from('provider_catalog')
    .select('id')
    .eq('org_id', params.orgId)
    .eq('provider_key', params.provider)
    .eq('is_active', true)
    .maybeSingle();
  if (!catalog?.id) {
    return { reason: '連携先カタログが無効です。管理者に確認してください。' };
  }

  const { data: configuration } = await params.supabaseAdmin
    .from('provider_configurations')
    .select('id, config, connection_status, last_error')
    .eq('store_id', params.storeId)
    .eq('provider_catalog_id', catalog.id)
    .maybeSingle();
  if (!configuration) {
    return { reason: 'この店舗の連携設定が未作成です。設定画面から接続してください。' };
  }
  const configurationStatus = String(configuration.connection_status || '').toUpperCase();
  if (configurationStatus === 'DISCONNECTED') {
    const detail = typeof configuration.last_error === 'string' && configuration.last_error.trim().length > 0
      ? `（${configuration.last_error.trim()}）`
      : '';
    return { reason: `この店舗では未接続です。（設定状態: ${configurationStatus || 'DISCONNECTED'}）${detail}` };
  }

  const { data: integration } = await params.supabaseAdmin
    .from('integrations')
    .select('id, status, last_error')
    .eq('store_id', params.storeId)
    .eq('provider', params.provider)
    .maybeSingle();
  if (!integration?.id) {
    return { reason: 'integration行が見つかりません。店舗連携を再設定してください。' };
  }
  const integrationStatus = String(integration.status || '').toUpperCase();
  if (integrationStatus === 'DISCONNECTED') {
    const detail = typeof integration.last_error === 'string' && integration.last_error.trim().length > 0
      ? `（${integration.last_error.trim()}）`
      : '';
    return { reason: `integrationが未接続です。（status: ${integrationStatus || 'DISCONNECTED'}）${detail}` };
  }

  const { data: credential } = await params.supabaseAdmin
    .from('integration_credentials')
    .select('encrypted_payload')
    .eq('integration_id', integration.id)
    .maybeSingle();
  if (!credential?.encrypted_payload) {
    return { reason: 'OAuth認証情報が見つかりません。いったん連携解除して再連携してください。' };
  }

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
    context: {
      configurationId: configuration.id,
      config: configuration.config && typeof configuration.config === 'object' ? configuration.config : {},
      integrationId: integration.id,
      encryptedPayload: String(credential.encrypted_payload),
      providerSecret: providerSecret || undefined,
    },
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
    if (message.channel !== 'REVIEWS') continue;

    const threadId = await ensureThread({
      supabaseAdmin: params.supabaseAdmin,
      storeId: params.storeId,
      provider: params.provider,
      threadExternalId: message.threadExternalId,
      lastMessageAt: message.receivedAt,
    });

    const upsertRow: Record<string, unknown> = {
      thread_id: threadId,
      store_id: params.storeId,
      provider: params.provider,
      external_message_id: message.externalMessageId,
      sender_name: message.senderName || null,
      sender_avatar_url: message.senderAvatarUrl || null,
      content: message.content,
      received_at: message.receivedAt,
    };

    if (message.isReplied) {
      upsertRow.is_replied = true;
      upsertRow.reply_content = message.replyContent || null;
      upsertRow.reply_sent_at = message.replySentAt || message.receivedAt;
      upsertRow.sla_status = 'COMPLETED';
    }

    const { error } = await params.supabaseAdmin
      .from('inbox_messages')
      .upsert(upsertRow, { onConflict: 'store_id,provider,external_message_id' });

    if (!error) {
      syncedCount += 1;
    }
  }

  return syncedCount;
};

const chunkArray = <T,>(items: T[], chunkSize: number): T[][] => {
  if (chunkSize <= 0) return [items];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

const buildStateKey = (provider: ProviderKey, externalMessageId: string): string => {
  return `${provider}:${externalMessageId}`;
};

const enrichMessagesWithDbState = async (params: {
  supabaseAdmin: any;
  storeId: string;
  messages: SyncMessage[];
}): Promise<SyncMessage[]> => {
  if (params.messages.length === 0) return params.messages;

  const idsByProvider = new Map<ProviderKey, Set<string>>();
  for (const message of params.messages) {
    if (!message.externalMessageId) continue;
    const existing = idsByProvider.get(message.provider) || new Set<string>();
    existing.add(message.externalMessageId);
    idsByProvider.set(message.provider, existing);
  }
  if (idsByProvider.size === 0) return params.messages;

  const stateMap = new Map<
    string,
    {
      isReplied?: boolean;
      replyContent?: string;
      replySentAt?: string;
      tags?: string[];
      assignedUserId?: string;
      dueAt?: string;
      slaStatus?: 'ON_TRACK' | 'AT_RISK' | 'OVERDUE' | 'COMPLETED';
    }
  >();

  for (const [provider, idSet] of idsByProvider.entries()) {
    const ids = Array.from(idSet);
    for (const chunk of chunkArray(ids, 100)) {
      const { data, error } = await params.supabaseAdmin
        .from('inbox_messages')
        .select('provider, external_message_id, is_replied, reply_content, reply_sent_at, tags, assigned_user_id, due_at, sla_status')
        .eq('store_id', params.storeId)
        .eq('provider', provider)
        .in('external_message_id', chunk);

      if (error || !Array.isArray(data)) continue;

      for (const row of data) {
        const typed = row as Record<string, unknown>;
        const dbProvider = String(typed.provider || '').trim().toUpperCase() as ProviderKey;
        const externalMessageId = readString(typed, ['external_message_id']);
        if (!dbProvider || !externalMessageId) continue;
        stateMap.set(buildStateKey(dbProvider, externalMessageId), {
          isReplied: Boolean(typed.is_replied),
          replyContent: readString(typed, ['reply_content']) || undefined,
          replySentAt: readString(typed, ['reply_sent_at']) || undefined,
          tags: Array.isArray(typed.tags)
            ? (typed.tags as unknown[]).map((item) => String(item || '').trim()).filter(Boolean)
            : undefined,
          assignedUserId: readString(typed, ['assigned_user_id']) || undefined,
          dueAt: readString(typed, ['due_at']) || undefined,
          slaStatus: readString(typed, ['sla_status']) as 'ON_TRACK' | 'AT_RISK' | 'OVERDUE' | 'COMPLETED' | undefined,
        });
      }
    }
  }

  return params.messages.map((message) => {
    const state = stateMap.get(buildStateKey(message.provider, message.externalMessageId));
    if (!state) return message;
    return {
      ...message,
      isReplied: state.isReplied ?? message.isReplied,
      replyContent: state.replyContent || message.replyContent,
      replySentAt: state.replySentAt || message.replySentAt,
      tags: state.tags || message.tags,
      assignedUserId: state.assignedUserId || message.assignedUserId,
      dueAt: state.dueAt || message.dueAt,
      slaStatus: state.slaStatus || message.slaStatus,
    };
  });
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
  if (!pageResult.ok || !pageResult.pageId || !pageResult.pageAccessToken) {
    throw new Error(pageResult.error || 'Facebookページへのアクセスに失敗しました。');
  }

  const fields =
    'id,message,created_time,permalink_url,attachments{media,type,url},comments.limit(25){id,message,created_time,from{id,name,picture},attachment{media,type,url,file_url,mime_type,image_data,video_data}}';
  const endpoint = `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(pageResult.pageId)}/feed?fields=${encodeURIComponent(fields)}&limit=${params.limit}`;
  const feed = await fetchJson(endpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${pageResult.pageAccessToken}` },
  });
  if (!feed.ok || !feed.body || typeof feed.body !== 'object') {
    throw new Error(extractProviderErrorMessage(feed.body) || `Facebookコメントの取得に失敗しました。（status=${feed.status}）`);
  }

  const posts = Array.isArray((feed.body as Record<string, unknown>).data)
    ? ((feed.body as Record<string, unknown>).data as unknown[])
    : [];

  const messages: SyncMessage[] = [];
  for (const post of posts) {
    if (!post || typeof post !== 'object') continue;
    const postRow = post as Record<string, unknown>;
    const postId = typeof postRow.id === 'string' ? postRow.id : '';
    if (!postId) continue;
    const postPermalink = readString(postRow, ['permalink_url']);
    const postAttachments = parseMetaAttachments(postRow.attachments);

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
      const commentAttachment = parseMetaAttachmentMedia(asObject(row.attachment));
      const mediaAttachments = commentAttachment.length > 0 ? commentAttachment : postAttachments;

      messages.push({
        provider: 'FACEBOOK',
        platform: 'FACEBOOK',
        channel: 'REVIEWS',
        threadExternalId: `fb_post:${postId}`,
        externalMessageId: commentId,
        senderName: typeof from.name === 'string' ? from.name : 'Facebookユーザー',
        senderAvatarUrl:
          from.picture && typeof from.picture === 'object' && typeof (from.picture as Record<string, unknown>).data === 'object'
            ? readString((from.picture as Record<string, unknown>).data as Record<string, unknown>, ['url'])
            : undefined,
        content: typeof row.message === 'string' ? row.message : '',
        receivedAt: toIso(row.created_time),
        permalink: postPermalink || undefined,
        mediaAttachments: mediaAttachments.length > 0 ? mediaAttachments : undefined,
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
  if (!pageResult.ok) {
    throw new Error(pageResult.error || 'Instagramの連携情報を確認できません。');
  }

  const instagramUserId = readString(params.context.config, ['instagram_user_id', 'ig_user_id']) || pageResult.instagramUserId || '';
  if (!instagramUserId) {
    throw new Error('InstagramユーザーIDが未設定です。');
  }

  const token = pageResult.pageAccessToken || accessToken;
  const mediaEndpoint = `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(instagramUserId)}/media?fields=${encodeURIComponent('id,caption,permalink,timestamp,comments_count,media_type,media_url,thumbnail_url')}&limit=${params.limit}`;
  const mediaResponse = await fetchJson(mediaEndpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!mediaResponse.ok || !mediaResponse.body || typeof mediaResponse.body !== 'object') {
    throw new Error(extractProviderErrorMessage(mediaResponse.body) || `Instagramコメント一覧の取得に失敗しました。（status=${mediaResponse.status}）`);
  }
  const mediaRows = Array.isArray((mediaResponse.body as Record<string, unknown>).data)
    ? ((mediaResponse.body as Record<string, unknown>).data as unknown[])
    : [];

  const messages: SyncMessage[] = [];

  for (const mediaRow of mediaRows) {
    if (!mediaRow || typeof mediaRow !== 'object') continue;
    const media = mediaRow as Record<string, unknown>;
    const mediaId = typeof media.id === 'string' ? media.id : '';
    if (!mediaId) continue;
    const mediaType = String(media.media_type || '').toUpperCase();
    const mediaUrl = normalizeMediaUrl(media.media_url);
    const thumbnailUrl = normalizeMediaUrl(media.thumbnail_url) || undefined;
    const permalink = readString(media, ['permalink']);
    const mediaAttachments: SyncMediaAttachment[] = mediaUrl
      ? [
          {
            type: mediaType.includes('VIDEO') ? 'VIDEO' : 'IMAGE',
            url: mediaUrl,
            thumbnailUrl,
          },
        ]
      : [];

    const commentEndpoint = `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(mediaId)}/comments?fields=${encodeURIComponent('id,text,timestamp,username,from{id,username,profile_picture_url}')}&limit=25`;
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
      const from = asObject(comment.from);
      const senderName = readString(from, ['username', 'name']) || (typeof comment.username === 'string' ? comment.username : 'Instagramユーザー');

      messages.push({
        provider: 'INSTAGRAM',
        platform: 'INSTAGRAM',
        channel: 'REVIEWS',
        threadExternalId: `ig_media:${mediaId}`,
        externalMessageId: commentId,
        senderName,
        senderAvatarUrl: readString(from, ['profile_picture_url']) || undefined,
        content: typeof comment.text === 'string' ? comment.text : '',
        receivedAt: toIso(comment.timestamp),
        permalink: permalink || undefined,
        mediaAttachments: mediaAttachments.length > 0 ? mediaAttachments : undefined,
      });
    }
  }

  return messages;
};

const syncFacebookDms = async (params: {
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
  if (!pageResult.ok || !pageResult.pageId || !pageResult.pageAccessToken) {
    throw new Error(pageResult.error || 'Facebookページへのアクセスに失敗しました。');
  }

  const fields =
    'id,updated_time,messages.limit(25){id,message,created_time,from{id,name,picture},attachments{mime_type,file_url,image_data,video_data}}';
  const endpoint = `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(pageResult.pageId)}/conversations?fields=${encodeURIComponent(fields)}&limit=${params.limit}`;
  const response = await fetchJson(endpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${pageResult.pageAccessToken}` },
  });

  if (!response.ok || !response.body || typeof response.body !== 'object') {
    throw new Error(extractProviderErrorMessage(response.body) || `Facebook DMの取得に失敗しました。（status=${response.status}）`);
  }

  const conversations = asArray((response.body as Record<string, unknown>).data);
  const messages: SyncMessage[] = [];

  for (const conversationRow of conversations) {
    if (!conversationRow || typeof conversationRow !== 'object') continue;
    const conversation = conversationRow as Record<string, unknown>;
    const conversationId = readString(conversation, ['id']);
    if (!conversationId) continue;
    const messageRows = asArray(asObject(conversation.messages).data);
    for (const messageRow of messageRows) {
      if (!messageRow || typeof messageRow !== 'object') continue;
      const message = messageRow as Record<string, unknown>;
      const messageId = readString(message, ['id']);
      if (!messageId) continue;

      const from = asObject(message.from);
      const senderName = readString(from, ['name']) || 'Facebookユーザー';
      const senderId = readString(from, ['id']);
      const isPageMessage = senderId && senderId === pageResult.pageId;
      if (isPageMessage) continue;

      const mediaAttachments = parseMetaAttachments(message.attachments);
      const content = readString(message, ['message']) || (mediaAttachments.length > 0 ? '(画像/動画メッセージ)' : '');
      if (!content && mediaAttachments.length === 0) continue;

      const senderAvatar =
        from.picture && typeof from.picture === 'object'
          ? readString(asObject(asObject(from.picture).data), ['url'])
          : undefined;

      messages.push({
        provider: 'FACEBOOK',
        platform: 'FACEBOOK',
        channel: 'DM',
        threadExternalId: `fb_dm:${conversationId}`,
        externalMessageId: messageId,
        senderName,
        senderAvatarUrl: senderAvatar || undefined,
        content,
        receivedAt: toIso(message.created_time),
        mediaAttachments: mediaAttachments.length > 0 ? mediaAttachments : undefined,
      });
    }
  }

  return messages;
};

const syncInstagramDms = async (params: {
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
  if (!pageResult.ok || !pageResult.pageAccessToken) {
    throw new Error(pageResult.error || 'Instagram DMの連携情報を取得できませんでした。');
  }

  const fields =
    'id,updated_time,messages.limit(25){id,message,created_time,from{id,username,name},attachments{mime_type,file_url,image_data,video_data}}';
  const endpoint = `https://graph.facebook.com/${graphApiVersion}/me/conversations?platform=instagram&fields=${encodeURIComponent(fields)}&limit=${params.limit}`;
  const response = await fetchJson(endpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${pageResult.pageAccessToken}` },
  });

  if (!response.ok || !response.body || typeof response.body !== 'object') {
    throw new Error(extractProviderErrorMessage(response.body) || `Instagram DMの取得に失敗しました。（status=${response.status}）`);
  }

  const conversations = asArray((response.body as Record<string, unknown>).data);
  const messages: SyncMessage[] = [];

  for (const conversationRow of conversations) {
    if (!conversationRow || typeof conversationRow !== 'object') continue;
    const conversation = conversationRow as Record<string, unknown>;
    const conversationId = readString(conversation, ['id']);
    if (!conversationId) continue;
    const messageRows = asArray(asObject(conversation.messages).data);
    for (const messageRow of messageRows) {
      if (!messageRow || typeof messageRow !== 'object') continue;
      const message = messageRow as Record<string, unknown>;
      const messageId = readString(message, ['id']);
      if (!messageId) continue;
      const from = asObject(message.from);
      const senderName = readString(from, ['username', 'name']) || 'Instagramユーザー';
      const mediaAttachments = parseMetaAttachments(message.attachments);
      const content = readString(message, ['message']) || (mediaAttachments.length > 0 ? '(画像/動画メッセージ)' : '');
      if (!content && mediaAttachments.length === 0) continue;

      messages.push({
        provider: 'INSTAGRAM',
        platform: 'INSTAGRAM',
        channel: 'DM',
        threadExternalId: `ig_dm:${conversationId}`,
        externalMessageId: messageId,
        senderName,
        content,
        receivedAt: toIso(message.created_time),
        mediaAttachments: mediaAttachments.length > 0 ? mediaAttachments : undefined,
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
      const reviewReply = row.reviewReply && typeof row.reviewReply === 'object' ? (row.reviewReply as Record<string, unknown>) : {};
      const replyContent = readString(reviewReply, ['comment']);
      const replySentAt = readString(reviewReply, ['updateTime']);
      return {
        provider: 'GBP',
        platform: 'GOOGLE_BUSINESS',
        channel: 'REVIEWS',
        threadExternalId: `gbp_review:${reviewId}`,
        externalMessageId: reviewId,
        senderName: readString(reviewer, ['displayName']) || 'Googleユーザー',
        senderAvatarUrl: readString(reviewer, ['profilePhotoUrl']) || undefined,
        content: typeof row.comment === 'string' ? row.comment : '(コメントなし)',
        receivedAt: toIso(row.updateTime || row.createTime),
        isReplied: Boolean(replyContent),
        replyContent: replyContent || undefined,
        replySentAt: replySentAt || undefined,
        slaStatus: replyContent ? 'COMPLETED' : undefined,
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

  let payload: {
    storeId?: string;
    providers?: string[];
    mode?: 'LATEST_ONLY' | 'FULL';
    includeDm?: boolean;
    persist?: boolean;
  };
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
  const includeDm = parseBoolean(payload.includeDm);
  const persist = parseBoolean(payload.persist);

  const syncedCountByProvider: Record<string, number> = {};
  const errors: Record<string, string> = {};
  const fetchedMessages: SyncMessage[] = [];

  for (const provider of providers) {
    syncedCountByProvider[provider] = 0;

    const contextResult = await loadProviderContext({
      supabaseAdmin,
      storeId,
      orgId: access.orgId,
      provider,
      encryptionKey,
    });

    if (!contextResult.context) {
      errors[provider] = contextResult.reason || '連携情報が未設定です。';
      continue;
    }
    const context = contextResult.context;

    try {
      let reviewMessages: SyncMessage[] = [];
      let dmMessages: SyncMessage[] = [];
      if (provider === 'FACEBOOK') {
        reviewMessages = await syncFacebookComments({
          context,
          encryptionKey,
          limit: fetchLimit,
        });
        if (includeDm) {
          dmMessages = await syncFacebookDms({
            context,
            encryptionKey,
            limit: fetchLimit,
          });
        }
      } else if (provider === 'INSTAGRAM') {
        reviewMessages = await syncInstagramComments({
          context,
          encryptionKey,
          limit: fetchLimit,
        });
        if (includeDm) {
          dmMessages = await syncInstagramDms({
            context,
            encryptionKey,
            limit: fetchLimit,
          });
        }
      } else {
        const gbp = await syncGbpReviews({
          supabaseAdmin,
          context,
          encryptionKey,
        });
        reviewMessages = gbp.rows;
        if (gbp.error) {
          errors[provider] = gbp.error;
        }
      }

      const providerMessages = [...reviewMessages, ...dmMessages];
      fetchedMessages.push(...providerMessages);
      syncedCountByProvider[provider] = providerMessages.length;

      if (persist && reviewMessages.length > 0) {
        await upsertMessages({
          supabaseAdmin,
          storeId,
          provider,
          messages: reviewMessages,
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
          status: 'CONNECTED',
          last_sync_at: new Date().toISOString(),
          last_error: errors[provider],
        },
        { onConflict: 'store_id,provider' }
      );
    }
  }

  const mergedMessages = await enrichMessagesWithDbState({
    supabaseAdmin,
    storeId,
    messages: fetchedMessages,
  });

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
      includeDm,
      persist,
    },
  });

  return jsonResponse(200, {
    ok: true,
    storeId,
    syncedCountByProvider,
    errors,
    messages: mergedMessages,
    includeDm,
    persist,
    lastSyncAt: new Date().toISOString(),
  });
});
