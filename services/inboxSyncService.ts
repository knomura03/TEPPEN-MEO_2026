import { InboxMediaAttachment, InboxMessage, SocialPlatform } from '../types';
import { getFunctionErrorMessage, invokeFunctionByHttp } from './functionHttpClient';

type InboxProvider = 'FACEBOOK' | 'INSTAGRAM' | 'GBP';
type InboxChannel = 'REVIEWS' | 'DM';

export type InboxSyncResult = {
  syncedCountByProvider: Record<string, number>;
  errors: Record<string, string>;
  lastSyncAt: Date;
  messages: InboxMessage[];
  cacheHit: boolean;
};

const CACHE_TTL_MS = 5 * 60 * 1000;

const toPlatform = (provider: string): SocialPlatform => {
  const normalized = String(provider || '').trim().toUpperCase();
  if (normalized === 'FACEBOOK') return 'FACEBOOK';
  if (normalized === 'INSTAGRAM') return 'INSTAGRAM';
  return 'GOOGLE_BUSINESS';
};

const toChannel = (value: unknown): InboxChannel => {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized === 'DM' ? 'DM' : 'REVIEWS';
};

const toMediaAttachment = (row: unknown): InboxMediaAttachment | null => {
  if (!row || typeof row !== 'object') return null;
  const typed = row as Record<string, unknown>;
  const url = typeof typed.url === 'string' ? typed.url.trim() : '';
  if (!url) return null;
  const mediaType = String(typed.type || '').trim().toUpperCase();

  return {
    type: mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE',
    url,
    thumbnailUrl: typeof typed.thumbnailUrl === 'string' ? typed.thumbnailUrl : undefined,
    mimeType: typeof typed.mimeType === 'string' ? typed.mimeType : undefined,
  };
};

const toInboxMessage = (row: unknown): InboxMessage | null => {
  if (!row || typeof row !== 'object') return null;
  const typed = row as Record<string, unknown>;
  const provider = String(typed.provider || '').trim().toUpperCase();
  if (!provider) return null;

  const externalMessageId = typeof typed.externalMessageId === 'string' ? typed.externalMessageId.trim() : '';
  const threadExternalId = typeof typed.threadExternalId === 'string' ? typed.threadExternalId.trim() : '';
  if (!externalMessageId || !threadExternalId) return null;

  const receivedAtRaw = typeof typed.receivedAt === 'string' ? typed.receivedAt : '';
  const receivedAt = new Date(receivedAtRaw || Date.now());
  const channel = toChannel(typed.channel);
  const mediaAttachments = Array.isArray(typed.mediaAttachments)
    ? typed.mediaAttachments.map((item) => toMediaAttachment(item)).filter((item): item is InboxMediaAttachment => Boolean(item))
    : [];

  const content = typeof typed.content === 'string' ? typed.content : '';
  const isReplied = Boolean(typed.isReplied);
  const replyContent = typeof typed.replyContent === 'string' ? typed.replyContent.trim() : '';
  const replySentAtRaw = typeof typed.replySentAt === 'string' ? typed.replySentAt : '';
  const replySentAt = replySentAtRaw ? new Date(replySentAtRaw) : null;
  const tags = Array.isArray(typed.tags)
    ? typed.tags.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 10)
    : [];
  const assignedUserId = typeof typed.assignedUserId === 'string' ? typed.assignedUserId.trim() : '';
  const dueAtRaw = typeof typed.dueAt === 'string' ? typed.dueAt : '';
  const dueAt = dueAtRaw ? new Date(dueAtRaw) : null;
  const slaStatusRaw = String(typed.slaStatus || '').trim().toUpperCase();
  const slaStatus =
    slaStatusRaw === 'AT_RISK' || slaStatusRaw === 'OVERDUE' || slaStatusRaw === 'COMPLETED' || slaStatusRaw === 'ON_TRACK'
      ? slaStatusRaw
      : 'ON_TRACK';

  return {
    id: `${provider}:${channel}:${externalMessageId}`,
    platform: toPlatform(provider),
    source: 'REMOTE_CACHE',
    channel,
    externalMessageId,
    externalThreadId: threadExternalId,
    senderName: typeof typed.senderName === 'string' && typed.senderName.trim() ? typed.senderName.trim() : 'ユーザー',
    senderAvatar: typeof typed.senderAvatarUrl === 'string' && typed.senderAvatarUrl.trim() ? typed.senderAvatarUrl.trim() : undefined,
    content: content.trim() || (mediaAttachments.length > 0 ? '(画像/動画メッセージ)' : ''),
    receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
    isReplied,
    replyContent: replyContent || undefined,
    replySentAt: replySentAt && !Number.isNaN(replySentAt.getTime()) ? replySentAt : undefined,
    permalink: typeof typed.permalink === 'string' && typed.permalink.trim() ? typed.permalink.trim() : undefined,
    mediaAttachments: mediaAttachments.length > 0 ? mediaAttachments : undefined,
    tags,
    assignedUserId: assignedUserId || undefined,
    dueAt: dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt : undefined,
    slaStatus,
  };
};

const buildCacheKey = (params: {
  storeId: string;
  providers: InboxProvider[];
  includeDm: boolean;
  mode: 'LATEST_ONLY' | 'FULL';
}) => {
  const providersKey = params.providers.slice().sort().join(',');
  return `inbox-sync-cache:${params.storeId}:${providersKey}:${params.includeDm ? 'dm' : 'reviews'}:${params.mode}`;
};

const readCache = (cacheKey: string): InboxSyncResult | null => {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(cacheKey);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as {
      lastSyncAt: string;
      syncedCountByProvider: Record<string, number>;
      errors: Record<string, string>;
      messages: unknown[];
    };

    const lastSyncAt = new Date(parsed.lastSyncAt || '');
    if (Number.isNaN(lastSyncAt.getTime())) return null;
    if (Date.now() - lastSyncAt.getTime() > CACHE_TTL_MS) return null;

    return {
      syncedCountByProvider: parsed.syncedCountByProvider || {},
      errors: parsed.errors || {},
      messages: Array.isArray(parsed.messages)
        ? parsed.messages.map((row) => toInboxMessage(row)).filter((row): row is InboxMessage => Boolean(row))
        : [],
      lastSyncAt,
      cacheHit: true,
    };
  } catch {
    return null;
  }
};

const writeCache = (cacheKey: string, result: InboxSyncResult) => {
  if (typeof window === 'undefined') return;
  const payload = {
    lastSyncAt: result.lastSyncAt.toISOString(),
    syncedCountByProvider: result.syncedCountByProvider,
    errors: result.errors,
      messages: result.messages.map((message) => ({
      provider:
        message.platform === 'GOOGLE_BUSINESS'
          ? 'GBP'
          : message.platform === 'FACEBOOK'
            ? 'FACEBOOK'
            : 'INSTAGRAM',
      platform: message.platform,
      channel: message.channel || 'REVIEWS',
      externalMessageId: message.externalMessageId || '',
      threadExternalId: message.externalThreadId || '',
      senderName: message.senderName,
      senderAvatarUrl: message.senderAvatar || '',
      content: message.content || '',
        receivedAt: message.receivedAt.toISOString(),
        permalink: message.permalink || '',
        isReplied: Boolean(message.isReplied),
        replyContent: message.replyContent || '',
        replySentAt: message.replySentAt ? message.replySentAt.toISOString() : '',
        tags: message.tags || [],
        assignedUserId: message.assignedUserId || '',
        dueAt: message.dueAt ? message.dueAt.toISOString() : '',
        slaStatus: message.slaStatus || 'ON_TRACK',
        mediaAttachments: (message.mediaAttachments || []).map((item) => ({
          type: item.type,
          url: item.url,
        thumbnailUrl: item.thumbnailUrl,
        mimeType: item.mimeType,
      })),
    })),
  };
  window.localStorage.setItem(cacheKey, JSON.stringify(payload));
};

export const inboxSyncService = {
  async sync(params: {
    storeId: string;
    providers?: InboxProvider[];
    mode?: 'LATEST_ONLY' | 'FULL';
    includeDm?: boolean;
    force?: boolean;
  }): Promise<InboxSyncResult> {
    const providers = params.providers && params.providers.length > 0
      ? (Array.from(new Set(params.providers)) as InboxProvider[])
      : (['FACEBOOK', 'INSTAGRAM', 'GBP'] as InboxProvider[]);
    const includeDm = Boolean(params.includeDm);
    const mode = params.mode || 'LATEST_ONLY';
    const cacheKey = buildCacheKey({
      storeId: params.storeId,
      providers,
      includeDm,
      mode,
    });

    if (!params.force) {
      const cached = readCache(cacheKey);
      if (cached) return cached;
    }

    const result = await invokeFunctionByHttp('inbox-sync', {
      storeId: params.storeId,
      providers,
      mode,
      includeDm,
      persist: true,
    });

    if (!result.ok) {
      throw new Error(getFunctionErrorMessage(result, '受信箱同期に失敗しました。'));
    }

    const body = result.body && typeof result.body === 'object' ? (result.body as Record<string, unknown>) : {};
    const lastSyncAt = typeof body.lastSyncAt === 'string' ? new Date(body.lastSyncAt) : new Date();

    const finalResult: InboxSyncResult = {
      syncedCountByProvider:
        body.syncedCountByProvider && typeof body.syncedCountByProvider === 'object'
          ? (body.syncedCountByProvider as Record<string, number>)
          : {},
      errors: body.errors && typeof body.errors === 'object' ? (body.errors as Record<string, string>) : {},
      messages: Array.isArray(body.messages)
        ? body.messages.map((row) => toInboxMessage(row)).filter((row): row is InboxMessage => Boolean(row))
        : [],
      lastSyncAt: Number.isNaN(lastSyncAt.getTime()) ? new Date() : lastSyncAt,
      cacheHit: false,
    };

    writeCache(cacheKey, finalResult);
    return finalResult;
  },
};
