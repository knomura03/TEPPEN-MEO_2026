import { ExternalProviderPost, RemoteProviderKey } from '../types';
import { getFunctionErrorMessage, invokeFunctionByHttp } from './functionHttpClient';

type ProviderPostsFetchResult = {
  merged: ExternalProviderPost[];
  byProvider: Record<string, ExternalProviderPost[]>;
  errors: Record<string, string>;
  fetchedAt: Date;
  cacheHit: boolean;
};

const CACHE_TTL_MS = 5 * 60 * 1000;

const normalizeProviderKey = (value: string): RemoteProviderKey | null => {
  const upper = String(value || '').trim().toUpperCase();
  if (upper === 'FACEBOOK' || upper === 'INSTAGRAM' || upper === 'GBP') return upper;
  return null;
};

const toExternalPost = (row: Record<string, unknown>): ExternalProviderPost | null => {
  const provider = normalizeProviderKey(String(row.provider || ''));
  const externalPostId = typeof row.externalPostId === 'string' ? row.externalPostId.trim() : '';
  if (!provider || !externalPostId) return null;

  const createdAtRaw = typeof row.createdAt === 'string' ? row.createdAt : '';
  const createdAt = new Date(createdAtRaw || Date.now());

  return {
    provider,
    externalPostId,
    content: typeof row.content === 'string' ? row.content : '',
    createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
    permalink: typeof row.permalink === 'string' ? row.permalink : undefined,
    raw: row.raw && typeof row.raw === 'object' ? (row.raw as Record<string, unknown>) : undefined,
  };
};

const buildCacheKey = (params: {
  storeId: string;
  providers: RemoteProviderKey[];
  limit: number;
  since?: Date;
}) => {
  const providerHash = params.providers.slice().sort().join(',');
  const sinceKey = params.since ? params.since.toISOString() : 'none';
  return `provider-posts-cache:${params.storeId}:${providerHash}:${params.limit}:${sinceKey}`;
};

const readCache = (cacheKey: string): ProviderPostsFetchResult | null => {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(cacheKey);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as {
      fetchedAt: string;
      merged: Record<string, unknown>[];
      byProvider: Record<string, Record<string, unknown>[]>;
      errors: Record<string, string>;
    };

    const fetchedAt = new Date(parsed.fetchedAt || '');
    if (Number.isNaN(fetchedAt.getTime())) return null;
    if (Date.now() - fetchedAt.getTime() > CACHE_TTL_MS) return null;

    const merged = (parsed.merged || [])
      .map((row) => (row && typeof row === 'object' ? toExternalPost(row as Record<string, unknown>) : null))
      .filter((row): row is ExternalProviderPost => Boolean(row));

    const byProvider: Record<string, ExternalProviderPost[]> = {};
    Object.entries(parsed.byProvider || {}).forEach(([provider, rows]) => {
      byProvider[provider] = (rows || [])
        .map((row) => (row && typeof row === 'object' ? toExternalPost(row as Record<string, unknown>) : null))
        .filter((item): item is ExternalProviderPost => Boolean(item));
    });

    return {
      merged,
      byProvider,
      errors: parsed.errors || {},
      fetchedAt,
      cacheHit: true,
    };
  } catch {
    return null;
  }
};

const writeCache = (cacheKey: string, result: ProviderPostsFetchResult) => {
  if (typeof window === 'undefined') return;
  const payload = {
    fetchedAt: result.fetchedAt.toISOString(),
    merged: result.merged.map((row) => ({
      provider: row.provider,
      externalPostId: row.externalPostId,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      permalink: row.permalink,
      raw: row.raw || {},
    })),
    byProvider: Object.fromEntries(
      Object.entries(result.byProvider).map(([provider, rows]) => [
        provider,
        rows.map((row) => ({
          provider: row.provider,
          externalPostId: row.externalPostId,
          content: row.content,
          createdAt: row.createdAt.toISOString(),
          permalink: row.permalink,
          raw: row.raw || {},
        })),
      ])
    ),
    errors: result.errors,
  };

  window.localStorage.setItem(cacheKey, JSON.stringify(payload));
};

export const providerPostsService = {
  async fetch(params: {
    storeId: string;
    providers?: RemoteProviderKey[];
    limit?: number;
    since?: Date;
    force?: boolean;
  }): Promise<ProviderPostsFetchResult> {
    const providers: RemoteProviderKey[] = params.providers && params.providers.length > 0
      ? (Array.from(new Set(params.providers)) as RemoteProviderKey[])
      : ['FACEBOOK', 'INSTAGRAM', 'GBP'];
    const limit = Math.min(Math.max(params.limit || 20, 1), 100);
    const cacheKey = buildCacheKey({
      storeId: params.storeId,
      providers,
      limit,
      since: params.since,
    });

    if (!params.force) {
      const cached = readCache(cacheKey);
      if (cached) return cached;
    }

    const result = await invokeFunctionByHttp('provider-posts-fetch', {
      storeId: params.storeId,
      providers,
      limit,
      since: params.since ? params.since.toISOString() : undefined,
    });

    if (!result.ok) {
      throw new Error(getFunctionErrorMessage(result, '外部投稿の取得に失敗しました。'));
    }

    const body = result.body && typeof result.body === 'object' ? (result.body as Record<string, unknown>) : {};

    const merged = Array.isArray(body.merged)
      ? body.merged
        .map((row) => (row && typeof row === 'object' ? toExternalPost(row as Record<string, unknown>) : null))
        .filter((row): row is ExternalProviderPost => Boolean(row))
      : [];

    const byProvider: Record<string, ExternalProviderPost[]> = {};
    if (body.byProvider && typeof body.byProvider === 'object') {
      Object.entries(body.byProvider as Record<string, unknown>).forEach(([provider, rows]) => {
        byProvider[provider] = Array.isArray(rows)
          ? rows
            .map((row) => (row && typeof row === 'object' ? toExternalPost(row as Record<string, unknown>) : null))
            .filter((item): item is ExternalProviderPost => Boolean(item))
          : [];
      });
    }

    const fetchedAt =
      typeof body.fetchedAt === 'string' && body.fetchedAt
        ? new Date(body.fetchedAt)
        : new Date();

    const finalResult: ProviderPostsFetchResult = {
      merged,
      byProvider,
      errors: body.errors && typeof body.errors === 'object' ? (body.errors as Record<string, string>) : {},
      fetchedAt: Number.isNaN(fetchedAt.getTime()) ? new Date() : fetchedAt,
      cacheHit: false,
    };

    writeCache(cacheKey, finalResult);
    return finalResult;
  },
};
