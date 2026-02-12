import { resolveAuthenticatedUserId } from '../_shared/auth.ts';
import { decryptAesGcm } from '../_shared/crypto.ts';
import { ensureGoogleAccessToken } from '../_shared/googleAuth.ts';
import { extractProviderErrorMessage, fetchJson, jsonResponse, optionsResponse, readString } from '../_shared/http.ts';
import { createServiceRoleClient, requireEnv } from '../_shared/supabase.ts';

type RangeKey = '7days' | '30days';

type DailyPoint = {
  date: string;
  views: number;
  actions: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const toYmd = (date: Date) => ({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth() + 1,
  day: date.getUTCDate(),
});

const formatYmd = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateValue = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const year = typeof row.year === 'number' ? row.year : Number(row.year || 0);
  const month = typeof row.month === 'number' ? row.month : Number(row.month || 0);
  const day = typeof row.day === 'number' ? row.day : Number(row.day || 0);
  if (!year || !month || !day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const buildEmptySeries = (range: RangeKey): DailyPoint[] => {
  const days = range === '30days' ? 30 : 7;
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);

  const series: DailyPoint[] = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(end.getTime() - index * DAY_MS);
    series.push({ date: formatYmd(date), views: 0, actions: 0 });
  }
  return series;
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

const resolveGbpContext = async (params: {
  supabaseAdmin: any;
  storeId: string;
  orgId: string;
  encryptionKey: string;
}) => {
  const { data: catalog } = await params.supabaseAdmin
    .from('provider_catalog')
    .select('id')
    .eq('org_id', params.orgId)
    .eq('provider_key', 'GBP')
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
    .eq('provider', 'GBP')
    .maybeSingle();
  if (!integration?.id || integration.status !== 'CONNECTED') return null;

  const { data: credential } = await params.supabaseAdmin
    .from('integration_credentials')
    .select('encrypted_payload')
    .eq('integration_id', integration.id)
    .maybeSingle();
  if (!credential?.encrypted_payload) return null;

  const { data: secret } = await params.supabaseAdmin
    .from('provider_secrets')
    .select('encrypted_secret')
    .eq('provider_configuration_id', configuration.id)
    .maybeSingle();

  let providerSecret = '';
  if (secret?.encrypted_secret) {
    try {
      providerSecret = await decryptAesGcm(String(secret.encrypted_secret), params.encryptionKey);
    } catch {
      providerSecret = '';
    }
  }

  const config = configuration.config && typeof configuration.config === 'object' ? configuration.config : {};
  return {
    config,
    integrationId: integration.id,
    encryptedPayload: String(credential.encrypted_payload),
    providerSecret: providerSecret || undefined,
  };
};

const resolveLocationName = (config: Record<string, unknown>): string => {
  const direct = readString(config, ['location_name', 'gbp_location_name']);
  if (direct && direct.startsWith('locations/')) return direct;
  if (direct && direct.startsWith('accounts/')) {
    const match = direct.match(/locations\/([^/]+)/);
    if (match?.[1]) return `locations/${match[1]}`;
  }

  const locationId = readString(config, ['gbp_location_id', 'location_id']);
  if (locationId) {
    if (locationId.startsWith('locations/')) return locationId;
    return `locations/${locationId}`;
  }

  return '';
};

const fetchGbpPerformance = async (params: {
  supabaseAdmin: any;
  context: { config: Record<string, unknown>; integrationId: string; encryptedPayload: string; providerSecret?: string };
  encryptionKey: string;
  range: RangeKey;
}): Promise<{ series: DailyPoint[]; kpis: { views: number; actions: number; phone: number; website: number; route: number }; error?: string }> => {
  const clientId = readString(params.context.config, ['client_id', 'google_client_id']);
  if (!clientId || !params.context.providerSecret) {
    return {
      series: buildEmptySeries(params.range),
      kpis: { views: 0, actions: 0, phone: 0, website: 0, route: 0 },
      error: 'GBPの client_id/client_secret が未設定です。',
    };
  }

  const locationName = resolveLocationName(params.context.config);
  if (!locationName) {
    return {
      series: buildEmptySeries(params.range),
      kpis: { views: 0, actions: 0, phone: 0, website: 0, route: 0 },
      error: 'GBPの店舗ID（location_id）が未設定です。',
    };
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
    return {
      series: buildEmptySeries(params.range),
      kpis: { views: 0, actions: 0, phone: 0, website: 0, route: 0 },
      error: token.error || 'GBP access_token の取得に失敗しました。',
    };
  }

  const days = params.range === '30days' ? 30 : 7;
  const endDate = new Date();
  endDate.setUTCHours(0, 0, 0, 0);
  const startDate = new Date(endDate.getTime() - (days - 1) * DAY_MS);

  const response = await fetchJson(
    `https://businessprofileperformance.googleapis.com/v1/${encodeURIComponent(locationName)}:fetchMultiDailyMetricsTimeSeries`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dailyMetrics: [
          'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
          'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
          'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
          'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
          'WEBSITE_CLICKS',
          'CALL_CLICKS',
          'BUSINESS_DIRECTION_REQUESTS',
        ],
        dailyRange: {
          startDate: toYmd(startDate),
          endDate: toYmd(endDate),
        },
      }),
    }
  );

  const series = buildEmptySeries(params.range);
  const seriesMap = new Map(series.map((point) => [point.date, point]));

  const metrics: Record<string, number> = {
    WEBSITE_CLICKS: 0,
    CALL_CLICKS: 0,
    BUSINESS_DIRECTION_REQUESTS: 0,
    BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 0,
    BUSINESS_IMPRESSIONS_MOBILE_MAPS: 0,
    BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 0,
    BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 0,
  };

  if (!response.ok || !response.body || typeof response.body !== 'object') {
    return {
      series,
      kpis: { views: 0, actions: 0, phone: 0, website: 0, route: 0 },
      error: extractProviderErrorMessage(response.body) || `GBP指標の取得に失敗しました。（status=${response.status}）`,
    };
  }

  const body = response.body as Record<string, unknown>;
  const metricRows = Array.isArray(body.multiDailyMetricTimeSeries) ? (body.multiDailyMetricTimeSeries as unknown[]) : [];

  for (const metricRow of metricRows) {
    if (!metricRow || typeof metricRow !== 'object') continue;
    const metricObj = metricRow as Record<string, unknown>;
    const metricName = String(metricObj.dailyMetric || '');
    if (!metricName) continue;

    const timeSeries = metricObj.timeSeries && typeof metricObj.timeSeries === 'object'
      ? (metricObj.timeSeries as Record<string, unknown>)
      : null;
    const dateRows = timeSeries && Array.isArray(timeSeries.datedValues) ? (timeSeries.datedValues as unknown[]) : [];

    for (const dateRow of dateRows) {
      if (!dateRow || typeof dateRow !== 'object') continue;
      const row = dateRow as Record<string, unknown>;
      const key = parseDateValue(row.date);
      if (!key) continue;

      const valueObj = row.value && typeof row.value === 'object' ? (row.value as Record<string, unknown>) : {};
      const value = Number(valueObj.value || valueObj.doubleValue || 0);
      const safeValue = Number.isFinite(value) ? value : 0;

      metrics[metricName] = (metrics[metricName] || 0) + safeValue;

      const point = seriesMap.get(key);
      if (!point) continue;
      if (metricName.startsWith('BUSINESS_IMPRESSIONS')) {
        point.views += safeValue;
      }
      if (metricName === 'WEBSITE_CLICKS' || metricName === 'CALL_CLICKS' || metricName === 'BUSINESS_DIRECTION_REQUESTS') {
        point.actions += safeValue;
      }
    }
  }

  const viewTotal =
    metrics.BUSINESS_IMPRESSIONS_DESKTOP_MAPS +
    metrics.BUSINESS_IMPRESSIONS_MOBILE_MAPS +
    metrics.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH +
    metrics.BUSINESS_IMPRESSIONS_MOBILE_SEARCH;
  const websiteTotal = metrics.WEBSITE_CLICKS;
  const phoneTotal = metrics.CALL_CLICKS;
  const routeTotal = metrics.BUSINESS_DIRECTION_REQUESTS;

  return {
    series,
    kpis: {
      views: Math.round(viewTotal),
      website: Math.round(websiteTotal),
      phone: Math.round(phoneTotal),
      route: Math.round(routeTotal),
      actions: Math.round(websiteTotal + phoneTotal + routeTotal),
    },
  };
};

const countRowsByDate = (rows: Array<{ created_at?: string; received_at?: string }>, days: number): Record<string, number> => {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - (days - 1) * DAY_MS);
  const counts: Record<string, number> = {};
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(end.getTime() - index * DAY_MS);
    counts[formatYmd(date)] = 0;
  }

  for (const row of rows) {
    const raw = row.created_at || row.received_at;
    if (!raw) continue;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) continue;
    if (date.getTime() < start.getTime()) continue;
    const key = formatYmd(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())));
    if (key in counts) {
      counts[key] += 1;
    }
  }

  return counts;
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

  let payload: { storeId?: string; range?: RangeKey };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const storeId = payload.storeId?.trim();
  if (!storeId) {
    return jsonResponse(400, { error: 'Missing storeId' });
  }

  const range: RangeKey = payload.range === '30days' ? '30days' : '7days';
  const days = range === '30days' ? 30 : 7;

  const access = await ensureStoreAccess({
    supabaseAdmin,
    userId: auth.userId,
    storeId,
  });
  if (!access.ok || !access.orgId) {
    return jsonResponse(403, { error: access.error || 'Not allowed' });
  }

  const gbpContext = await resolveGbpContext({
    supabaseAdmin,
    storeId,
    orgId: access.orgId,
    encryptionKey,
  });

  let performance = {
    series: buildEmptySeries(range),
    kpis: { views: 0, actions: 0, phone: 0, website: 0, route: 0 },
    error: 'GBP未接続',
  };

  if (gbpContext) {
    performance = await fetchGbpPerformance({
      supabaseAdmin,
      context: gbpContext,
      encryptionKey,
      range,
    });
  }

  const startAt = new Date();
  startAt.setUTCHours(0, 0, 0, 0);
  startAt.setTime(startAt.getTime() - (days - 1) * DAY_MS);

  const [{ data: postRows }, { data: inboxRows }] = await Promise.all([
    supabaseAdmin
      .from('posts')
      .select('id, created_at, status')
      .eq('store_id', storeId)
      .gte('created_at', startAt.toISOString()),
    supabaseAdmin
      .from('inbox_messages')
      .select('id, received_at, is_replied')
      .eq('store_id', storeId)
      .gte('received_at', startAt.toISOString()),
  ]);

  const postCounts = countRowsByDate((postRows || []) as Array<{ created_at?: string }>, days);
  const inboxCounts = countRowsByDate((inboxRows || []) as Array<{ received_at?: string }>, days);

  const mergedSeries = performance.series.map((point) => ({
    ...point,
    actions: point.actions + (postCounts[point.date] || 0),
  }));

  const totalPostCount = Array.isArray(postRows) ? postRows.length : 0;
  const totalInboxCount = Array.isArray(inboxRows) ? inboxRows.length : 0;
  const unrepliedCount = Array.isArray(inboxRows)
    ? (inboxRows as Array<{ is_replied?: boolean }>).filter((row) => !row.is_replied).length
    : 0;

  const directSearchRaw = performance.kpis.views > 0
    ? Math.round((performance.kpis.website / Math.max(performance.kpis.views, 1)) * 100)
    : 0;
  const directSearch = Math.min(Math.max(directSearchRaw, 0), 100);
  const discoverySearch = 100 - directSearch;

  return jsonResponse(200, {
    ok: true,
    storeId,
    range,
    kpis: {
      mapViews: performance.kpis.views,
      routeSearches: performance.kpis.route,
      phoneClicks: performance.kpis.phone,
      websiteClicks: performance.kpis.website,
      actions: performance.kpis.actions,
      postCount: totalPostCount,
      inboxCount: totalInboxCount,
      unrepliedCount,
    },
    searchBreakdown: {
      direct: directSearch,
      discovery: discoverySearch,
    },
    timeseries: mergedSeries,
    dataSource: {
      gbpConnected: Boolean(gbpContext),
      metricsMode: performance.error ? 'FALLBACK' : 'REAL',
      error: performance.error,
    },
  });
});
