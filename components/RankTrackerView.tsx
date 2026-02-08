import React, { useEffect, useMemo, useState } from 'react';
import { PlusCircle, Save, Trash2, Pencil, X, Play, RefreshCcw } from 'lucide-react';
import {
  CompetitorMetricSnapshot,
  CompetitorTarget,
  RankCollectionResult,
  RankCollectionRun,
  RankCollectionRunDetail,
  RankKeyword,
  User,
} from '../types';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useStore } from '../contexts/StoreContext';
import { useNotification } from '../contexts/NotificationContext';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { rankKeywordService } from '../services/rankKeywordService';
import { rankCollectionService } from '../services/rankCollectionService';
import { competitorService } from '../services/competitorService';
import { getErrorMessage } from '../services/errorMessage';

interface RankTrackerViewProps {
  currentUser: User;
}

export const RankTrackerView: React.FC<RankTrackerViewProps> = ({ currentUser }) => {
  const { activeStoreId, stores } = useStore();
  const { addNotification } = useNotification();
  const [keywords, setKeywords] = useState<RankKeyword[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newKeyword, setNewKeyword] = useState('');
  const [newNote, setNewNote] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editKeyword, setEditKeyword] = useState('');
  const [editNote, setEditNote] = useState('');
  const [collectionRuns, setCollectionRuns] = useState<RankCollectionRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRunResults, setSelectedRunResults] = useState<RankCollectionResult[]>([]);
  const [selectedRunCompetitorSnapshots, setSelectedRunCompetitorSnapshots] = useState<CompetitorMetricSnapshot[]>([]);
  const [isRunLoading, setIsRunLoading] = useState(false);
  const [isRunSubmitting, setIsRunSubmitting] = useState(false);
  const [competitors, setCompetitors] = useState<CompetitorTarget[]>([]);
  const [newCompetitorName, setNewCompetitorName] = useState('');
  const [newCompetitorNote, setNewCompetitorNote] = useState('');
  const [isCompetitorLoading, setIsCompetitorLoading] = useState(false);
  const [isCompetitorSubmitting, setIsCompetitorSubmitting] = useState(false);
  const [dashboardRunDetails, setDashboardRunDetails] = useState<RankCollectionRunDetail[]>([]);
  const [dashboardWarning, setDashboardWarning] = useState<string | null>(null);
  const [isDashboardLoading, setIsDashboardLoading] = useState(false);

  const activeStore = useMemo(() => {
    if (!activeStoreId) return null;
    return stores.find((store) => store.id === activeStoreId) || null;
  }, [activeStoreId, stores]);

  const chartPalette = ['#2563EB', '#059669', '#D97706', '#7C3AED'];

  const average = (numbers: number[]): number | null => {
    if (numbers.length === 0) return null;
    return Number((numbers.reduce((sum, value) => sum + value, 0) / numbers.length).toFixed(1));
  };

  const formatRunLabel = (date: Date): string => {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}/${day}`;
  };

  const loadKeywords = async () => {
    if (!activeStoreId) {
      setKeywords([]);
      setEditingId(null);
      return;
    }
    if (!isSupabaseConfigured) {
      setKeywords([]);
      return;
    }

    setIsLoading(true);
    try {
      const rows = await rankKeywordService.listActiveByStore(activeStoreId);
      setKeywords(rows);
    } catch (error) {
      console.error('[RankTrackerView] Failed to load rank keywords:', error);
      addNotification('読み込みエラー', `順位キーワードの取得に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
      setKeywords([]);
    } finally {
      setIsLoading(false);
    }
  };

  const loadCollectionRuns = async () => {
    if (!activeStoreId || !isSupabaseConfigured) {
      setCollectionRuns([]);
      setSelectedRunId(null);
      setSelectedRunResults([]);
      setSelectedRunCompetitorSnapshots([]);
      return;
    }

    setIsRunLoading(true);
    try {
      const runs = await rankCollectionService.listRunsByStore(activeStoreId, 15);
      setCollectionRuns(runs);
      if (runs.length === 0) {
        setSelectedRunId(null);
        setSelectedRunResults([]);
        setSelectedRunCompetitorSnapshots([]);
        return;
      }

      const nextSelectedRunId = selectedRunId && runs.some((run) => run.id === selectedRunId) ? selectedRunId : runs[0].id;
      setSelectedRunId(nextSelectedRunId);
      const [results, competitorSnapshots] = await Promise.all([
        rankCollectionService.listResultsByRun(nextSelectedRunId),
        rankCollectionService.listCompetitorSnapshotsByRun(nextSelectedRunId),
      ]);
      setSelectedRunResults(results);
      setSelectedRunCompetitorSnapshots(competitorSnapshots);
    } catch (error) {
      console.error('[RankTrackerView] Failed to load rank collection runs:', error);
      addNotification(
        '読み込みエラー',
        `順位収集履歴の取得に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`,
        'ERROR'
      );
      setCollectionRuns([]);
      setSelectedRunResults([]);
      setSelectedRunCompetitorSnapshots([]);
    } finally {
      setIsRunLoading(false);
    }
  };

  const loadRunDetails = async (runId: string) => {
    if (!isSupabaseConfigured) {
      setSelectedRunResults([]);
      setSelectedRunCompetitorSnapshots([]);
      return;
    }
    try {
      const [results, competitorSnapshots] = await Promise.all([
        rankCollectionService.listResultsByRun(runId),
        rankCollectionService.listCompetitorSnapshotsByRun(runId),
      ]);
      setSelectedRunResults(results);
      setSelectedRunCompetitorSnapshots(competitorSnapshots);
    } catch (error) {
      console.error('[RankTrackerView] Failed to load rank collection results:', error);
      addNotification(
        '読み込みエラー',
        `収集結果の取得に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`,
        'ERROR'
      );
      setSelectedRunResults([]);
      setSelectedRunCompetitorSnapshots([]);
    }
  };

  const loadCompetitors = async () => {
    if (!activeStoreId || !isSupabaseConfigured) {
      setCompetitors([]);
      return;
    }

    setIsCompetitorLoading(true);
    try {
      const rows = await competitorService.listActiveByStore(activeStoreId);
      setCompetitors(rows);
    } catch (error) {
      console.error('[RankTrackerView] Failed to load competitor targets:', error);
      addNotification(
        '読み込みエラー',
        `競合ターゲットの取得に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`,
        'ERROR'
      );
      setCompetitors([]);
    } finally {
      setIsCompetitorLoading(false);
    }
  };

  const loadDashboard = async () => {
    if (!activeStoreId || !isSupabaseConfigured) {
      setDashboardRunDetails([]);
      setDashboardWarning(null);
      return;
    }

    setIsDashboardLoading(true);
    try {
      const details = await rankCollectionService.listRunDetailsByStore(activeStoreId, 14);
      setDashboardRunDetails(details);
      const warning = details.find((detail) => detail.competitorSkippedReason)?.competitorSkippedReason || null;
      setDashboardWarning(warning);
    } catch (error) {
      console.error('[RankTrackerView] Failed to load rank dashboard data:', error);
      addNotification(
        '読み込みエラー',
        `ダッシュボードデータの取得に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`,
        'ERROR'
      );
      setDashboardRunDetails([]);
      setDashboardWarning(null);
    } finally {
      setIsDashboardLoading(false);
    }
  };

  useEffect(() => {
    void loadKeywords();
    void loadCollectionRuns();
    void loadCompetitors();
    void loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStoreId]);

  const startEdit = (target: RankKeyword) => {
    setEditingId(target.id);
    setEditKeyword(target.keyword);
    setEditNote(target.note || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditKeyword('');
    setEditNote('');
  };

  const handleCreate = async () => {
    if (!activeStoreId) {
      addNotification('店舗未選択', '店舗を選択してから追加してください。', 'WARNING');
      return;
    }
    if (!isSupabaseConfigured) {
      addNotification('未設定', 'Supabase未設定のため追加できません。', 'WARNING');
      return;
    }

    setIsSubmitting(true);
    try {
      await rankKeywordService.create({
        storeId: activeStoreId,
        keyword: newKeyword,
        note: newNote,
        createdBy: currentUser.id,
      });
      setNewKeyword('');
      setNewNote('');
      addNotification('追加完了', '順位キーワードを追加しました。', 'SUCCESS');
      await loadKeywords();
    } catch (error) {
      console.error('[RankTrackerView] Failed to create rank keyword:', error);
      addNotification('追加エラー', getErrorMessage(error) || '順位キーワードの追加に失敗しました。', 'ERROR');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    if (!isSupabaseConfigured) {
      addNotification('未設定', 'Supabase未設定のため保存できません。', 'WARNING');
      return;
    }

    setIsSubmitting(true);
    try {
      await rankKeywordService.update({
        id: editingId,
        keyword: editKeyword,
        note: editNote,
        updatedBy: currentUser.id,
      });
      addNotification('保存完了', '順位キーワードを更新しました。', 'SUCCESS');
      cancelEdit();
      await loadKeywords();
    } catch (error) {
      console.error('[RankTrackerView] Failed to update rank keyword:', error);
      addNotification('保存エラー', getErrorMessage(error) || '順位キーワードの更新に失敗しました。', 'ERROR');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchive = async (target: RankKeyword) => {
    if (!isSupabaseConfigured) {
      addNotification('未設定', 'Supabase未設定のため削除できません。', 'WARNING');
      return;
    }
    const ok = window.confirm(`「${target.keyword}」を削除しますか？（論理削除）`);
    if (!ok) return;

    setIsSubmitting(true);
    try {
      await rankKeywordService.archive({ id: target.id, updatedBy: currentUser.id });
      addNotification('削除', '順位キーワードを削除しました。', 'INFO');
      if (editingId === target.id) cancelEdit();
      await loadKeywords();
    } catch (error) {
      console.error('[RankTrackerView] Failed to archive rank keyword:', error);
      addNotification('削除エラー', getErrorMessage(error) || '削除に失敗しました。', 'ERROR');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRunCollectionMock = async () => {
    if (!activeStoreId) {
      addNotification('店舗未選択', '店舗を選択してから収集を実行してください。', 'WARNING');
      return;
    }
    if (!isSupabaseConfigured) {
      addNotification('未設定', 'Supabase未設定のため収集を実行できません。', 'WARNING');
      return;
    }

    setIsRunSubmitting(true);
    try {
      const result = await rankCollectionService.collectByFunction({ storeId: activeStoreId, mode: 'MOCK' });
      addNotification(
        '収集完了',
        result.message ||
          `順位${result.collectedCount}件 / 競合${result.collectedCompetitorCount || 0}件の収集を実行しました。`,
        'SUCCESS'
      );
      await Promise.all([loadCollectionRuns(), loadDashboard()]);
    } catch (error) {
      console.error('[RankTrackerView] Failed to run rank collection:', error);
      addNotification('収集エラー', getErrorMessage(error) || '順位収集の実行に失敗しました。', 'ERROR');
    } finally {
      setIsRunSubmitting(false);
    }
  };

  const handleCreateCompetitor = async () => {
    if (!activeStoreId) {
      addNotification('店舗未選択', '店舗を選択してから追加してください。', 'WARNING');
      return;
    }
    if (!isSupabaseConfigured) {
      addNotification('未設定', 'Supabase未設定のため追加できません。', 'WARNING');
      return;
    }

    setIsCompetitorSubmitting(true);
    try {
      await competitorService.create({
        storeId: activeStoreId,
        name: newCompetitorName,
        note: newCompetitorNote,
        createdBy: currentUser.id,
      });
      setNewCompetitorName('');
      setNewCompetitorNote('');
      addNotification('追加完了', '競合ターゲットを追加しました。', 'SUCCESS');
      await loadCompetitors();
    } catch (error) {
      console.error('[RankTrackerView] Failed to create competitor target:', error);
      addNotification('追加エラー', getErrorMessage(error) || '競合ターゲットの追加に失敗しました。', 'ERROR');
    } finally {
      setIsCompetitorSubmitting(false);
    }
  };

  const handleArchiveCompetitor = async (target: CompetitorTarget) => {
    if (!isSupabaseConfigured) {
      addNotification('未設定', 'Supabase未設定のため削除できません。', 'WARNING');
      return;
    }
    const ok = window.confirm(`「${target.name}」を削除しますか？（論理削除）`);
    if (!ok) return;

    setIsCompetitorSubmitting(true);
    try {
      await competitorService.archive({ id: target.id, updatedBy: currentUser.id });
      addNotification('削除', '競合ターゲットを削除しました。', 'INFO');
      await loadCompetitors();
    } catch (error) {
      console.error('[RankTrackerView] Failed to archive competitor target:', error);
      addNotification('削除エラー', getErrorMessage(error) || '競合ターゲットの削除に失敗しました。', 'ERROR');
    } finally {
      setIsCompetitorSubmitting(false);
    }
  };

  const handleSelectRun = async (runId: string) => {
    setSelectedRunId(runId);
    await loadRunDetails(runId);
  };

  const runStatusLabel = (status: RankCollectionRun['status']) => {
    if (status === 'SUCCESS') return 'SUCCESS';
    if (status === 'FAILED') return 'FAILED';
    return 'RUNNING';
  };

  const runStatusClassName = (status: RankCollectionRun['status']) => {
    if (status === 'SUCCESS') return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200';
    if (status === 'FAILED') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200';
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200';
  };

  const latestDashboardRun = useMemo(() => {
    if (dashboardRunDetails.length === 0) return null;
    return dashboardRunDetails[dashboardRunDetails.length - 1];
  }, [dashboardRunDetails]);

  const latestRunKeywordAverage = useMemo(() => {
    if (!latestDashboardRun) return null;
    return average(
      latestDashboardRun.results
        .map((result) => result.position)
        .filter((position): position is number => typeof position === 'number')
    );
  }, [latestDashboardRun]);

  const latestRunBestKeyword = useMemo(() => {
    if (!latestDashboardRun) return null;
    const candidates = latestDashboardRun.results.filter(
      (result): result is RankCollectionResult & { position: number } => typeof result.position === 'number'
    );
    if (candidates.length === 0) return null;
    return candidates.reduce((best, current) => (current.position < best.position ? current : best));
  }, [latestDashboardRun]);

  const latestRunCompetitorAverage = useMemo(() => {
    if (!latestDashboardRun) return null;
    return average(
      latestDashboardRun.competitorSnapshots
        .map((snapshot) => snapshot.mapRank)
        .filter((rank): rank is number => typeof rank === 'number')
    );
  }, [latestDashboardRun]);

  const topKeywordKeys = useMemo(() => {
    const counts = new Map<string, number>();
    dashboardRunDetails.forEach((detail) => {
      detail.results.forEach((result) => {
        counts.set(result.keyword, (counts.get(result.keyword) || 0) + 1);
      });
    });
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 4)
      .map(([keyword]) => keyword);
  }, [dashboardRunDetails]);

  const keywordTrendData = useMemo(() => {
    return dashboardRunDetails.map((detail) => {
      const row: Record<string, string | number | null> = {
        runLabel: formatRunLabel(detail.run.startedAt),
      };
      topKeywordKeys.forEach((keyword) => {
        const item = detail.results.find((result) => result.keyword === keyword);
        row[keyword] = typeof item?.position === 'number' ? item.position : null;
      });
      row.averageRank = average(
        detail.results.map((result) => result.position).filter((position): position is number => typeof position === 'number')
      );
      return row;
    });
  }, [dashboardRunDetails, topKeywordKeys]);

  const latestCompetitorBars = useMemo(() => {
    if (!latestDashboardRun) return [];
    return [...latestDashboardRun.competitorSnapshots]
      .filter((snapshot): snapshot is CompetitorMetricSnapshot & { mapRank: number } => typeof snapshot.mapRank === 'number')
      .sort((left, right) => left.mapRank - right.mapRank)
      .slice(0, 8)
      .map((snapshot) => ({
        name: snapshot.competitorName,
        mapRank: snapshot.mapRank,
        reviewCount: snapshot.reviewCount,
        rating: typeof snapshot.rating === 'number' ? snapshot.rating : null,
      }));
  }, [latestDashboardRun]);

  const trendRows = useMemo(() => {
    return dashboardRunDetails.map((detail) => {
      const rankAverage = average(
        detail.results.map((result) => result.position).filter((position): position is number => typeof position === 'number')
      );
      const competitorAverage = average(
        detail.competitorSnapshots
          .map((snapshot) => snapshot.mapRank)
          .filter((position): position is number => typeof position === 'number')
      );
      return {
        runId: detail.run.id,
        startedAt: detail.run.startedAt,
        rankAverage,
        competitorAverage,
        keywordCount: detail.results.length,
        competitorCount: detail.competitorSnapshots.length,
      };
    });
  }, [dashboardRunDetails]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white">順位計測（キーワード管理）</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            店舗ごとの順位計測キーワードと競合ターゲットを管理します。収集結果はrun単位で履歴化されます。
          </p>
        </div>
      </div>

      {!activeStoreId && (
        <div className="p-4 rounded-xl bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-900/30 text-sm text-yellow-800 dark:text-yellow-200">
          店舗が選択されていません。右上の店舗セレクタから選択してください。
        </div>
      )}

      {!isSupabaseConfigured && (
        <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-900/30 text-sm text-blue-800 dark:text-blue-200">
          Supabase未設定のため、順位キーワードは保存できません（デモ表示のみ）。
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-white">順位/競合ダッシュボード（P3-04）</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              直近runの推移と競合比較を可視化します（MOCK/REALの保存データ共通）。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadDashboard()}
            disabled={isDashboardLoading || !activeStoreId || !isSupabaseConfigured}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <RefreshCcw size={14} />
            ダッシュボード再読込
          </button>
        </div>

        {dashboardWarning && (
          <div className="p-3 rounded-xl bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-900/30 text-xs text-yellow-800 dark:text-yellow-200">
            {dashboardWarning}
          </div>
        )}

        {isDashboardLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">ダッシュボードを読み込み中...</p>
        ) : dashboardRunDetails.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            収集データがまだありません。まず「収集実行（MOCK）」を実行してください。
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30">
                <p className="text-xs text-gray-500 dark:text-gray-400">最新run 平均順位</p>
                <p className="text-xl font-bold text-gray-800 dark:text-white mt-1">
                  {typeof latestRunKeywordAverage === 'number' ? `${latestRunKeywordAverage}位` : '-'}
                </p>
              </div>
              <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30">
                <p className="text-xs text-gray-500 dark:text-gray-400">最新run 最上位キーワード</p>
                <p className="text-sm font-semibold text-gray-800 dark:text-white mt-1 break-words">
                  {latestRunBestKeyword ? `${latestRunBestKeyword.keyword}（${latestRunBestKeyword.position}位）` : '-'}
                </p>
              </div>
              <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30">
                <p className="text-xs text-gray-500 dark:text-gray-400">最新run 競合平均順位</p>
                <p className="text-xl font-bold text-gray-800 dark:text-white mt-1">
                  {typeof latestRunCompetitorAverage === 'number' ? `${latestRunCompetitorAverage}位` : '-'}
                </p>
              </div>
              <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30">
                <p className="text-xs text-gray-500 dark:text-gray-400">可視化対象run</p>
                <p className="text-xl font-bold text-gray-800 dark:text-white mt-1">{dashboardRunDetails.length}件</p>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/20">
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">順位推移（主要キーワード）</p>
                {topKeywordKeys.length > 0 ? (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={keywordTrendData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="runLabel" />
                        <YAxis reversed domain={['auto', 'auto']} allowDecimals={false} />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="averageRank" stroke="#334155" strokeWidth={2} name="平均順位" dot={false} />
                        {topKeywordKeys.map((keyword, index) => (
                          <Line
                            key={keyword}
                            type="monotone"
                            dataKey={keyword}
                            stroke={chartPalette[index % chartPalette.length]}
                            strokeWidth={2}
                            dot={false}
                            connectNulls
                            name={keyword}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 dark:text-gray-400">表示できるキーワードデータがありません。</p>
                )}
              </div>

              <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/20">
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">最新run 競合比較（順位）</p>
                {latestCompetitorBars.length > 0 ? (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={latestCompetitorBars}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis reversed allowDecimals={false} />
                        <Tooltip />
                        <Bar dataKey="mapRank" fill="#2563EB" name="順位" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 dark:text-gray-400">競合比較データがありません。</p>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-xs border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <thead className="bg-gray-50 dark:bg-gray-900/40">
                  <tr>
                    <th className="text-left px-3 py-2 text-gray-600 dark:text-gray-300">run日時</th>
                    <th className="text-left px-3 py-2 text-gray-600 dark:text-gray-300">順位平均</th>
                    <th className="text-left px-3 py-2 text-gray-600 dark:text-gray-300">競合平均</th>
                    <th className="text-left px-3 py-2 text-gray-600 dark:text-gray-300">キーワード件数</th>
                    <th className="text-left px-3 py-2 text-gray-600 dark:text-gray-300">競合件数</th>
                  </tr>
                </thead>
                <tbody>
                  {trendRows.map((row) => (
                    <tr key={row.runId} className="border-t border-gray-200 dark:border-gray-700">
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-200">{row.startedAt.toLocaleString('ja-JP')}</td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-200">
                        {typeof row.rankAverage === 'number' ? `${row.rankAverage}位` : '-'}
                      </td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-200">
                        {typeof row.competitorAverage === 'number' ? `${row.competitorAverage}位` : '-'}
                      </td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-200">{row.keywordCount}</td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-200">{row.competitorCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-white">日次順位収集（P3-02）</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              現在はMOCK収集のみ対応。REAL収集は後続チケットで拡張します。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadCollectionRuns()}
              disabled={isRunLoading || !activeStoreId || !isSupabaseConfigured}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <RefreshCcw size={14} />
              再読込
            </button>
            <button
              type="button"
              onClick={() => void handleRunCollectionMock()}
              disabled={isRunSubmitting || isRunLoading || !activeStoreId || !isSupabaseConfigured}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Play size={14} />
              収集実行（MOCK）
            </button>
          </div>
        </div>

        {isRunLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">収集履歴を読み込み中...</p>
        ) : collectionRuns.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">収集履歴はまだありません。</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">実行履歴</p>
              {collectionRuns.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => void handleSelectRun(run.id)}
                  className={`w-full text-left p-3 rounded-xl border ${
                    selectedRunId === run.id
                      ? 'border-primary-300 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${runStatusClassName(run.status)}`}>
                      {runStatusLabel(run.status)}
                    </span>
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">{run.startedAt.toLocaleString('ja-JP')}</span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-300 mt-2">
                    mode: {run.mode} / trigger: {run.triggerType}
                  </p>
                  {run.message && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 break-words">{run.message}</p>
                  )}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">選択中runの収集結果</p>
              {selectedRunId && (selectedRunResults.length > 0 || selectedRunCompetitorSnapshots.length > 0) ? (
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  <div>
                    <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">順位キーワード</p>
                    {selectedRunResults.length > 0 ? (
                      <div className="space-y-2">
                        {selectedRunResults.map((result) => (
                          <div
                            key={result.id}
                            className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-gray-800 dark:text-white break-words">{result.keyword}</p>
                              <span className="text-xs font-semibold text-primary-700 dark:text-primary-300">
                                {typeof result.position === 'number' ? `${result.position}位` : '-'}
                              </span>
                            </div>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                              mode: {result.mode} / status: {result.status}
                            </p>
                            {result.message && (
                              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 break-words">{result.message}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500 dark:text-gray-400">順位キーワード結果はありません。</p>
                    )}
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">競合比較</p>
                    {selectedRunCompetitorSnapshots.length > 0 ? (
                      <div className="space-y-2">
                        {selectedRunCompetitorSnapshots.map((snapshot) => (
                          <div
                            key={snapshot.id}
                            className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-gray-800 dark:text-white break-words">
                                {snapshot.competitorName}
                              </p>
                              <span className="text-xs font-semibold text-primary-700 dark:text-primary-300">
                                {typeof snapshot.mapRank === 'number' ? `${snapshot.mapRank}位` : '-'}
                              </span>
                            </div>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                              口コミ: {snapshot.reviewCount}件 / 評価: {typeof snapshot.rating === 'number' ? snapshot.rating.toFixed(1) : '-'}
                            </p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                              mode: {snapshot.mode} / status: {snapshot.status}
                            </p>
                            {snapshot.message && (
                              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 break-words">{snapshot.message}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500 dark:text-gray-400">競合結果はありません。</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">runを選択すると結果を表示します。</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-gray-800 dark:text-white">競合ターゲット（P3-03）</h2>
          <span className="text-xs text-gray-500 dark:text-gray-400">収集実行時に競合指標を同時保存します</span>
        </div>

        {isCompetitorLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">競合ターゲットを読み込み中...</p>
        ) : competitors.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">競合ターゲットはまだありません。</p>
        ) : (
          <div className="space-y-2">
            {competitors.map((competitor) => (
              <div
                key={competitor.id}
                className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-800 dark:text-white break-words">{competitor.name}</p>
                  {competitor.note && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 break-words">{competitor.note}</p>
                  )}
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2">
                    更新: {competitor.updatedAt.toLocaleString('ja-JP')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleArchiveCompetitor(competitor)}
                  disabled={isCompetitorSubmitting}
                  className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-red-700 dark:text-red-200 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/30 rounded-lg disabled:opacity-60"
                >
                  <Trash2 size={14} />
                  削除
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            type="text"
            value={newCompetitorName}
            onChange={(e) => setNewCompetitorName(e.target.value)}
            placeholder="競合名（例: 渋谷ラーメン本店）"
            className="md:col-span-2 w-full p-2.5 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg"
            disabled={isCompetitorSubmitting}
          />
          <input
            type="text"
            value={newCompetitorNote}
            onChange={(e) => setNewCompetitorNote(e.target.value)}
            placeholder="メモ（任意）"
            className="w-full p-2.5 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg"
            disabled={isCompetitorSubmitting}
          />
        </div>
        <button
          type="button"
          onClick={() => void handleCreateCompetitor()}
          disabled={isCompetitorSubmitting || !activeStoreId || !isSupabaseConfigured}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <PlusCircle size={16} />
          競合を追加
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-gray-800 dark:text-white">キーワード一覧</h2>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            対象店舗: {activeStore?.name || '-'}
          </span>
        </div>

        {isLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">読み込み中...</p>
        ) : keywords.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">キーワードはまだありません。</p>
        ) : (
          <div className="space-y-2">
            {keywords.map((item) => {
              const isEditing = editingId === item.id;
              return (
                <div key={item.id} className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={editKeyword}
                            onChange={(e) => setEditKeyword(e.target.value)}
                            className="w-full p-2.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg"
                            placeholder="キーワード（例: 渋谷 ラーメン）"
                            disabled={isSubmitting}
                          />
                          <input
                            type="text"
                            value={editNote}
                            onChange={(e) => setEditNote(e.target.value)}
                            className="w-full p-2.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg"
                            placeholder="メモ（任意）"
                            disabled={isSubmitting}
                          />
                        </div>
                      ) : (
                        <div>
                          <p className="text-sm font-semibold text-gray-800 dark:text-white break-words">{item.keyword}</p>
                          {item.note && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 break-words">{item.note}</p>
                          )}
                          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2">
                            更新: {item.updatedAt.toLocaleString('ja-JP')}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleSaveEdit()}
                            disabled={isSubmitting}
                            className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            <Save size={14} />
                            保存
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={isSubmitting}
                            className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-60"
                          >
                            <X size={14} />
                            キャンセル
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => startEdit(item)}
                            disabled={isSubmitting}
                            className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-60"
                          >
                            <Pencil size={14} />
                            編集
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleArchive(item)}
                            disabled={isSubmitting}
                            className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-red-700 dark:text-red-200 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/30 rounded-lg disabled:opacity-60"
                          >
                            <Trash2 size={14} />
                            削除
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 space-y-4">
        <h2 className="text-lg font-bold text-gray-800 dark:text-white">キーワード追加</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            type="text"
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            placeholder="キーワード（例: 渋谷 ラーメン）"
            className="md:col-span-2 w-full p-2.5 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg"
            disabled={isSubmitting}
          />
          <input
            type="text"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="メモ（任意）"
            className="w-full p-2.5 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg"
            disabled={isSubmitting}
          />
        </div>
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={isSubmitting || !activeStoreId || !isSupabaseConfigured}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <PlusCircle size={16} />
          追加
        </button>
      </div>
    </div>
  );
};
