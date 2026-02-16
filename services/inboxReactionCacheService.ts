import { InboxReactionType } from '../types';

type ReactionMap = Record<string, { reaction: InboxReactionType; updatedAt: string }>;
const ALLOWED_REACTIONS = new Set<InboxReactionType>(['LIKE', 'ANGRY']);

const CACHE_KEY_PREFIX = 'inbox-reaction-cache';

const toCacheKey = (storeId: string) => `${CACHE_KEY_PREFIX}:${storeId}`;

const parseCache = (raw: string | null): ReactionMap => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, { reaction?: string; updatedAt?: string }>;
    const next: ReactionMap = {};
    Object.entries(parsed || {}).forEach(([messageId, row]) => {
      const reaction = String(row?.reaction || '').trim().toUpperCase() as InboxReactionType;
      const updatedAt = String(row?.updatedAt || '').trim();
      if (!reaction || !updatedAt || !ALLOWED_REACTIONS.has(reaction)) return;
      next[messageId] = {
        reaction,
        updatedAt,
      };
    });
    return next;
  } catch {
    return {};
  }
};

const read = (storeId: string): ReactionMap => {
  if (typeof window === 'undefined') return {};
  return parseCache(window.localStorage.getItem(toCacheKey(storeId)));
};

const write = (storeId: string, data: ReactionMap) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(toCacheKey(storeId), JSON.stringify(data));
};

export const inboxReactionCacheService = {
  listByStore(storeId: string): ReactionMap {
    if (!storeId) return {};
    return read(storeId);
  },

  saveReaction(params: { storeId: string; messageId: string; reaction: InboxReactionType }) {
    if (!params.storeId || !params.messageId) return;
    const current = read(params.storeId);
    current[params.messageId] = {
      reaction: params.reaction,
      updatedAt: new Date().toISOString(),
    };
    write(params.storeId, current);
  },

  saveBulk(params: { storeId: string; messageIds: string[]; reaction: InboxReactionType }) {
    if (!params.storeId || params.messageIds.length === 0) return;
    const current = read(params.storeId);
    const updatedAt = new Date().toISOString();
    params.messageIds.forEach((messageId) => {
      if (!messageId) return;
      current[messageId] = { reaction: params.reaction, updatedAt };
    });
    write(params.storeId, current);
  },
};
