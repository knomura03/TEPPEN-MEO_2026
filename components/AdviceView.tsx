import React, { useMemo, useState } from 'react';
import { Lightbulb, Loader2, RefreshCcw } from 'lucide-react';
import { User } from '../types';
import { useStore } from '../contexts/StoreContext';
import { useNotification } from '../contexts/NotificationContext';
import { strategyAdviceService, StrategyAdviceSnapshot } from '../services/strategyAdviceService';
import { getErrorMessage } from '../services/errorMessage';
import {
  PAGE_CARD_PADDED_CLASS,
  PAGE_CONTAINER_CLASS,
  PAGE_HEADER_DESCRIPTION_CLASS,
  PAGE_HEADER_TITLE_CLASS,
  PAGE_WARNING_CLASS,
} from './ui/pageLayout';
import { formatViewLabel } from './ui/formatters';

interface AdviceViewProps {
  currentUser: User;
}

const formatNumber = (value?: number): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return value.toLocaleString();
};

const formatRate = (value?: number): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${value.toFixed(1)}%`;
};

const formatHours = (value?: number): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${value.toFixed(1)}時間`;
};

const formatDateTime = (date?: Date): string => {
  if (!date) return '-';
  return date.toLocaleString('ja-JP');
};

export const AdviceView: React.FC<AdviceViewProps> = () => {
  const { stores, activeStoreId } = useStore();
  const { addNotification } = useNotification();

  const [isRunning, setIsRunning] = useState(false);
  const [snapshot, setSnapshot] = useState<StrategyAdviceSnapshot | null>(null);
  const [reportText, setReportText] = useState('');
  const [usedAi, setUsedAi] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<Date | null>(null);

  const activeStore = useMemo(() => {
    if (!activeStoreId) return null;
    return stores.find((store) => store.id === activeStoreId) || null;
  }, [activeStoreId, stores]);

  const handleRun = async () => {
    if (!activeStore) {
      addNotification('店舗未選択', '右上の店舗セレクタで店舗を選択してください。', 'WARNING');
      return;
    }

    setIsRunning(true);
    try {
      const result = await strategyAdviceService.run({
        storeId: activeStore.id,
        storeName: activeStore.name,
        industry: activeStore.category,
        areaHint: activeStore.address,
      });
      setSnapshot(result.snapshot);
      setReportText(result.reportText);
      setUsedAi(result.usedAi);
      setLastRunAt(new Date());
      addNotification('分析完了', '集客アドバイスを更新しました。', 'SUCCESS');
    } catch (error) {
      const message = getErrorMessage(error) || '分析に失敗しました。時間をおいて再実行してください。';
      addNotification('分析エラー', message, 'ERROR');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className={PAGE_CONTAINER_CLASS}>
      <section>
        <h1 className={PAGE_HEADER_TITLE_CLASS}>{formatViewLabel('ADVICE')}</h1>
        <p className={PAGE_HEADER_DESCRIPTION_CLASS}>
          この店舗の実績データから、MEO/SNS運用の優先アクションを提案します。分析はボタンを押した時だけ実行されます。
        </p>
      </section>

      {!activeStore && (
        <div className={PAGE_WARNING_CLASS}>
          店舗が選択されていません。右上の店舗セレクタから店舗を選ぶと分析できます。
        </div>
      )}

      <section id="advice-store-summary" className={PAGE_CARD_PADDED_CLASS}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-primary-600 dark:text-primary-400 font-bold">分析対象</p>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mt-1">{activeStore?.name || '未選択'}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              業種: {activeStore?.category || '未設定'} / エリア: {activeStore?.address || '未設定'}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">最終実行: {formatDateTime(lastRunAt || undefined)}</p>
          </div>
          <button
            id="advice-run-button"
            data-testid="advice-run-button"
            type="button"
            onClick={() => void handleRun()}
            disabled={!activeStore || isRunning}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isRunning ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
            {isRunning ? '分析中...' : '分析を実行'}
          </button>
        </div>
      </section>

      {snapshot && (
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <article className={PAGE_CARD_PADDED_CLASS}>
            <p className="text-xs text-gray-500 dark:text-gray-400">直近30日投稿数</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{formatNumber(snapshot.postCount30d)}件</p>
          </article>
          <article className={PAGE_CARD_PADDED_CLASS}>
            <p className="text-xs text-gray-500 dark:text-gray-400">未返信件数</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{formatNumber(snapshot.pendingReplyCount)}件</p>
          </article>
          <article className={PAGE_CARD_PADDED_CLASS}>
            <p className="text-xs text-gray-500 dark:text-gray-400">平均返信時間</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{formatHours(snapshot.avgReplyHours)}</p>
          </article>
          <article className={PAGE_CARD_PADDED_CLASS}>
            <p className="text-xs text-gray-500 dark:text-gray-400">アンケ高評価率</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{formatRate(snapshot.surveyPositiveRate)}</p>
          </article>
        </section>
      )}

      <section id="advice-report-section" className={PAGE_CARD_PADDED_CLASS}>
        <div className="flex items-center gap-2 mb-3">
          <Lightbulb size={18} className="text-amber-500" />
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">提案レポート</h2>
        </div>

        {!reportText ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            まだ分析結果がありません。「分析を実行」を押すと、店舗データを使って提案を作成します。
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              生成方式: {usedAi ? 'AI分析（Gemini）' : '標準ロジック（API未設定時の安全モード）'}
            </p>
            <pre className="whitespace-pre-wrap text-sm leading-7 text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
              {reportText}
            </pre>
          </div>
        )}
      </section>
    </div>
  );
};
