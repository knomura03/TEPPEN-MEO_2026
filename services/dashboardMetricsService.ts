import { getFunctionErrorMessage, invokeFunctionByHttp } from './functionHttpClient';

export type DashboardMetricRange = '7days' | '30days';

export type DashboardMetricPoint = {
  date: string;
  views: number;
  actions: number;
};

export type DashboardMetricsResult = {
  kpis: {
    mapViews: number;
    routeSearches: number;
    phoneClicks: number;
    websiteClicks: number;
    actions: number;
    postCount: number;
    inboxCount: number;
    unrepliedCount: number;
  };
  searchBreakdown: {
    direct: number;
    discovery: number;
  };
  timeseries: DashboardMetricPoint[];
  dataSource: {
    gbpConnected: boolean;
    metricsMode: 'REAL' | 'FALLBACK';
    error?: string;
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

    const kpisObject = body.kpis && typeof body.kpis === 'object' ? (body.kpis as Record<string, unknown>) : {};
    const searchObject =
      body.searchBreakdown && typeof body.searchBreakdown === 'object'
        ? (body.searchBreakdown as Record<string, unknown>)
        : {};
    const sourceObject = body.dataSource && typeof body.dataSource === 'object' ? (body.dataSource as Record<string, unknown>) : {};

    const timeseries = Array.isArray(body.timeseries)
      ? body.timeseries
        .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>) : null))
        .filter((row): row is Record<string, unknown> => Boolean(row))
        .map((row) => ({
          date: typeof row.date === 'string' ? row.date : '',
          views: Number(row.views || 0),
          actions: Number(row.actions || 0),
        }))
        .filter((row) => row.date.length > 0)
      : [];

    return {
      kpis: {
        mapViews: Number(kpisObject.mapViews || 0),
        routeSearches: Number(kpisObject.routeSearches || 0),
        phoneClicks: Number(kpisObject.phoneClicks || 0),
        websiteClicks: Number(kpisObject.websiteClicks || 0),
        actions: Number(kpisObject.actions || 0),
        postCount: Number(kpisObject.postCount || 0),
        inboxCount: Number(kpisObject.inboxCount || 0),
        unrepliedCount: Number(kpisObject.unrepliedCount || 0),
      },
      searchBreakdown: {
        direct: Number(searchObject.direct || 0),
        discovery: Number(searchObject.discovery || 0),
      },
      timeseries,
      dataSource: {
        gbpConnected: Boolean(sourceObject.gbpConnected),
        metricsMode: sourceObject.metricsMode === 'REAL' ? 'REAL' : 'FALLBACK',
        error: typeof sourceObject.error === 'string' && sourceObject.error.trim() ? sourceObject.error : undefined,
      },
    };
  },
};
