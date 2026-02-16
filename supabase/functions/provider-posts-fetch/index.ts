import { resolveAuthenticatedUserId } from '../_shared/auth.ts';
import { decryptAesGcm } from '../_shared/crypto.ts';
import { ensureGoogleAccessToken } from '../_shared/googleAuth.ts';
import { extractProviderErrorMessage, fetchJson, jsonResponse, optionsResponse, readString } from '../_shared/http.ts';
import { resolveMetaPageAccessToken, resolveMetaUserAccessToken } from '../_shared/metaAuth.ts';
import { createServiceRoleClient, requireEnv } from '../_shared/supabase.ts';

type ProviderKey = 'FACEBOOK' | 'INSTAGRAM' | 'GBP';

type RemotePost = {
  provider: ProviderKey;
  externalPostId: string;
  content: string;
  createdAt: string;
  permalink?: string;
  metrics?: {
    impressions?: number | null;
    profileViews?: number | null;
    likes?: number | null;
    comments?: number | null;
    shares?: number | null;
  };
  raw: Record<string, unknown>;
};

const parseProviders = (input: unknown): ProviderKey[] => {
  if (!Array.isArray(input) || input.length === 0) return ['FACEBOOK', 'INSTAGRAM', 'GBP'];
  const normalized = input
    .map((item) => String(item || '').trim().toUpperCase())
    .filter((item): item is ProviderKey => item === 'FACEBOOK' || item === 'INSTAGRAM' || item === 'GBP');
  return Array.from(new Set(normalized));
};

const MAX_INSIGHT_LOOKUPS = 20;

const toNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseMetaInsightMetric = (body: unknown): number | null => {
  if (!body || typeof body !== 'object') return null;
  const rows = Array.isArray((body as Record<string, unknown>).data)
    ? ((body as Record<string, unknown>).data as unknown[])
    : [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const values = Array.isArray((row as Record<string, unknown>).values)
      ? ((row as Record<string, unknown>).values as unknown[])
      : [];
    if (values.length === 0) continue;
    const first = values[0];
    if (first && typeof first === 'object') {
      const rawValue = (first as Record<string, unknown>).value;
      const direct = toNumberOrNull(rawValue);
      if (direct !== null) return direct;
      if (rawValue && typeof rawValue === 'object') {
        const nested = Object.values(rawValue as Record<string, unknown>)
          .map((candidate) => toNumberOrNull(candidate))
          .find((candidate) => candidate !== null);
        if (nested !== undefined) return nested as number | null;
      }
    } else {
      const direct = toNumberOrNull(first);
      if (direct !== null) return direct;
    }
  }
  return null;
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
  const configurationStatus = String(configuration?.connection_status || '').toUpperCase();
  if (!configuration || configurationStatus === 'DISCONNECTED') return null;

  const { data: integration } = await params.supabaseAdmin
    .from('integrations')
    .select('id, status')
    .eq('store_id', params.storeId)
    .eq('provider', params.provider)
    .maybeSingle();
  const integrationStatus = String(integration?.status || '').toUpperCase();
  if (!integration?.id || integrationStatus === 'DISCONNECTED') return null;

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
    config: configuration.config && typeof configuration.config === 'object' ? configuration.config : {},
    integrationId: integration.id,
    encryptedPayload: String(credential.encrypted_payload),
    providerSecret: providerSecret || undefined,
  };
};

const toIso = (value: unknown): string => {
  if (typeof value === 'string' && value.trim()) {
    const ts = new Date(value).getTime();
    if (!Number.isNaN(ts)) return new Date(ts).toISOString();
  }
  return new Date().toISOString();
};

const filterBySince = (rows: RemotePost[], since: string | null): RemotePost[] => {
  if (!since) return rows;
  const sinceMs = new Date(since).getTime();
  if (Number.isNaN(sinceMs)) return rows;
  return rows.filter((row) => new Date(row.createdAt).getTime() >= sinceMs);
};

const fetchFacebookPosts = async (params: {
  context: { config: Record<string, unknown>; encryptedPayload: string };
  encryptionKey: string;
  limit: number;
}): Promise<RemotePost[]> => {
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

  const endpoint = `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(pageResult.pageId)}/posts?fields=${encodeURIComponent('id,message,created_time,permalink_url,shares,likes.summary(true),comments.summary(true)')}&limit=${params.limit}`;
  const response = await fetchJson(endpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${pageResult.pageAccessToken}` },
  });

  if (!response.ok || !response.body || typeof response.body !== 'object') return [];
  const rows = Array.isArray((response.body as Record<string, unknown>).data)
    ? ((response.body as Record<string, unknown>).data as unknown[])
    : [];

  const postRows = rows
    .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>) : null))
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .map((row) => {
      const likesSummary =
        row.likes && typeof row.likes === 'object'
          ? toNumberOrNull((row.likes as Record<string, unknown>).summary && typeof (row.likes as Record<string, unknown>).summary === 'object'
            ? ((row.likes as Record<string, unknown>).summary as Record<string, unknown>).total_count
            : null)
          : null;
      const commentsSummary =
        row.comments && typeof row.comments === 'object'
          ? toNumberOrNull((row.comments as Record<string, unknown>).summary && typeof (row.comments as Record<string, unknown>).summary === 'object'
            ? ((row.comments as Record<string, unknown>).summary as Record<string, unknown>).total_count
            : null)
          : null;
      const shares = row.shares && typeof row.shares === 'object'
        ? toNumberOrNull((row.shares as Record<string, unknown>).count)
        : null;

      return {
        provider: 'FACEBOOK' as const,
        externalPostId: typeof row.id === 'string' ? row.id : '',
        content: typeof row.message === 'string' ? row.message : '',
        createdAt: toIso(row.created_time),
        permalink: typeof row.permalink_url === 'string' ? row.permalink_url : undefined,
        metrics: {
          likes: likesSummary,
          comments: commentsSummary,
          shares,
          impressions: null,
          profileViews: null,
        },
        raw: row,
      };
    })
    .filter((row) => row.externalPostId.length > 0);

  await Promise.all(
    postRows.slice(0, MAX_INSIGHT_LOOKUPS).map(async (post) => {
      const insightEndpoint = `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(post.externalPostId)}/insights?metric=${encodeURIComponent('post_impressions_unique')}`;
      const insightResponse = await fetchJson(insightEndpoint, {
        method: 'GET',
        headers: { Authorization: `Bearer ${pageResult.pageAccessToken}` },
      });
      if (!insightResponse.ok) return;
      post.metrics = {
        ...(post.metrics || {}),
        impressions: parseMetaInsightMetric(insightResponse.body),
      };
    }),
  );

  return postRows;
};

const fetchInstagramPosts = async (params: {
  context: { config: Record<string, unknown>; encryptedPayload: string };
  encryptionKey: string;
  limit: number;
}): Promise<RemotePost[]> => {
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

  const endpoint = `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(instagramUserId)}/media?fields=${encodeURIComponent('id,caption,timestamp,permalink,media_type,media_url,like_count,comments_count')}&limit=${params.limit}`;
  const response = await fetchJson(endpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${pageResult.pageAccessToken || accessToken}` },
  });

  if (!response.ok || !response.body || typeof response.body !== 'object') return [];
  const rows = Array.isArray((response.body as Record<string, unknown>).data)
    ? ((response.body as Record<string, unknown>).data as unknown[])
    : [];

  const postRows = rows
    .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>) : null))
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .map((row) => ({
      provider: 'INSTAGRAM' as const,
      externalPostId: typeof row.id === 'string' ? row.id : '',
      content: typeof row.caption === 'string' ? row.caption : '',
      createdAt: toIso(row.timestamp),
      permalink: typeof row.permalink === 'string' ? row.permalink : undefined,
      metrics: {
        likes: toNumberOrNull(row.like_count),
        comments: toNumberOrNull(row.comments_count),
        shares: null,
        impressions: null,
        profileViews: null,
      },
      raw: row,
    }))
    .filter((row) => row.externalPostId.length > 0);

  await Promise.all(
    postRows.slice(0, MAX_INSIGHT_LOOKUPS).map(async (post) => {
      const insightEndpoint = `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(post.externalPostId)}/insights?metric=${encodeURIComponent('impressions,profile_activity')}`;
      const insightResponse = await fetchJson(insightEndpoint, {
        method: 'GET',
        headers: { Authorization: `Bearer ${pageResult.pageAccessToken || accessToken}` },
      });
      if (!insightResponse.ok || !insightResponse.body || typeof insightResponse.body !== 'object') return;
      const data = Array.isArray((insightResponse.body as Record<string, unknown>).data)
        ? ((insightResponse.body as Record<string, unknown>).data as unknown[])
        : [];

      let impressions: number | null = null;
      let profileViews: number | null = null;
      for (const item of data) {
        if (!item || typeof item !== 'object') continue;
        const name = String((item as Record<string, unknown>).name || '').trim();
        const metricValue = parseMetaInsightMetric({ data: [item] });
        if (metricValue === null) continue;
        if (name === 'impressions') impressions = metricValue;
        if (name === 'profile_activity') profileViews = metricValue;
      }

      post.metrics = {
        ...(post.metrics || {}),
        impressions,
        profileViews,
      };
    }),
  );

  return postRows;
};

const resolveGbpLocalPostsEndpoint = (config: Record<string, unknown>, limit: number) => {
  const locationName = readString(config, ['location_name', 'gbp_location_name']);
  if (locationName && locationName.startsWith('accounts/')) {
    return `https://mybusiness.googleapis.com/v4/${locationName}/localPosts?pageSize=${limit}`;
  }

  const accountId = readString(config, ['gbp_account_id', 'account_id']);
  const locationId = readString(config, ['gbp_location_id', 'location_id']);
  if (accountId && locationId) {
    return `https://mybusiness.googleapis.com/v4/accounts/${encodeURIComponent(accountId)}/locations/${encodeURIComponent(locationId)}/localPosts?pageSize=${limit}`;
  }
  return '';
};

const fetchGbpPosts = async (params: {
  supabaseAdmin: any;
  context: { config: Record<string, unknown>; integrationId: string; encryptedPayload: string; providerSecret?: string };
  encryptionKey: string;
  limit: number;
}): Promise<{ rows: RemotePost[]; error?: string }> => {
  const clientId = readString(params.context.config, ['client_id', 'google_client_id']);
  if (!clientId || !params.context.providerSecret) {
    return { rows: [], error: 'GBPの client_id/client_secret が未設定です。' };
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
    return { rows: [], error: token.error || 'GBP token refresh に失敗しました。' };
  }

  const endpoint = resolveGbpLocalPostsEndpoint(params.context.config, params.limit);
  if (!endpoint) {
    return { rows: [], error: 'GBPの account_id / location_id が未設定です。' };
  }

  const response = await fetchJson(endpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token.accessToken}` },
  });

  if (!response.ok || !response.body || typeof response.body !== 'object') {
    return {
      rows: [],
      error: extractProviderErrorMessage(response.body) || `GBP投稿一覧の取得に失敗しました。（status=${response.status}）`,
    };
  }

  const rows = Array.isArray((response.body as Record<string, unknown>).localPosts)
    ? ((response.body as Record<string, unknown>).localPosts as unknown[])
    : [];

  return {
    rows: rows
      .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>) : null))
      .filter((row): row is Record<string, unknown> => Boolean(row))
      .map((row) => ({
        provider: 'GBP' as const,
        externalPostId: typeof row.name === 'string' ? row.name : '',
        content: typeof row.summary === 'string' ? row.summary : '',
        createdAt: toIso(row.createTime || row.updateTime),
        permalink: typeof row.searchUrl === 'string' ? row.searchUrl : undefined,
        metrics: {
          impressions: null,
          profileViews: null,
          likes: null,
          comments: null,
          shares: null,
        },
        raw: row,
      }))
      .filter((row) => row.externalPostId.length > 0),
  };
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

  let payload: { storeId?: string; providers?: string[]; limit?: number; since?: string };
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
  const limit = Math.min(Math.max(Number(payload.limit || 20), 1), 100);
  const since = payload.since && payload.since.trim().length > 0 ? payload.since.trim() : null;

  const byProvider: Record<string, RemotePost[]> = {};
  const errors: Record<string, string> = {};

  for (const provider of providers) {
    const context = await loadProviderContext({
      supabaseAdmin,
      storeId,
      orgId: access.orgId,
      provider,
      encryptionKey,
    });

    if (!context) {
      byProvider[provider] = [];
      errors[provider] = '連携情報が未設定です。';
      continue;
    }

    if (provider === 'FACEBOOK') {
      byProvider[provider] = filterBySince(
        await fetchFacebookPosts({ context, encryptionKey, limit }),
        since
      );
      continue;
    }

    if (provider === 'INSTAGRAM') {
      byProvider[provider] = filterBySince(
        await fetchInstagramPosts({ context, encryptionKey, limit }),
        since
      );
      continue;
    }

    const gbpResult = await fetchGbpPosts({
      supabaseAdmin,
      context,
      encryptionKey,
      limit,
    });
    byProvider[provider] = filterBySince(gbpResult.rows, since);
    if (gbpResult.error) {
      errors[provider] = gbpResult.error;
    }
  }

  const merged = Object.values(byProvider)
    .flat()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return jsonResponse(200, {
    ok: true,
    storeId,
    fetchedAt: new Date().toISOString(),
    providers,
    byProvider,
    merged,
    errors,
  });
});
