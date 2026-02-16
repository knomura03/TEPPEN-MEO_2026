import React, { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart2, MessageCircle, RefreshCw } from 'lucide-react';
import { useStore } from '../contexts/StoreContext';
import { isSupabaseConfigured } from '../services/supabaseClient';
import {
  DashboardMetricRange,
  DashboardMetricsResult,
  DashboardProviderSummary,
  dashboardMetricsService,
} from '../services/dashboardMetricsService';
import { useNotification } from '../contexts/NotificationContext';
import {
  PAGE_CARD_CLASS,
  PAGE_CARD_PADDED_CLASS,
  PAGE_CONTAINER_CLASS,
  PAGE_HEADER_DESCRIPTION_CLASS,
  PAGE_HEADER_TITLE_CLASS,
} from './ui/pageLayout';
import { SocialPlatformLogo } from './ui/SocialPlatformLogo';
import { formatViewLabel } from './ui/formatters';
import { COMMON_COPY } from './ui/copy';

interface DashboardProps {
  isDarkMode: boolean;
}

type DashboardChartPlatform = 'TOTAL' | 'GBP' | 'FACEBOOK' | 'INSTAGRAM';
type DashboardChartMetric = 'POSTS' | 'MESSAGES' | 'IMPRESSIONS';

const FALLBACK_RESULT: DashboardMetricsResult = {
  overview: {
    impressions: null,
    profileViews: null,
    postCount: 0,
    commentCount: 0,
    likeCount: 0,
    inboxCount: 0,
    unrepliedCount: 0,
    teppenPublishedCount: 0,
  },
  providers: {
    GBP: {
      provider: 'GBP',
      label: 'Googleビジネスプロフィール',
      connected: false,
      mode: 'DISCONNECTED',
      metrics: {
        impressions: null,
        profileViews: null,
        posts: 0,
        comments: 0,
        likes: 0,
        phoneClicks: null,
        websiteClicks: null,
        routeSearches: null,
      },
    },
    FACEBOOK: {
      provider: 'FACEBOOK',
      label: 'Facebook',
      connected: false,
      mode: 'DISCONNECTED',
      metrics: {
        impressions: null,
        profileViews: null,
        posts: 0,
        comments: 0,
        likes: 0,
        phoneClicks: null,
        websiteClicks: null,
        routeSearches: null,
      },
    },
    INSTAGRAM: {
      provider: 'INSTAGRAM',
      label: 'Instagram',
      connected: false,
      mode: 'DISCONNECTED',
      metrics: {
        impressions: null,
        profileViews: null,
        posts: 0,
        comments: 0,
        likes: 0,
        phoneClicks: null,
        websiteClicks: null,
        routeSearches: null,
      },
    },
  },
  timeseries: [],
  timeseriesDetailed: [],
  dataSource: {
    hasErrors: false,
    errors: [],
  },
};

const formatDateShortJa = (value: string): string => {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) return value;
  return `${month}/${day}`;
};

const formatMetric = (value: number | null | undefined, suffix = ''): string => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return `${Math.round(Number(value)).toLocaleString()}${suffix}`;
};

const modeLabelMap: Record<DashboardProviderSummary['mode'], string> = {
  REAL: '取得済み',
  NO_DATA: 'データなし',
  DISCONNECTED: '未接続',
  ERROR: '要確認',
};

const modeClassMap: Record<DashboardProviderSummary['mode'], string> = {
  REAL: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200',
  NO_DATA: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
  DISCONNECTED: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
  ERROR: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200',
};

const chartPlatformOptions: Array<{ key: DashboardChartPlatform; label: string }> = [
  { key: 'TOTAL', label: '全体' },
  { key: 'GBP', label: 'GBP' },
  { key: 'FACEBOOK', label: 'Facebook' },
  { key: 'INSTAGRAM', label: 'Instagram' },
];

const chartMetricOptions: Array<{ key: DashboardChartMetric; label: string }> = [
  { key: 'POSTS', label: '投稿数' },
  { key: 'MESSAGES', label: '受信数' },
  { key: 'IMPRESSIONS', label: 'インプレッション' },
];

const chartLineColors: Record<string, string> = {
  TOTAL_POSTS: '#2563eb',
  TOTAL_MESSAGES: '#059669',
  TOTAL_IMPRESSIONS: '#7c3aed',
  GBP_POSTS: '#1d4ed8',
  GBP_MESSAGES: '#0f766e',
  GBP_IMPRESSIONS: '#6d28d9',
  FACEBOOK_POSTS: '#1d4ed8',
  FACEBOOK_MESSAGES: '#0284c7',
  INSTAGRAM_POSTS: '#db2777',
  INSTAGRAM_MESSAGES: '#f59e0b',
};

export const Dashboard: React.FC<DashboardProps> = ({ isDarkMode }) => {
  const { activeStoreId, selectedStoreIds, stores } = useStore();
  const { addNotification } = useNotification();
  const [dateRange, setDateRange] = useState<DashboardMetricRange>('7days');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<DashboardMetricsResult>(FALLBACK_RESULT);
  const [selectedChartPlatforms, setSelectedChartPlatforms] = useState<DashboardChartPlatform[]>(['TOTAL', 'GBP', 'FACEBOOK', 'INSTAGRAM']);
  const [selectedChartMetrics, setSelectedChartMetrics] = useState<DashboardChartMetric[]>(['POSTS', 'MESSAGES']);
  const isMultiStoreSelected = selectedStoreIds.length > 1;

  const activeStoreName = useMemo(() => {
    if (!activeStoreId) return null;
    return stores.find((store) => store.id === activeStoreId)?.name || null;
  }, [activeStoreId, stores]);

  const loadMetrics = async () => {
    if (!isSupabaseConfigured || !activeStoreId) {
      setResult(FALLBACK_RESULT);
      return;
    }

    setIsLoading(true);
    try {
      const next = await dashboardMetricsService.fetch({ storeId: activeStoreId, range: dateRange });
      setResult(next);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'ダッシュボード指標の取得に失敗しました。';
      addNotification('ダッシュボード取得エラー', message, 'ERROR');
      setResult(FALLBACK_RESULT);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStoreId, dateRange, isSupabaseConfigured]);

  const colors = {
    bg: isDarkMode ? '#1f2937' : '#ffffff',
    text: isDarkMode ? '#f9fafb' : '#111827',
    grid: isDarkMode ? '#374151' : '#e5e7eb',
    muted: isDarkMode ? '#9ca3af' : '#6b7280',
  };

  const toggleChartPlatform = (platform: DashboardChartPlatform) => {
    setSelectedChartPlatforms((prev) => {
      if (prev.includes(platform)) {
        return prev.length === 1 ? prev : prev.filter((item) => item !== platform);
      }
      return [...prev, platform];
    });
  };

  const toggleChartMetric = (metric: DashboardChartMetric) => {
    setSelectedChartMetrics((prev) => {
      if (prev.includes(metric)) {
        return prev.length === 1 ? prev : prev.filter((item) => item !== metric);
      }
      return [...prev, metric];
    });
  };

  const detailedRows = useMemo(
    () =>
      result.timeseriesDetailed.length > 0
        ? result.timeseriesDetailed
        : result.timeseries.map((row) => ({
            date: row.date,
            totalPosts: row.posts,
            totalMessages: row.messages,
            gbpPosts: 0,
            facebookPosts: 0,
            instagramPosts: 0,
            gbpMessages: 0,
            facebookMessages: 0,
            instagramMessages: 0,
            gbpImpressions: 0,
          })),
    [result.timeseries, result.timeseriesDetailed]
  );

  const lineDefinitions = useMemo(() => {
    type Row = (typeof detailedRows)[number];
    const getValue = (row: Row, platform: DashboardChartPlatform, metric: DashboardChartMetric): number => {
      if (metric === 'POSTS') {
        if (platform === 'TOTAL') return row.totalPosts;
        if (platform === 'GBP') return row.gbpPosts;
        if (platform === 'FACEBOOK') return row.facebookPosts;
        return row.instagramPosts;
      }
      if (metric === 'MESSAGES') {
        if (platform === 'TOTAL') return row.totalMessages;
        if (platform === 'GBP') return row.gbpMessages;
        if (platform === 'FACEBOOK') return row.facebookMessages;
        return row.instagramMessages;
      }
      if (platform === 'TOTAL' || platform === 'GBP') {
        return row.gbpImpressions;
      }
      return 0;
    };

    const metricLabel: Record<DashboardChartMetric, string> = {
      POSTS: '投稿数',
      MESSAGES: '受信数',
      IMPRESSIONS: 'インプレッション',
    };
    const platformLabel: Record<DashboardChartPlatform, string> = {
      TOTAL: '全体',
      GBP: 'GBP',
      FACEBOOK: 'Facebook',
      INSTAGRAM: 'Instagram',
    };

    return selectedChartPlatforms.flatMap((platform) =>
      selectedChartMetrics
        .filter((metric) => metric !== 'IMPRESSIONS' || platform === 'TOTAL' || platform === 'GBP')
        .map((metric) => {
          const key = `${platform}_${metric}`;
          return {
            key,
            label: `${platformLabel[platform]} ${metricLabel[metric]}`,
            color: chartLineColors[key] || '#2563eb',
            valueGetter: (row: Row) => getValue(row, platform, metric),
          };
        })
    );
  }, [detailedRows, selectedChartMetrics, selectedChartPlatforms]);

  const lineData = useMemo(
    () =>
      detailedRows.map((row) => {
        const next: Record<string, string | number> = {
          date: row.date,
          dateLabel: formatDateShortJa(row.date),
        };
        lineDefinitions.forEach((line) => {
          next[line.key] = line.valueGetter(row);
        });
        return next;
      }),
    [detailedRows, lineDefinitions]
  );

  const hasLineData = useMemo(
    () =>
      lineDefinitions.some((line) =>
        lineData.some((row) => Number((row as Record<string, unknown>)[line.key] || 0) > 0)
      ),
    [lineData, lineDefinitions]
  );

  const overviewCards = [
    { key: 'impressions', label: '総インプレッション', value: formatMetric(result.overview.impressions) },
    { key: 'profileViews', label: '総プロフィール閲覧', value: formatMetric(result.overview.profileViews) },
    { key: 'postCount', label: '総投稿数', value: formatMetric(result.overview.postCount) },
    { key: 'commentCount', label: '総コメント数', value: formatMetric(result.overview.commentCount) },
    { key: 'likeCount', label: '総いいね数', value: formatMetric(result.overview.likeCount) },
  ];

  const providerCards: DashboardProviderSummary[] = [
    result.providers.GBP,
    result.providers.FACEBOOK,
    result.providers.INSTAGRAM,
  ];

  return (
    <div className={`${PAGE_CONTAINER_CLASS} lg:space-y-8`}>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className={PAGE_HEADER_TITLE_CLASS}>{formatViewLabel('DASHBOARD')}</h1>
          <p className={PAGE_HEADER_DESCRIPTION_CLASS}>選択中の店舗の主要指標をSNSごとに表示します。</p>
          {activeStoreName ? <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">店舗: {activeStoreName}</p> : null}
        </div>

        <div className="flex items-center gap-2 bg-white dark:bg-gray-800 p-1.5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <button
            type="button"
            onClick={() => setDateRange('7days')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${dateRange === '7days' ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50'}`}
          >
            過去7日間
          </button>
          <button
            type="button"
            onClick={() => setDateRange('30days')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${dateRange === '30days' ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50'}`}
          >
            過去30日間
          </button>
          <button
            type="button"
            onClick={loadMetrics}
            className="p-2 ml-1 text-gray-500 hover:text-gray-800 dark:hover:text-white disabled:opacity-50"
            disabled={isLoading}
            aria-label="更新"
            title="更新"
          >
            <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        {overviewCards.map((item) => (
          <div key={item.key} className={`${PAGE_CARD_PADDED_CLASS} transition-all`}>
            <div className="flex items-center justify-between mb-2">
              <div className="p-2 rounded-xl bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-300">
                <BarChart2 size={16} />
              </div>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mb-1">{item.value}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">{item.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {providerCards.map((provider) => (
          <div key={provider.provider} className={PAGE_CARD_PADDED_CLASS}>
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white inline-flex items-center gap-2">
                <SocialPlatformLogo platform={provider.provider} size={16} />
                {provider.label}
              </h2>
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${modeClassMap[provider.mode]}`}>
                {modeLabelMap[provider.mode]}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2.5">
                <p className="text-gray-500 dark:text-gray-400 text-xs">インプレッション</p>
                <p className="font-semibold text-gray-900 dark:text-white">{formatMetric(provider.metrics.impressions)}</p>
              </div>
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2.5">
                <p className="text-gray-500 dark:text-gray-400 text-xs">プロフィール閲覧</p>
                <p className="font-semibold text-gray-900 dark:text-white">{formatMetric(provider.metrics.profileViews)}</p>
              </div>
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2.5">
                <p className="text-gray-500 dark:text-gray-400 text-xs">投稿数</p>
                <p className="font-semibold text-gray-900 dark:text-white">{formatMetric(provider.metrics.posts)}</p>
              </div>
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2.5">
                <p className="text-gray-500 dark:text-gray-400 text-xs">コメント数</p>
                <p className="font-semibold text-gray-900 dark:text-white">{formatMetric(provider.metrics.comments)}</p>
              </div>
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2.5">
                <p className="text-gray-500 dark:text-gray-400 text-xs">いいね数</p>
                <p className="font-semibold text-gray-900 dark:text-white">{formatMetric(provider.metrics.likes)}</p>
              </div>
              {provider.provider === 'GBP' ? (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2.5">
                  <p className="text-gray-500 dark:text-gray-400 text-xs">電話/WEB/経路</p>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {formatMetric(provider.metrics.phoneClicks)} / {formatMetric(provider.metrics.websiteClicks)} / {formatMetric(provider.metrics.routeSearches)}
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2.5">
                  <p className="text-gray-500 dark:text-gray-400 text-xs">連携状態</p>
                  <p className="font-semibold text-gray-900 dark:text-white">{provider.connected ? '接続済み' : '未接続'}</p>
                </div>
              )}
            </div>
            {provider.message ? (
              <p className="mt-3 text-xs text-rose-700 dark:text-rose-300">{provider.message}</p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={`${PAGE_CARD_PADDED_CLASS} lg:col-span-2`}>
          <div className="flex flex-col gap-3 mb-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-gray-800 dark:text-white">指標推移グラフ</h2>
              <div className="text-xs text-gray-500 dark:text-gray-400">期間: {dateRange === '7days' ? '7日' : '30日'}</div>
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">プラットフォーム:</span>
                {chartPlatformOptions.map((option) => {
                  const selected = selectedChartPlatforms.includes(option.key);
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => toggleChartPlatform(option.key)}
                      className={`px-2.5 py-1 text-xs rounded-full border ${selected ? 'border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-700 dark:bg-primary-900/30 dark:text-primary-200' : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300'}`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">指標:</span>
                {chartMetricOptions.map((option) => {
                  const selected = selectedChartMetrics.includes(option.key);
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => toggleChartMetric(option.key)}
                      className={`px-2.5 py-1 text-xs rounded-full border ${selected ? 'border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-700 dark:bg-primary-900/30 dark:text-primary-200' : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300'}`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          {hasLineData ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={lineData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} />
                  <XAxis
                    dataKey="dateLabel"
                    stroke={colors.muted}
                    tickLine={false}
                    axisLine={false}
                    dy={8}
                    minTickGap={8}
                  />
                  <YAxis stroke={colors.muted} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: colors.bg, borderColor: colors.grid, borderRadius: '12px', color: colors.text }}
                  />
                  {lineDefinitions.map((line) => (
                    <Line
                      key={line.key}
                      type="monotone"
                      dataKey={line.key}
                      stroke={line.color}
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 4 }}
                      name={line.label}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className={`${PAGE_CARD_CLASS} p-6 text-sm text-gray-500 dark:text-gray-400`}>
              この期間の投稿・受信データはありません。
            </div>
          )}
          <div className="grid grid-cols-3 mt-4 gap-3 text-sm">
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-900/40">
              <p className="text-gray-500 dark:text-gray-400">公開投稿数（TEPPEN経由）</p>
              <p className="text-lg font-bold text-gray-800 dark:text-white">{result.overview.teppenPublishedCount.toLocaleString()}件</p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-900/40">
              <p className="text-gray-500 dark:text-gray-400">受信メッセージ</p>
              <p className="text-lg font-bold text-gray-800 dark:text-white">{result.overview.inboxCount.toLocaleString()}件</p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-900/40">
              <p className="text-gray-500 dark:text-gray-400">未返信</p>
              <p className="text-lg font-bold text-gray-800 dark:text-white">{result.overview.unrepliedCount.toLocaleString()}件</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">※ 監査用の `[AUDIT]` 投稿は集計から除外しています。</p>
        </div>

        <div className={PAGE_CARD_PADDED_CLASS}>
          <h2 className="text-lg font-bold text-gray-800 dark:text-white mb-3">データ取得メモ</h2>
          <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
            <p>・開設直後のSNSアカウントは、0件や「-」表示が出る場合があります。</p>
            <p>・0件は正常値として扱い、連携エラー表示にはしません。</p>
            <p>・取得不可の指標のみ、各SNSカードに「要確認」として表示します。</p>
          </div>
          {result.dataSource.hasErrors ? (
            <div className="mt-4 rounded-lg border border-rose-300 dark:border-rose-800/80 bg-rose-50 dark:bg-rose-900/30 p-3 text-xs text-rose-800 dark:text-rose-100 space-y-1">
              {result.dataSource.errors.map((error, index) => (
                <p key={`${error.provider}-${index}`}>[{error.provider}] {error.message}</p>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-900/20 p-3 text-xs text-emerald-800 dark:text-emerald-200">
              連携エラーは検出されていません。
            </div>
          )}
          <div className="mt-6 rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-900/40">
            <p className="text-sm font-semibold text-gray-800 dark:text-white inline-flex items-center gap-2">
              <MessageCircle size={14} />
              返信運用
            </p>
            <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">
              受信箱の未返信件数はこの期間のレビュー/コメントから集計しています。
            </p>
          </div>
        </div>
      </div>

      {!activeStoreId ? (
        <div className="text-sm text-amber-700 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-800 rounded-xl p-3">
          {isMultiStoreSelected ? COMMON_COPY.multiStoreSnsDisabled : '店舗が選択されていません。最初に店舗を選択してください。'}
        </div>
      ) : null}
    </div>
  );
};
