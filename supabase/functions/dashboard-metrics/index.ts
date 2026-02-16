import { resolveAuthenticatedUserId } from '../_shared/auth.ts';
import { decryptAesGcm } from '../_shared/crypto.ts';
import { ensureGoogleAccessToken } from '../_shared/googleAuth.ts';
import { resolveAndPersistGbpLocation } from '../_shared/googleLocation.ts';
import { extractProviderErrorMessage, fetchJson, jsonResponse, optionsResponse, readString } from '../_shared/http.ts';
import { resolveMetaPageAccessToken, resolveMetaUserAccessToken } from '../_shared/metaAuth.ts';
import { createServiceRoleClient, requireEnv } from '../_shared/supabase.ts';

type RangeKey = '7days' | '30days';
type ProviderKey = 'GBP' | 'FACEBOOK' | 'INSTAGRAM';
type ProviderMode = 'REAL' | 'NO_DATA' | 'DISCONNECTED' | 'ERROR';

type DailyPoint = {
  date: string;
  views: number;
  actions: number;
};

type DashboardTimeseriesPoint = {
  date: string;
  posts: number;
  messages: number;
};

type DashboardTimeseriesDetailedPoint = {
  date: string;
  totalPosts: number;
  totalMessages: number;
  gbpPosts: number;
  facebookPosts: number;
  instagramPosts: number;
  gbpMessages: number;
  facebookMessages: number;
  instagramMessages: number;
  gbpImpressions: number;
};

type ProviderMetrics = {
  impressions: number | null;
  profileViews: number | null;
  posts: number;
  comments: number;
  likes: number;
  phoneClicks: number | null;
  websiteClicks: number | null;
  routeSearches: number | null;
};

type ProviderSummary = {
  provider: ProviderKey;
  label: string;
  connected: boolean;
  mode: ProviderMode;
  message?: string;
  metrics: ProviderMetrics;
};

type ProviderContext = {
  providerConfigurationId: string;
  config: Record<string, unknown>;
  integrationId: string;
  encryptedPayload: string;
  providerSecret?: string;
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

const buildDateRange = (range: RangeKey) => {
  const days = range === '30days' ? 30 : 7;
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - (days - 1) * DAY_MS);
  const endExclusive = new Date(end.getTime() + DAY_MS);
  return {
    days,
    start,
    end,
    startIso: start.toISOString(),
    endExclusiveIso: endExclusive.toISOString(),
    sinceUnix: Math.floor(start.getTime() / 1000),
    untilUnix: Math.floor((endExclusive.getTime() - 1) / 1000),
  };
};

const buildEmptySeries = (range: RangeKey): DailyPoint[] => {
  const { days, end } = buildDateRange(range);
  const series: DailyPoint[] = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(end.getTime() - index * DAY_MS);
    series.push({ date: formatYmd(date), views: 0, actions: 0 });
  }
  return series;
};

const buildEmptyDetailedActivitySeries = (range: RangeKey): DashboardTimeseriesDetailedPoint[] => {
  const { days, end } = buildDateRange(range);
  const series: DashboardTimeseriesDetailedPoint[] = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(end.getTime() - index * DAY_MS);
    series.push({
      date: formatYmd(date),
      totalPosts: 0,
      totalMessages: 0,
      gbpPosts: 0,
      facebookPosts: 0,
      instagramPosts: 0,
      gbpMessages: 0,
      facebookMessages: 0,
      instagramMessages: 0,
      gbpImpressions: 0,
    });
  }
  return series;
};

const providerLabelMap: Record<ProviderKey, string> = {
  GBP: 'Googleビジネスプロフィール',
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
};

const emptyProviderMetrics = (): ProviderMetrics => ({
  impressions: null,
  profileViews: null,
  posts: 0,
  comments: 0,
  likes: 0,
  phoneClicks: null,
  websiteClicks: null,
  routeSearches: null,
});

const toProviderSummary = (params: {
  provider: ProviderKey;
  connected: boolean;
  mode: ProviderMode;
  message?: string;
  metrics?: Partial<ProviderMetrics>;
}): ProviderSummary => ({
  provider: params.provider,
  label: providerLabelMap[params.provider],
  connected: params.connected,
  mode: params.mode,
  message: params.message,
  metrics: {
    ...emptyProviderMetrics(),
    ...(params.metrics || {}),
  },
});

const toNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeProviderKey = (value: unknown): ProviderKey | null => {
  const provider = String(value || '').trim().toUpperCase();
  if (provider === 'GBP' || provider === 'GOOGLE_BUSINESS') return 'GBP';
  if (provider === 'FACEBOOK') return 'FACEBOOK';
  if (provider === 'INSTAGRAM') return 'INSTAGRAM';
  return null;
};

const sumNestedNumbers = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (Array.isArray(value)) return value.reduce((sum, row) => sum + sumNestedNumbers(row), 0);
  if (!value || typeof value !== 'object') return 0;
  return Object.values(value as Record<string, unknown>).reduce((sum, row) => sum + sumNestedNumbers(row), 0);
};

const extractHttpErrorText = (response: { body: unknown; text?: string; status: number }, fallback: string): string => {
  const providerMessage = extractProviderErrorMessage(response.body);
  if (providerMessage) {
    const normalized = providerMessage.trim();
    if (/^<!doctype html/i.test(normalized) || /^<html/i.test(normalized)) {
      return `${fallback}（status=${response.status}）`;
    }
    return normalized;
  }
  const text = typeof response.text === 'string' ? response.text.trim() : '';
  if (/^<!doctype html/i.test(text) || /^<html/i.test(text)) {
    return `${fallback}（status=${response.status}）`;
  }
  if (text.length > 0) {
    return text.length > 220 ? `${text.slice(0, 220)}...` : text;
  }
  return `${fallback}（status=${response.status}）`;
};

const toMetricNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object') return 0;
  const typed = value as Record<string, unknown>;
  const raw = typed.value ?? typed.intValue ?? typed.doubleValue ?? typed.floatValue ?? 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

const extractLegacyInsightMetrics = (body: unknown) => {
  const typedBody = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const locationMetrics = Array.isArray(typedBody.locationMetrics) ? typedBody.locationMetrics : [];
  const totals: Record<string, number> = {};

  for (const locationMetric of locationMetrics) {
    if (!locationMetric || typeof locationMetric !== 'object') continue;
    const metricValues = Array.isArray((locationMetric as Record<string, unknown>).metricValues)
      ? ((locationMetric as Record<string, unknown>).metricValues as unknown[])
      : [];
    for (const metricValue of metricValues) {
      if (!metricValue || typeof metricValue !== 'object') continue;
      const typedMetric = metricValue as Record<string, unknown>;
      const metricName = String(typedMetric.metric || '').trim().toUpperCase();
      if (!metricName) continue;

      let value = toMetricNumber(typedMetric.totalValue);
      const dimensions = Array.isArray(typedMetric.dimensionalValues) ? typedMetric.dimensionalValues : [];
      for (const dimension of dimensions) {
        if (!dimension || typeof dimension !== 'object') continue;
        value += toMetricNumber((dimension as Record<string, unknown>).value);
      }

      totals[metricName] = (totals[metricName] || 0) + value;
    }
  }

  return totals;
};

const extractInsightsMetricTotal = (body: unknown, metricName: string): number | null => {
  const typedBody = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const rows = Array.isArray(typedBody.data) ? typedBody.data : [];
  const target = rows
    .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>) : null))
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .find((row) => String(row.name || '').trim() === metricName);
  if (!target) return null;
  const values = Array.isArray(target.values) ? target.values : [];
  if (values.length === 0) return 0;
  const total = values.reduce((sum, row) => {
    if (!row || typeof row !== 'object') return sum;
    return sum + sumNestedNumbers((row as Record<string, unknown>).value);
  }, 0);
  return Math.round(total);
};

const readSummaryCount = (row: Record<string, unknown>, key: string): number => {
  const container = row[key] && typeof row[key] === 'object' ? (row[key] as Record<string, unknown>) : {};
  const summary = container.summary && typeof container.summary === 'object'
    ? (container.summary as Record<string, unknown>)
    : {};
  const total = Number(summary.total_count || 0);
  return Number.isFinite(total) ? Math.round(total) : 0;
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

const resolveProviderContext = async (params: {
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
  if (!catalog?.id) {
    return { reason: '連携先が無効です。管理者に確認してください。' };
  }

  const { data: configuration } = await params.supabaseAdmin
    .from('provider_configurations')
    .select('id, config, connection_status, last_error')
    .eq('store_id', params.storeId)
    .eq('provider_catalog_id', catalog.id)
    .maybeSingle();
  if (!configuration) {
    return { reason: '連携設定が未作成です。' };
  }

  const { data: integration } = await params.supabaseAdmin
    .from('integrations')
    .select('id, status, last_error')
    .eq('store_id', params.storeId)
    .eq('provider', params.provider)
    .maybeSingle();
  if (!integration?.id) {
    return { reason: 'integration情報が見つかりません。' };
  }

  const { data: credential } = await params.supabaseAdmin
    .from('integration_credentials')
    .select('encrypted_payload')
    .eq('integration_id', integration.id)
    .maybeSingle();
  if (!credential?.encrypted_payload) {
    return { reason: 'OAuth認証情報が見つかりません。' };
  }

  const config = configuration.config && typeof configuration.config === 'object'
    ? (configuration.config as Record<string, unknown>)
    : {};

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
      providerConfigurationId: String(configuration.id),
      config,
      integrationId: String(integration.id),
      encryptedPayload: String(credential.encrypted_payload),
      providerSecret: providerSecret || undefined,
    },
  };
};

const buildPerformanceSeriesFromTotals = (params: {
  range: RangeKey;
  totalViews: number;
  totalActions: number;
}): DailyPoint[] => {
  const series = buildEmptySeries(params.range);
  const days = series.length;
  const safeViews = Math.max(0, Math.round(params.totalViews));
  const safeActions = Math.max(0, Math.round(params.totalActions));
  const viewBase = Math.floor(safeViews / Math.max(days, 1));
  const actionBase = Math.floor(safeActions / Math.max(days, 1));
  let viewRemain = safeViews - viewBase * days;
  let actionRemain = safeActions - actionBase * days;

  return series.map((point) => {
    const next = { ...point, views: viewBase, actions: actionBase };
    if (viewRemain > 0) {
      next.views += 1;
      viewRemain -= 1;
    }
    if (actionRemain > 0) {
      next.actions += 1;
      actionRemain -= 1;
    }
    return next;
  });
};

const resolveGbpLocalPostsEndpoint = (params: {
  config: Record<string, unknown>;
  locationName?: string;
  accountId?: string;
  locationId?: string;
  limit: number;
}): string => {
  const locationName = (params.locationName || readString(params.config, ['location_name', 'gbp_location_name'])).replace(/^\/+/, '');
  if (locationName && locationName.startsWith('accounts/')) {
    return `https://mybusiness.googleapis.com/v4/${locationName}/localPosts?pageSize=${params.limit}`;
  }

  const accountId = params.accountId || readString(params.config, ['gbp_account_id', 'account_id']);
  const locationId = params.locationId || readString(params.config, ['gbp_location_id', 'location_id']);
  if (accountId && locationId) {
    return `https://mybusiness.googleapis.com/v4/accounts/${encodeURIComponent(accountId)}/locations/${encodeURIComponent(locationId)}/localPosts?pageSize=${params.limit}`;
  }
  return '';
};

const fetchGbpPerformance = async (params: {
  supabaseAdmin: any;
  context: ProviderContext;
  encryptionKey: string;
  range: RangeKey;
}): Promise<{
  series: DailyPoint[];
  kpis: {
    views: number;
    actions: number;
    phone: number;
    website: number;
    route: number;
    mapImpressions: number;
    searchImpressions: number;
  };
  mode: 'REAL' | 'FALLBACK';
  warning?: string;
  accessToken?: string;
  locationName?: string;
  accountId?: string;
  locationId?: string;
}> => {
  const clientId = readString(params.context.config, ['client_id', 'google_client_id']);
  if (!clientId || !params.context.providerSecret) {
    return {
      series: buildEmptySeries(params.range),
      kpis: { views: 0, actions: 0, phone: 0, website: 0, route: 0, mapImpressions: 0, searchImpressions: 0 },
      mode: 'FALLBACK',
      warning: 'GBPの client_id/client_secret が未設定です。',
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
      kpis: { views: 0, actions: 0, phone: 0, website: 0, route: 0, mapImpressions: 0, searchImpressions: 0 },
      mode: 'FALLBACK',
      warning: token.error || 'GBP access_token の取得に失敗しました。',
    };
  }

  const location = await resolveAndPersistGbpLocation({
    supabaseAdmin: params.supabaseAdmin,
    providerConfigurationId: params.context.providerConfigurationId,
    config: params.context.config,
    accessToken: token.accessToken,
  });
  if (!location.ok || !location.locationName) {
    return {
      series: buildEmptySeries(params.range),
      kpis: { views: 0, actions: 0, phone: 0, website: 0, route: 0, mapImpressions: 0, searchImpressions: 0 },
      mode: 'FALLBACK',
      warning: location.error || 'GBPの店舗ID（location_id）が未設定です。',
    };
  }

  const locationName = location.locationName.replace(/^\/+/, '');
  const accountId = location.accountId || readString(params.context.config, ['gbp_account_id', 'account_id']);
  const locationId = location.locationId || readString(params.context.config, ['gbp_location_id', 'location_id']);

  const { days, start, end } = buildDateRange(params.range);

  const dailyMetrics = [
    'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
    'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
    'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
    'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
    'WEBSITE_CLICKS',
    'CALL_CLICKS',
    'BUSINESS_DIRECTION_REQUESTS',
  ];
  const buildPerformanceQuery = () => {
    const query = new URLSearchParams();
    dailyMetrics.forEach((metric) => {
      query.append('dailyMetrics', metric);
    });
    const startDate = toYmd(start);
    const endDate = toYmd(end);
    query.set('dailyRange.start_date.year', String(startDate.year));
    query.set('dailyRange.start_date.month', String(startDate.month));
    query.set('dailyRange.start_date.day', String(startDate.day));
    query.set('dailyRange.end_date.year', String(endDate.year));
    query.set('dailyRange.end_date.month', String(endDate.month));
    query.set('dailyRange.end_date.day', String(endDate.day));
    return query.toString();
  };
  const performanceQuery = buildPerformanceQuery();

  const performanceEndpoints = Array.from(
    new Set(
      [
        locationName ? `https://businessprofileperformance.googleapis.com/v1/${locationName}:fetchMultiDailyMetricsTimeSeries?${performanceQuery}` : '',
        locationId ? `https://businessprofileperformance.googleapis.com/v1/locations/${locationId}:fetchMultiDailyMetricsTimeSeries?${performanceQuery}` : '',
      ].filter((value) => value.length > 0)
    )
  );

  let response: { ok: boolean; status: number; body: unknown; text: string } | null = null;
  const providerErrors: Array<{ status: number; message: string }> = [];

  for (const endpoint of performanceEndpoints) {
    const currentResponse = await fetchJson(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
      },
    });
    if (currentResponse.ok && currentResponse.body && typeof currentResponse.body === 'object') {
      response = currentResponse;
      break;
    }
    providerErrors.push({
      status: currentResponse.status,
      message: extractHttpErrorText(currentResponse, 'GBP指標の取得に失敗しました。'),
    });
  }

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

  if (!response || !response.ok || !response.body || typeof response.body !== 'object') {
    if (accountId && locationId) {
      const locationResourceName = `accounts/${accountId}/locations/${locationId}`;
      const legacyEndpoints = [
        `https://mybusiness.googleapis.com/v4/accounts/${encodeURIComponent(accountId)}/locations:reportInsights`,
        `https://mybusiness.googleapis.com/v4/accounts/${encodeURIComponent(accountId)}/locations/${encodeURIComponent(locationId)}:reportInsights`,
      ];
      const legacyBody = {
        locationNames: [locationResourceName],
        basicRequest: {
          metricRequests: [
            { metric: 'VIEWS_MAPS' },
            { metric: 'VIEWS_SEARCH' },
            { metric: 'ACTIONS_WEBSITE' },
            { metric: 'ACTIONS_PHONE' },
            { metric: 'ACTIONS_DRIVING_DIRECTIONS' },
          ],
          timeRange: {
            startTime: start.toISOString(),
            endTime: new Date(end.getTime() + DAY_MS - 1).toISOString(),
          },
        },
      };

      for (const endpoint of legacyEndpoints) {
        const legacyResponse = await fetchJson(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(legacyBody),
        });

        if (!legacyResponse.ok || !legacyResponse.body || typeof legacyResponse.body !== 'object') {
          providerErrors.push({
            status: legacyResponse.status,
            message: extractHttpErrorText(legacyResponse, 'GBP指標の取得に失敗しました。'),
          });
          continue;
        }

        const legacyMetrics = extractLegacyInsightMetrics(legacyResponse.body);
        const viewsTotal = (legacyMetrics.VIEWS_MAPS || 0) + (legacyMetrics.VIEWS_SEARCH || 0);
        const websiteTotal = legacyMetrics.ACTIONS_WEBSITE || 0;
        const phoneTotal = legacyMetrics.ACTIONS_PHONE || 0;
        const routeTotal = legacyMetrics.ACTIONS_DRIVING_DIRECTIONS || 0;
        const actionsTotal = websiteTotal + phoneTotal + routeTotal;

        return {
          series: buildPerformanceSeriesFromTotals({
            range: params.range,
            totalViews: viewsTotal,
            totalActions: actionsTotal,
          }),
          kpis: {
            views: Math.round(viewsTotal),
            website: Math.round(websiteTotal),
            phone: Math.round(phoneTotal),
            route: Math.round(routeTotal),
            actions: Math.round(actionsTotal),
            mapImpressions: Math.round(legacyMetrics.VIEWS_MAPS || 0),
            searchImpressions: Math.round(legacyMetrics.VIEWS_SEARCH || 0),
          },
          mode: 'REAL',
          accessToken: token.accessToken,
          locationName,
          accountId: accountId || undefined,
          locationId: locationId || undefined,
        };
      }
    }

    const fallbackError =
      providerErrors.find((item) => item.message && item.message.length > 0)?.message || 'GBP指標の取得に失敗しました。';
    return {
      series,
      kpis: { views: 0, actions: 0, phone: 0, website: 0, route: 0, mapImpressions: 0, searchImpressions: 0 },
      mode: 'FALLBACK',
      warning: fallbackError.includes('status=') ? fallbackError : `${fallbackError}`,
    };
  }

  const body = response.body as Record<string, unknown>;
  const metricGroups = Array.isArray(body.multiDailyMetricTimeSeries) ? (body.multiDailyMetricTimeSeries as unknown[]) : [];
  const metricRows = metricGroups.flatMap((group) => {
    if (!group || typeof group !== 'object') return [];
    const typedGroup = group as Record<string, unknown>;
    const nested = Array.isArray(typedGroup.dailyMetricTimeSeries) ? (typedGroup.dailyMetricTimeSeries as unknown[]) : [];
    if (nested.length > 0) return nested;
    return [typedGroup];
  });

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
      mapImpressions: Math.round(metrics.BUSINESS_IMPRESSIONS_DESKTOP_MAPS + metrics.BUSINESS_IMPRESSIONS_MOBILE_MAPS),
      searchImpressions: Math.round(metrics.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH + metrics.BUSINESS_IMPRESSIONS_MOBILE_SEARCH),
    },
    mode: 'REAL',
    accessToken: token.accessToken,
    locationName,
    accountId: accountId || undefined,
    locationId: locationId || undefined,
  };
};

const fetchGbpPostCount = async (params: {
  context: ProviderContext;
  performanceResult: Awaited<ReturnType<typeof fetchGbpPerformance>>;
  range: RangeKey;
}): Promise<number> => {
  if (params.performanceResult.mode !== 'REAL' || !params.performanceResult.accessToken) return 0;

  const endpoint = resolveGbpLocalPostsEndpoint({
    config: params.context.config,
    locationName: params.performanceResult.locationName,
    accountId: params.performanceResult.accountId,
    locationId: params.performanceResult.locationId,
    limit: 100,
  });
  if (!endpoint) return 0;

  const response = await fetchJson(endpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${params.performanceResult.accessToken}` },
  });
  if (!response.ok || !response.body || typeof response.body !== 'object') return 0;
  const rows = Array.isArray((response.body as Record<string, unknown>).localPosts)
    ? ((response.body as Record<string, unknown>).localPosts as unknown[])
    : [];

  const { start } = buildDateRange(params.range);
  const startMs = start.getTime();
  return rows
    .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>) : null))
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .filter((row) => {
      const tsRaw = row.createTime || row.updateTime;
      const ts = typeof tsRaw === 'string' ? new Date(tsRaw).getTime() : Number.NaN;
      if (!Number.isFinite(ts)) return false;
      return ts >= startMs;
    }).length;
};

const fetchFacebookMetrics = async (params: {
  context: ProviderContext;
  encryptionKey: string;
  range: RangeKey;
}): Promise<{ metrics: ProviderMetrics; mode: ProviderMode; message?: string }> => {
  const { sinceUnix, untilUnix } = buildDateRange(params.range);
  const { accessToken } = await resolveMetaUserAccessToken({
    encryptedPayload: params.context.encryptedPayload,
    encryptionKey: params.encryptionKey,
  });
  if (!accessToken) {
    return { metrics: emptyProviderMetrics(), mode: 'ERROR', message: 'Facebookのアクセストークンが取得できません。' };
  }

  const graphApiVersion = readString(params.context.config, ['graph_api_version']) || 'v20.0';
  const preferredPageId = readString(params.context.config, ['facebook_page_id', 'fb_page_id', 'page_id']);
  const pageResult = await resolveMetaPageAccessToken({
    userAccessToken: accessToken,
    graphApiVersion,
    preferredPageId: preferredPageId || undefined,
  });
  if (!pageResult.ok || !pageResult.pageId || !pageResult.pageAccessToken) {
    return { metrics: emptyProviderMetrics(), mode: 'ERROR', message: pageResult.error || 'Facebookページ情報を取得できません。' };
  }

  const postFields = 'id,created_time,likes.limit(0).summary(true),comments.limit(0).summary(true)';
  const postEndpoint =
    `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(pageResult.pageId)}/posts` +
    `?fields=${encodeURIComponent(postFields)}&limit=100&since=${sinceUnix}&until=${untilUnix}`;
  const postResponse = await fetchJson(postEndpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${pageResult.pageAccessToken}` },
  });
  if (!postResponse.ok || !postResponse.body || typeof postResponse.body !== 'object') {
    return {
      metrics: emptyProviderMetrics(),
      mode: 'ERROR',
      message: extractHttpErrorText(postResponse, 'Facebook投稿の取得に失敗しました。'),
    };
  }

  const postRows = Array.isArray((postResponse.body as Record<string, unknown>).data)
    ? ((postResponse.body as Record<string, unknown>).data as unknown[])
    : [];
  const posts = postRows.length;
  let comments = 0;
  let likes = 0;
  for (const row of postRows) {
    if (!row || typeof row !== 'object') continue;
    const typed = row as Record<string, unknown>;
    comments += readSummaryCount(typed, 'comments');
    likes += readSummaryCount(typed, 'likes');
  }

  const insightsEndpoint =
    `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(pageResult.pageId)}/insights` +
    `?metric=page_impressions,page_views_total&period=day&since=${sinceUnix}&until=${untilUnix}`;
  const insightsResponse = await fetchJson(insightsEndpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${pageResult.pageAccessToken}` },
  });
  const impressions = insightsResponse.ok
    ? extractInsightsMetricTotal(insightsResponse.body, 'page_impressions')
    : null;
  const profileViews = insightsResponse.ok
    ? extractInsightsMetricTotal(insightsResponse.body, 'page_views_total')
    : null;

  const hasMetric = posts > 0 || comments > 0 || likes > 0 || (impressions || 0) > 0 || (profileViews || 0) > 0;
  return {
    mode: hasMetric ? 'REAL' : 'NO_DATA',
    metrics: {
      ...emptyProviderMetrics(),
      impressions,
      profileViews,
      posts,
      comments,
      likes,
    },
  };
};

const fetchInstagramMetrics = async (params: {
  context: ProviderContext;
  encryptionKey: string;
  range: RangeKey;
}): Promise<{ metrics: ProviderMetrics; mode: ProviderMode; message?: string }> => {
  const { sinceUnix, untilUnix } = buildDateRange(params.range);
  const { accessToken } = await resolveMetaUserAccessToken({
    encryptedPayload: params.context.encryptedPayload,
    encryptionKey: params.encryptionKey,
  });
  if (!accessToken) {
    return { metrics: emptyProviderMetrics(), mode: 'ERROR', message: 'Instagramのアクセストークンが取得できません。' };
  }

  const graphApiVersion = readString(params.context.config, ['graph_api_version']) || 'v20.0';
  const preferredPageId = readString(params.context.config, ['facebook_page_id', 'fb_page_id', 'page_id']);
  const pageResult = await resolveMetaPageAccessToken({
    userAccessToken: accessToken,
    graphApiVersion,
    preferredPageId: preferredPageId || undefined,
  });
  if (!pageResult.ok) {
    return { metrics: emptyProviderMetrics(), mode: 'ERROR', message: pageResult.error || 'Instagram連携情報を取得できません。' };
  }

  const instagramUserId = readString(params.context.config, ['instagram_user_id', 'ig_user_id']) || pageResult.instagramUserId || '';
  if (!instagramUserId) {
    return { metrics: emptyProviderMetrics(), mode: 'ERROR', message: 'InstagramユーザーIDが未設定です。' };
  }

  const token = pageResult.pageAccessToken || accessToken;
  const mediaEndpoint =
    `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(instagramUserId)}/media` +
    `?fields=${encodeURIComponent('id,timestamp,like_count,comments_count')}&limit=100&since=${sinceUnix}&until=${untilUnix}`;
  const mediaResponse = await fetchJson(mediaEndpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!mediaResponse.ok || !mediaResponse.body || typeof mediaResponse.body !== 'object') {
    return {
      metrics: emptyProviderMetrics(),
      mode: 'ERROR',
      message: extractHttpErrorText(mediaResponse, 'Instagram投稿の取得に失敗しました。'),
    };
  }

  const mediaRows = Array.isArray((mediaResponse.body as Record<string, unknown>).data)
    ? ((mediaResponse.body as Record<string, unknown>).data as unknown[])
    : [];
  const posts = mediaRows.length;
  let comments = 0;
  let likes = 0;
  for (const row of mediaRows) {
    if (!row || typeof row !== 'object') continue;
    const typed = row as Record<string, unknown>;
    comments += Number(typed.comments_count || 0);
    likes += Number(typed.like_count || 0);
  }

  const insightsEndpoint =
    `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(instagramUserId)}/insights` +
    `?metric=impressions,profile_views&period=day&since=${sinceUnix}&until=${untilUnix}`;
  const insightsResponse = await fetchJson(insightsEndpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const impressions = insightsResponse.ok
    ? extractInsightsMetricTotal(insightsResponse.body, 'impressions')
    : null;
  const profileViews = insightsResponse.ok
    ? extractInsightsMetricTotal(insightsResponse.body, 'profile_views')
    : null;

  const hasMetric = posts > 0 || comments > 0 || likes > 0 || (impressions || 0) > 0 || (profileViews || 0) > 0;
  return {
    mode: hasMetric ? 'REAL' : 'NO_DATA',
    metrics: {
      ...emptyProviderMetrics(),
      impressions,
      profileViews,
      posts,
      comments,
      likes,
    },
  };
};

const sumNullable = (...values: Array<number | null | undefined>): number | null => {
  const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (numbers.length === 0) return null;
  return numbers.reduce((sum, value) => sum + value, 0);
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
  const { startIso } = buildDateRange(range);

  const access = await ensureStoreAccess({
    supabaseAdmin,
    userId: auth.userId,
    storeId,
  });
  if (!access.ok || !access.orgId) {
    return jsonResponse(403, { error: access.error || 'Not allowed' });
  }

  const [
    gbpContextResult,
    facebookContextResult,
    instagramContextResult,
    publishedPostQuery,
    publishLogQuery,
    inboxQuery,
  ] = await Promise.all([
    resolveProviderContext({
      supabaseAdmin,
      storeId,
      orgId: access.orgId,
      provider: 'GBP',
      encryptionKey,
    }),
    resolveProviderContext({
      supabaseAdmin,
      storeId,
      orgId: access.orgId,
      provider: 'FACEBOOK',
      encryptionKey,
    }),
    resolveProviderContext({
      supabaseAdmin,
      storeId,
      orgId: access.orgId,
      provider: 'INSTAGRAM',
      encryptionKey,
    }),
    supabaseAdmin
      .from('posts')
      .select('id, status, content, published_at')
      .eq('store_id', storeId)
      .eq('status', 'PUBLISHED')
      .gte('published_at', startIso)
      .not('content', 'ilike', '[AUDIT]%'),
    supabaseAdmin
      .from('post_publish_logs')
      .select('provider, created_at, status')
      .eq('store_id', storeId)
      .eq('status', 'SUCCESS')
      .gte('created_at', startIso),
    supabaseAdmin
      .from('inbox_messages')
      .select('id, provider, received_at, is_replied')
      .eq('store_id', storeId)
      .gte('received_at', startIso),
  ]);

  const publishedPostRows = Array.isArray(publishedPostQuery.data)
    ? (publishedPostQuery.data as Array<Record<string, unknown>>)
    : [];
  const publishLogRows = Array.isArray(publishLogQuery.data)
    ? (publishLogQuery.data as Array<Record<string, unknown>>)
    : [];
  const inboxRows = Array.isArray(inboxQuery.data) ? (inboxQuery.data as Array<Record<string, unknown>>) : [];

  const teppenPublishedCount = publishedPostRows.length;
  const totalInboxCount = inboxRows.length;
  const unrepliedCount = inboxRows.filter((row) => !row.is_replied).length;

  const providerPublishedCounts: Record<ProviderKey, number> = {
    GBP: 0,
    FACEBOOK: 0,
    INSTAGRAM: 0,
  };
  const providerInboxCounts: Record<ProviderKey, number> = {
    GBP: 0,
    FACEBOOK: 0,
    INSTAGRAM: 0,
  };

  const detailedSeries = buildEmptyDetailedActivitySeries(range);
  const detailedMap = new Map(detailedSeries.map((row) => [row.date, row]));

  for (const row of publishLogRows) {
    const provider = normalizeProviderKey(row.provider);
    const createdAt = typeof row.created_at === 'string' ? row.created_at : '';
    if (!provider || !createdAt) continue;
    providerPublishedCounts[provider] += 1;
    const key = formatYmd(new Date(createdAt));
    const point = detailedMap.get(key);
    if (!point) continue;
    point.totalPosts += 1;
    if (provider === 'GBP') point.gbpPosts += 1;
    if (provider === 'FACEBOOK') point.facebookPosts += 1;
    if (provider === 'INSTAGRAM') point.instagramPosts += 1;
  }

  for (const row of inboxRows) {
    const provider = normalizeProviderKey(row.provider);
    if (!provider) continue;
    providerInboxCounts[provider] += 1;
    const receivedAt = typeof row.received_at === 'string' ? row.received_at : '';
    if (!receivedAt) continue;
    const key = formatYmd(new Date(receivedAt));
    const point = detailedMap.get(key);
    if (!point) continue;
    point.totalMessages += 1;
    if (provider === 'GBP') point.gbpMessages += 1;
    if (provider === 'FACEBOOK') point.facebookMessages += 1;
    if (provider === 'INSTAGRAM') point.instagramMessages += 1;
  }

  const activitySeries = detailedSeries.map((row) => ({
    date: row.date,
    posts: row.totalPosts,
    messages: row.totalMessages,
  }));

  let gbpSummary: ProviderSummary = toProviderSummary({
    provider: 'GBP',
    connected: Boolean(gbpContextResult.context),
    mode: gbpContextResult.context ? 'NO_DATA' : 'DISCONNECTED',
    message: gbpContextResult.reason,
  });
  let facebookSummary: ProviderSummary = toProviderSummary({
    provider: 'FACEBOOK',
    connected: Boolean(facebookContextResult.context),
    mode: facebookContextResult.context ? 'NO_DATA' : 'DISCONNECTED',
    message: facebookContextResult.reason,
  });
  let instagramSummary: ProviderSummary = toProviderSummary({
    provider: 'INSTAGRAM',
    connected: Boolean(instagramContextResult.context),
    mode: instagramContextResult.context ? 'NO_DATA' : 'DISCONNECTED',
    message: instagramContextResult.reason,
  });

  if (gbpContextResult.context) {
    const performance = await fetchGbpPerformance({
      supabaseAdmin,
      context: gbpContextResult.context,
      encryptionKey,
      range,
    });
    if (performance.mode === 'FALLBACK') {
      gbpSummary = toProviderSummary({
        provider: 'GBP',
        connected: true,
        mode: 'ERROR',
        message: performance.warning || 'GBP指標の取得に失敗しました。',
        metrics: {
          comments: providerInboxCounts.GBP,
        },
      });
    } else {
      const gbpPosts = await fetchGbpPostCount({
        context: gbpContextResult.context,
        performanceResult: performance,
        range,
      });
      for (const point of performance.series) {
        const target = detailedMap.get(point.date);
        if (!target) continue;
        target.gbpImpressions = Math.max(target.gbpImpressions, Math.round(point.views || 0));
      }
      const normalizedGbpPosts = Math.max(gbpPosts, providerPublishedCounts.GBP);
      const hasMetric = performance.kpis.views > 0 || normalizedGbpPosts > 0 || providerInboxCounts.GBP > 0;
      gbpSummary = toProviderSummary({
        provider: 'GBP',
        connected: true,
        mode: hasMetric ? 'REAL' : 'NO_DATA',
        metrics: {
          impressions: performance.kpis.views,
          posts: normalizedGbpPosts,
          comments: providerInboxCounts.GBP,
          phoneClicks: performance.kpis.phone,
          websiteClicks: performance.kpis.website,
          routeSearches: performance.kpis.route,
        },
      });
    }
  }

  if (facebookContextResult.context) {
    const result = await fetchFacebookMetrics({
      context: facebookContextResult.context,
      encryptionKey,
      range,
    });
    const normalizedPosts = Math.max(result.metrics.posts, providerPublishedCounts.FACEBOOK);
    const normalizedMode = result.mode === 'NO_DATA' && normalizedPosts > 0 ? 'REAL' : result.mode;
    facebookSummary = toProviderSummary({
      provider: 'FACEBOOK',
      connected: true,
      mode: normalizedMode,
      message: result.message,
      metrics: {
        ...result.metrics,
        posts: normalizedPosts,
        comments: Math.max(result.metrics.comments, providerInboxCounts.FACEBOOK),
      },
    });
  }

  if (instagramContextResult.context) {
    const result = await fetchInstagramMetrics({
      context: instagramContextResult.context,
      encryptionKey,
      range,
    });
    const normalizedPosts = Math.max(result.metrics.posts, providerPublishedCounts.INSTAGRAM);
    const normalizedMode = result.mode === 'NO_DATA' && normalizedPosts > 0 ? 'REAL' : result.mode;
    instagramSummary = toProviderSummary({
      provider: 'INSTAGRAM',
      connected: true,
      mode: normalizedMode,
      message: result.message,
      metrics: {
        ...result.metrics,
        posts: normalizedPosts,
        comments: Math.max(result.metrics.comments, providerInboxCounts.INSTAGRAM),
      },
    });
  }

  const providerErrors = [gbpSummary, facebookSummary, instagramSummary]
    .filter((summary) => summary.mode === 'ERROR' && summary.message)
    .map((summary) => ({
      provider: summary.provider,
      message: summary.message as string,
    }));

  const overview = {
    impressions: sumNullable(
      toNumberOrNull(gbpSummary.metrics.impressions),
      toNumberOrNull(facebookSummary.metrics.impressions),
      toNumberOrNull(instagramSummary.metrics.impressions),
    ),
    profileViews: sumNullable(
      toNumberOrNull(gbpSummary.metrics.profileViews),
      toNumberOrNull(facebookSummary.metrics.profileViews),
      toNumberOrNull(instagramSummary.metrics.profileViews),
    ),
    postCount:
      Number(gbpSummary.metrics.posts || 0) +
      Number(facebookSummary.metrics.posts || 0) +
      Number(instagramSummary.metrics.posts || 0),
    commentCount:
      Number(gbpSummary.metrics.comments || 0) +
      Number(facebookSummary.metrics.comments || 0) +
      Number(instagramSummary.metrics.comments || 0),
    likeCount:
      Number(gbpSummary.metrics.likes || 0) +
      Number(facebookSummary.metrics.likes || 0) +
      Number(instagramSummary.metrics.likes || 0),
    inboxCount: totalInboxCount,
    unrepliedCount,
    teppenPublishedCount,
  };

  return jsonResponse(200, {
    ok: true,
    storeId,
    range,
    overview,
    providers: {
      GBP: gbpSummary,
      FACEBOOK: facebookSummary,
      INSTAGRAM: instagramSummary,
    },
    timeseries: activitySeries,
    timeseriesDetailed: detailedSeries,
    dataSource: {
      hasErrors: providerErrors.length > 0,
      errors: providerErrors,
    },
  });
});
