import { getFunctionErrorMessage, invokeFunctionByHttp } from './functionHttpClient';

export type DashboardMetricRange = '7days' | '30days';

export type DashboardMetricPoint = {
  date: string;
  posts: number;
  messages: number;
};

export type DashboardMetricDetailedPoint = {
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

export type DashboardProviderMode = 'REAL' | 'NO_DATA' | 'DISCONNECTED' | 'ERROR';

export type DashboardProviderMetrics = {
  impressions: number | null;
  profileViews: number | null;
  posts: number;
  comments: number;
  likes: number;
  phoneClicks: number | null;
  websiteClicks: number | null;
  routeSearches: number | null;
};

export type DashboardProviderSummary = {
  provider: 'GBP' | 'FACEBOOK' | 'INSTAGRAM';
  label: string;
  connected: boolean;
  mode: DashboardProviderMode;
  message?: string;
  metrics: DashboardProviderMetrics;
};

export type DashboardMetricsResult = {
  overview: {
    impressions: number | null;
    profileViews: number | null;
    postCount: number;
    commentCount: number;
    likeCount: number;
    inboxCount: number;
    unrepliedCount: number;
    teppenPublishedCount: number;
  };
  providers: {
    GBP: DashboardProviderSummary;
    FACEBOOK: DashboardProviderSummary;
    INSTAGRAM: DashboardProviderSummary;
  };
  timeseries: DashboardMetricPoint[];
  timeseriesDetailed: DashboardMetricDetailedPoint[];
  dataSource: {
    hasErrors: boolean;
    errors: Array<{ provider: string; message: string }>;
  };
};

const parseNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseProviderSummary = (value: unknown, provider: 'GBP' | 'FACEBOOK' | 'INSTAGRAM'): DashboardProviderSummary => {
  const typed = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const metricsObject = typed.metrics && typeof typed.metrics === 'object'
    ? (typed.metrics as Record<string, unknown>)
    : {};
  return {
    provider,
    label: typeof typed.label === 'string' && typed.label.trim() ? typed.label.trim() : provider,
    connected: Boolean(typed.connected),
    mode: (
      typed.mode === 'REAL' ||
      typed.mode === 'NO_DATA' ||
      typed.mode === 'DISCONNECTED' ||
      typed.mode === 'ERROR'
    ) ? typed.mode : 'NO_DATA',
    message: typeof typed.message === 'string' && typed.message.trim() ? typed.message.trim() : undefined,
    metrics: {
      impressions: parseNullableNumber(metricsObject.impressions),
      profileViews: parseNullableNumber(metricsObject.profileViews),
      posts: Number(metricsObject.posts || 0),
      comments: Number(metricsObject.comments || 0),
      likes: Number(metricsObject.likes || 0),
      phoneClicks: parseNullableNumber(metricsObject.phoneClicks),
      websiteClicks: parseNullableNumber(metricsObject.websiteClicks),
      routeSearches: parseNullableNumber(metricsObject.routeSearches),
    },
  };
};

export const dashboardMetricsService = {
  async fetch(params: { storeId: string; range: DashboardMetricRange }): Promise<DashboardMetricsResult> {
    const result = await invokeFunctionByHttp('dashboard-metrics', {
      storeId: params.storeId,
      range: params.range,
    });

    if (!result.ok) {
      throw new Error(getFunctionErrorMessage(result, 'ダッシュボード指標の取得に失敗しました。'));
    }

    const body = result.body && typeof result.body === 'object' ? (result.body as Record<string, unknown>) : {};

    const overviewObject = body.overview && typeof body.overview === 'object'
      ? (body.overview as Record<string, unknown>)
      : {};
    const providersObject = body.providers && typeof body.providers === 'object'
      ? (body.providers as Record<string, unknown>)
      : {};
    const sourceObject = body.dataSource && typeof body.dataSource === 'object' ? (body.dataSource as Record<string, unknown>) : {};

    const timeseries = Array.isArray(body.timeseries)
      ? body.timeseries
        .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>) : null))
        .filter((row): row is Record<string, unknown> => Boolean(row))
        .map((row) => ({
          date: typeof row.date === 'string' ? row.date : '',
          posts: Number(row.posts || 0),
          messages: Number(row.messages || 0),
        }))
        .filter((row) => row.date.length > 0)
      : [];

    const timeseriesDetailed = Array.isArray(body.timeseriesDetailed)
      ? body.timeseriesDetailed
        .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>) : null))
        .filter((row): row is Record<string, unknown> => Boolean(row))
        .map((row) => ({
          date: typeof row.date === 'string' ? row.date : '',
          totalPosts: Number(row.totalPosts || 0),
          totalMessages: Number(row.totalMessages || 0),
          gbpPosts: Number(row.gbpPosts || 0),
          facebookPosts: Number(row.facebookPosts || 0),
          instagramPosts: Number(row.instagramPosts || 0),
          gbpMessages: Number(row.gbpMessages || 0),
          facebookMessages: Number(row.facebookMessages || 0),
          instagramMessages: Number(row.instagramMessages || 0),
          gbpImpressions: Number(row.gbpImpressions || 0),
        }))
        .filter((row) => row.date.length > 0)
      : [];

    const errorRows = Array.isArray(sourceObject.errors) ? sourceObject.errors : [];

    return {
      overview: {
        impressions: parseNullableNumber(overviewObject.impressions),
        profileViews: parseNullableNumber(overviewObject.profileViews),
        postCount: Number(overviewObject.postCount || 0),
        commentCount: Number(overviewObject.commentCount || 0),
        likeCount: Number(overviewObject.likeCount || 0),
        inboxCount: Number(overviewObject.inboxCount || 0),
        unrepliedCount: Number(overviewObject.unrepliedCount || 0),
        teppenPublishedCount: Number(overviewObject.teppenPublishedCount || 0),
      },
      providers: {
        GBP: parseProviderSummary(providersObject.GBP, 'GBP'),
        FACEBOOK: parseProviderSummary(providersObject.FACEBOOK, 'FACEBOOK'),
        INSTAGRAM: parseProviderSummary(providersObject.INSTAGRAM, 'INSTAGRAM'),
      },
      timeseries,
      timeseriesDetailed,
      dataSource: {
        hasErrors: Boolean(sourceObject.hasErrors),
        errors: errorRows
          .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>) : null))
          .filter((row): row is Record<string, unknown> => Boolean(row))
          .map((row) => ({
            provider: typeof row.provider === 'string' ? row.provider : '',
            message: typeof row.message === 'string' ? row.message : '',
          }))
          .filter((row) => row.provider && row.message),
      },
    };
  },
};
