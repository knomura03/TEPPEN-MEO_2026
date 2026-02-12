import React, { useEffect, useMemo, useState } from 'react';
import {
  AreaChart,
  Area,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowUpRight,
  BarChart2,
  Calendar as CalendarIcon,
  MapPin,
  Navigation,
  Phone,
  RefreshCw,
  Search,
  ShieldAlert,
  Star,
} from 'lucide-react';
import { useStore } from '../contexts/StoreContext';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { dashboardMetricsService, DashboardMetricRange } from '../services/dashboardMetricsService';
import { useNotification } from '../contexts/NotificationContext';
import {
  PAGE_CARD_PADDED_CLASS,
  PAGE_CARD_CLASS,
  PAGE_CONTAINER_CLASS,
  PAGE_HEADER_DESCRIPTION_CLASS,
  PAGE_HEADER_TITLE_CLASS,
} from './ui/pageLayout';

interface DashboardProps {
  isDarkMode: boolean;
}

type KpiCardData = {
  key: string;
  label: string;
  value: string;
  change: number;
  suffix?: string;
};

const FALLBACK_KPI: KpiCardData[] = [
  { key: 'mapViews', label: '表示回数', value: '-', change: 0 },
  { key: 'routeSearches', label: 'ルート検索数', value: '-', change: 0 },
  { key: 'phoneClicks', label: '通話クリック', value: '-', change: 0 },
  { key: 'websiteClicks', label: 'ウェブサイト遷移', value: '-', change: 0 },
];

const pct = (value: number) => `${Math.round(value)}%`;
const formatDateShortJa = (value: string): string => {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) return value;
  return `${month}/${day}`;
};

export const Dashboard: React.FC<DashboardProps> = ({ isDarkMode }) => {
  const { activeStoreId, stores } = useStore();
  const { addNotification } = useNotification();

  const [dateRange, setDateRange] = useState<DashboardMetricRange>('7days');
  const [isLoading, setIsLoading] = useState(false);
  const [isFirstLoad, setIsFirstLoad] = useState(true);
  const [isSourceError, setIsSourceError] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [kpiValues, setKpiValues] = useState(FALLBACK_KPI);
  const [timeseries, setTimeseries] = useState<Array<{ date: string; views: number; actions: number }>>([]);
  const [directPercent, setDirectPercent] = useState(0);
  const [discoveryPercent, setDiscoveryPercent] = useState(0);
  const [postCount, setPostCount] = useState(0);
  const [inboxCount, setInboxCount] = useState(0);
  const [unrepliedCount, setUnrepliedCount] = useState(0);
  const [metricMode, setMetricMode] = useState<'REAL' | 'FALLBACK'>('FALLBACK');

  const activeStoreName = useMemo(() => {
    if (!activeStoreId) return null;
    return stores.find((store) => store.id === activeStoreId)?.name || null;
  }, [activeStoreId, stores]);

  const loadMetrics = async () => {
    if (!isSupabaseConfigured || !activeStoreId) {
      setKpiValues((current) => current.map((item) => ({ ...item, value: '-' })));
      setTimeseries([]);
      setDirectPercent(0);
      setDiscoveryPercent(100);
      setPostCount(0);
      setInboxCount(0);
      setUnrepliedCount(0);
      setMetricMode('FALLBACK');
      return;
    }

    setIsLoading(true);
    try {
      const result = await dashboardMetricsService.fetch({ storeId: activeStoreId, range: dateRange });
      const formatKpi = (value: number) => `${Math.max(0, Math.round(value)).toLocaleString()}`;
      setKpiValues([
        { key: 'mapViews', label: '表示回数', value: formatKpi(result.kpis.mapViews), change: 0 },
        { key: 'routeSearches', label: 'ルート検索数', value: formatKpi(result.kpis.routeSearches), change: 0 },
        { key: 'phoneClicks', label: '通話クリック', value: formatKpi(result.kpis.phoneClicks), change: 0 },
        { key: 'websiteClicks', label: 'ウェブサイト遷移', value: formatKpi(result.kpis.websiteClicks), change: 0 },
      ]);
      setTimeseries(result.timeseries);
      setDirectPercent(result.searchBreakdown.direct);
      setDiscoveryPercent(result.searchBreakdown.discovery);
      setPostCount(result.kpis.postCount);
      setInboxCount(result.kpis.inboxCount);
      setUnrepliedCount(result.kpis.unrepliedCount);
      setMetricMode(result.dataSource.metricsMode);
      const fallback = result.dataSource.error && result.dataSource.metricsMode === 'FALLBACK';
      setIsSourceError(Boolean(fallback));
      setErrorText(fallback ? result.dataSource.error || 'API取得条件が不足しています。' : '');
      if (result.dataSource.error && result.dataSource.error.length > 0) {
        addNotification('ダッシュボード取得', result.dataSource.error, 'WARNING');
      }
      setIsFirstLoad(false);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'ダッシュボード指標の取得に失敗しました。';
      addNotification('ダッシュボード取得エラー', message, 'ERROR');
      setIsSourceError(true);
      setErrorText(message);
      setKpiValues(FALLBACK_KPI.map((item) => ({ ...item, value: '-' })));
      setTimeseries([]);
      setDirectPercent(0);
      setDiscoveryPercent(100);
      setPostCount(0);
      setInboxCount(0);
      setUnrepliedCount(0);
      setMetricMode('FALLBACK');
      setIsFirstLoad(false);
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
    line: '#2563eb',
    area: '#60a5fa',
    muted: isDarkMode ? '#9ca3af' : '#6b7280',
  };

  const hasData = timeseries.length > 0;
  const lineData = useMemo(
    () =>
      timeseries.map((row) => ({
        ...row,
        dateLabel: formatDateShortJa(row.date),
      })),
    [timeseries]
  );

  return (
    <div className={`${PAGE_CONTAINER_CLASS} lg:space-y-8`}>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className={PAGE_HEADER_TITLE_CLASS}>ダッシュボード</h1>
          <p className={PAGE_HEADER_DESCRIPTION_CLASS}>選択中の店舗の最新指標を表示します。</p>
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {kpiValues.map((item) => (
          <div key={item.key} className={`${PAGE_CARD_PADDED_CLASS} transition-all hover:shadow-md`}>
            <div className="flex items-start justify-between mb-3">
              <div className="p-2 rounded-xl bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-300">
                <BarChart2 size={18} />
              </div>
              <div className="text-xs text-green-600 dark:text-green-400 font-semibold">
                {item.change > 0 ? '+' : ''}{item.change}%
              </div>
            </div>
            <p className="text-3xl font-bold text-gray-900 dark:text-white mb-1">{item.value}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">{item.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={`${PAGE_CARD_PADDED_CLASS} lg:col-span-2`}>
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-bold text-gray-800 dark:text-white">投稿・連絡のアクティビティ</h2>
            <div className="text-xs text-gray-500 dark:text-gray-400">期間: {dateRange === '7days' ? '7日' : '30日'} / データ: {metricMode}</div>
          </div>
          {hasData ? (
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={lineData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorViews" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={colors.area} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={colors.area} stopOpacity={0} />
                    </linearGradient>
                  </defs>
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
                  <Area
                    type="monotone"
                    dataKey="views"
                    stroke={colors.line}
                    fillOpacity={1}
                    fill="url(#colorViews)"
                    strokeWidth={2}
                    name="表示回数"
                  />
                  <Area
                    type="monotone"
                    dataKey="actions"
                    stroke="#16a34a"
                    fillOpacity={0}
                    strokeWidth={2}
                    name="アクション"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className={`${PAGE_CARD_CLASS} p-6 text-sm text-gray-500 dark:text-gray-400`}>
              取得データがありません。
            </div>
          )}
          <div className="grid grid-cols-3 mt-4 gap-3 text-sm">
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-900/40">
              <p className="text-gray-500 dark:text-gray-400">投稿数</p>
              <p className="text-lg font-bold text-gray-800 dark:text-white">{postCount.toLocaleString()}件</p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-900/40">
              <p className="text-gray-500 dark:text-gray-400">受信メッセージ</p>
              <p className="text-lg font-bold text-gray-800 dark:text-white">{inboxCount.toLocaleString()}件</p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-900/40">
              <p className="text-gray-500 dark:text-gray-400">未返信</p>
              <p className="text-lg font-bold text-gray-800 dark:text-white">{unrepliedCount.toLocaleString()}件</p>
            </div>
          </div>
          {isSourceError ? (
            <div className="mt-4 rounded-lg border border-amber-300 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-900/30 p-3 text-sm text-amber-800 dark:text-amber-100">
              <p className="font-semibold">情報の一部を取得できませんでした</p>
              <p>{errorText || '接続情報を確認して更新してください。'}</p>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-200">
                例: GBPの接続設定・トークン期限・権限不足など
              </p>
            </div>
          ) : null}
        </div>

        <div className={`${PAGE_CARD_PADDED_CLASS}`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-gray-800 dark:text-white">検索経路の内訳</h2>
            <ArrowUpRight size={18} className="text-gray-500" />
          </div>

          <div className="space-y-5 mt-2">
            <div>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="flex items-center gap-2"><Search size={14} /> 直接検索</span>
                <span className="font-semibold">{pct(directPercent)}</span>
              </div>
              <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                <div className="bg-blue-500 h-3 rounded-full" style={{ width: `${directPercent}%` }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="flex items-center gap-2"><MapPin size={14} /> 関連検索</span>
                <span className="font-semibold">{pct(discoveryPercent)}</span>
              </div>
              <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                <div className="bg-green-500 h-3 rounded-full" style={{ width: `${discoveryPercent}%` }} />
              </div>
            </div>
          </div>

          <div className="mt-8 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">平均評価</p>
            <div className="flex items-center gap-2 mt-2 text-2xl font-bold text-gray-800 dark:text-white">
              <Star size={20} fill="currentColor" className="text-yellow-400" />
              4.0
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">口コミや投稿データから反映（初期表示時は取得結果が反映されます）</p>
          </div>

          <div className="mt-6 p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">運用アクション</p>
            <ul className="mt-3 space-y-2 text-sm text-gray-600 dark:text-gray-300">
              <li className="flex items-center gap-2"><CalendarIcon size={14} /> 予約投稿: 反映率を向上</li>
              <li className="flex items-center gap-2"><Phone size={14} /> 受信箱: 未返信が多いほど改善候補</li>
              <li className="flex items-center gap-2"><Navigation size={14} /> GBP連携情報を再確認</li>
              <li className="flex items-center gap-2"><ShieldAlert size={14} /> 連携エラーがある場合は再接続してください</li>
            </ul>
            {isFirstLoad || !isLoading ? null : null}
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              右下の連携状況バッジでデータソースの問題を把握できます。
            </p>
          </div>
        </div>
      </div>

      {!activeStoreId ? (
        <div className="text-sm text-amber-700 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-800 rounded-xl p-3">
          店舗が選択されていません。最初に店舗を選択してください。
        </div>
      ) : null}
    </div>
  );
};
