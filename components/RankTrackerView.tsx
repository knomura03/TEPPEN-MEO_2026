import React, { useEffect, useMemo, useState } from 'react';
import { PlusCircle, Save, Trash2, Pencil, X, Play, RefreshCcw } from 'lucide-react';
import {
  CompetitorMetricSnapshot,
  CompetitorTarget,
  NapAlert,
  NapConsistencyResult,
  NapConsistencyRun,
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
import { napConsistencyService } from '../services/napConsistencyService';
import { napAlertService } from '../services/napAlertService';
import { getErrorMessage } from '../services/errorMessage';
import { PAGE_CONTAINER_CLASS, PAGE_HEADER_DESCRIPTION_CLASS, PAGE_HEADER_TITLE_CLASS } from './ui/pageLayout';

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
  const [napRuns, setNapRuns] = useState<NapConsistencyRun[]>([]);
  const [selectedNapRunId, setSelectedNapRunId] = useState<string | null>(null);
  const [selectedNapResults, setSelectedNapResults] = useState<NapConsistencyResult[]>([]);
  const [isNapLoading, setIsNapLoading] = useState(false);
  const [isNapSubmitting, setIsNapSubmitting] = useState(false);
  const [napAlerts, setNapAlerts] = useState<NapAlert[]>([]);
  const [isNapAlertLoading, setIsNapAlertLoading] = useState(false);
  const [napAlertUpdatingId, setNapAlertUpdatingId] = useState<string | null>(null);
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

  const loadNapRuns = async () => {
    if (!activeStoreId || !isSupabaseConfigured) {
      setNapRuns([]);
      setSelectedNapRunId(null);
      setSelectedNapResults([]);
      return;
    }

    setIsNapLoading(true);
    try {
      const runs = await napConsistencyService.listRunsByStore(activeStoreId, 15);
      setNapRuns(runs);
      if (runs.length === 0) {
        setSelectedNapRunId(null);
        setSelectedNapResults([]);
        return;
      }

      const nextSelectedRunId =
        selectedNapRunId && runs.some((run) => run.id === selectedNapRunId) ? selectedNapRunId : runs[0].id;
      setSelectedNapRunId(nextSelectedRunId);
      const results = await napConsistencyService.listResultsByRun(nextSelectedRunId);
      setSelectedNapResults(results);
    } catch (error) {
      console.error('[RankTrackerView] Failed to load business profile runs:', error);
      addNotification(
        '読み込みエラー',
        `店舗情報チェック履歴の取得に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`,
        'ERROR'
      );
      setNapRuns([]);
      setSelectedNapResults([]);
    } finally {
      setIsNapLoading(false);
    }
  };

  const loadNapAlerts = async () => {
    if (!activeStoreId || !isSupabaseConfigured) {
      setNapAlerts([]);
      return;
    }

    setIsNapAlertLoading(true);
    try {
      const alerts = await napAlertService.listActiveByStore(activeStoreId);
      setNapAlerts(alerts);
    } catch (error) {
      console.error('[RankTrackerView] Failed to load business profile alerts:', error);
      addNotification(
        '読み込みエラー',
        `店舗情報アラートの取得に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`,
        'ERROR'
      );
      setNapAlerts([]);
    } finally {
      setIsNapAlertLoading(false);
    }
  };

  const loadNapResults = async (runId: string) => {
    if (!isSupabaseConfigured) {
      setSelectedNapResults([]);
      return;
    }
    try {
      const results = await napConsistencyService.listResultsByRun(runId);
      setSelectedNapResults(results);
    } catch (error) {
      console.error('[RankTrackerView] Failed to load business profile results:', error);
      addNotification(
        '読み込みエラー',
        `店舗情報チェック結果の取得に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`,
        'ERROR'
      );
      setSelectedNapResults([]);
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
    void loadNapRuns();
    void loadNapAlerts();
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

  const handleRunNapCheck = async () => {
    if (!activeStoreId) {
      addNotification('店舗未選択', '店舗を選択してから実行してください。', 'WARNING');
      return;
    }
    if (!isSupabaseConfigured) {
      addNotification('未設定', 'Supabase未設定のため実行できません。', 'WARNING');
      return;
    }

    setIsNapSubmitting(true);
    try {
      const result = await napConsistencyService.runManualCheck({
        storeId: activeStoreId,
        requestedByUserId: currentUser.id,
      });
      const hasIssues = result.summary.mismatch + result.summary.missing > 0;
      addNotification(
        hasIssues ? '店舗情報チェック（要確認）' : '店舗情報チェック完了',
        result.message || '店舗情報チェックを実行しました。',
        hasIssues ? 'WARNING' : 'SUCCESS'
      );
      await loadNapRuns();
      await loadNapAlerts();
    } catch (error) {
      console.error('[RankTrackerView] Failed to run business profile check:', error);
      addNotification('店舗情報チェックエラー', getErrorMessage(error) || '店舗情報チェックの実行に失敗しました。', 'ERROR');
    } finally {
      setIsNapSubmitting(false);
    }
  };

  const handleUpdateNapAlertStatus = async (alert: NapAlert, nextStatus: NapAlert['status']) => {
    if (!isSupabaseConfigured) {
      addNotification('未設定', 'Supabase未設定のため更新できません。', 'WARNING');
      return;
    }
    setNapAlertUpdatingId(alert.id);
    try {
      await napAlertService.updateStatus({ id: alert.id, status: nextStatus, updatedBy: currentUser.id });
      addNotification('更新', '店舗情報アラートの状態を更新しました。', 'SUCCESS');
      await loadNapAlerts();
    } catch (error) {
      console.error('[RankTrackerView] Failed to update business profile alert status:', error);
      addNotification('更新エラー', getErrorMessage(error) || '店舗情報アラート状態の更新に失敗しました。', 'ERROR');
    } finally {
      setNapAlertUpdatingId(null);
    }
  };

  const handleSelectNapRun = async (runId: string) => {
    setSelectedNapRunId(runId);
    await loadNapResults(runId);
  };

  const handleSelectRun = async (runId: string) => {
    setSelectedRunId(runId);
    await loadRunDetails(runId);
  };

  const runStatusLabel = (status: RankCollectionRun['status']) => {
    if (status === 'SUCCESS') return '完了';
    if (status === 'FAILED') return '失敗';
    return '実行中';
  };

  const runStatusClassName = (status: RankCollectionRun['status']) => {
    if (status === 'SUCCESS') return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200';
    if (status === 'FAILED') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200';
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200';
  };

  const napStatusLabel = (status: NapConsistencyRun['status']) => {
    if (status === 'SUCCESS') return '完了';
    if (status === 'FAILED') return '失敗';
    return '実行中';
  };

  const collectionModeLabel = (mode: RankCollectionRun['mode']) => {
    if (mode === 'REAL') return '本番';
    return '検証';
  };

  const collectionTriggerLabel = (triggerType: RankCollectionRun['triggerType']) => {
    if (triggerType === 'SCHEDULED') return '定期実行';
    return '手動実行';
  };

  const napStatusClassName = (status: NapConsistencyRun['status']) => {
    if (status === 'SUCCESS') return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200';
    if (status === 'FAILED') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200';
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200';
  };

  const napResultStatusLabel = (status: NapConsistencyResult['status']) => {
    if (status === 'MATCH') return '一致';
    if (status === 'MISMATCH') return '不一致';
    return '未設定';
  };

  const selectedNapSummary = useMemo(() => {
    if (!selectedNapRunId) return null;
    return napRuns.find((run) => run.id === selectedNapRunId)?.summary || null;
  }, [napRuns, selectedNapRunId]);

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
    <div className={PAGE_CONTAINER_CLASS} data-testid="rank-tracker-view">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className={PAGE_HEADER_TITLE_CLASS}>検索順位チェック</h1>
          <p className={PAGE_HEADER_DESCRIPTION_CLASS}>
            Googleマップ検索で、店舗が何位に表示されているかをキーワードごとに確認できます。履歴比較で改善の優先順位を判断できます。
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

      <div id="rank-dashboard-section" className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-white">順位・競合ダッシュボード</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              直近の実行結果の推移と競合比較を表示します（テストデータ/本番データどちらでも表示可能）。
            </p>
          </div>
          <div id="rank-dashboard-actions">
            <button
              type="button"
              onClick={() => void loadDashboard()}
              disabled={isDashboardLoading || !activeStoreId || !isSupabaseConfigured}
              data-testid="rank-dashboard-reload"
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <RefreshCcw size={14} />
              ダッシュボード再読込
            </button>
          </div>
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
            収集データがまだありません。まず「収集を実行（テストデータ）」を押してください。
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30">
                <p className="text-xs text-gray-500 dark:text-gray-400">最新実行の平均順位</p>
                <p className="text-xl font-bold text-gray-800 dark:text-white mt-1">
                  {typeof latestRunKeywordAverage === 'number' ? `${latestRunKeywordAverage}位` : '-'}
                </p>
              </div>
              <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30">
                <p className="text-xs text-gray-500 dark:text-gray-400">最新実行の最上位キーワード</p>
                <p className="text-sm font-semibold text-gray-800 dark:text-white mt-1 break-words">
                  {latestRunBestKeyword ? `${latestRunBestKeyword.keyword}（${latestRunBestKeyword.position}位）` : '-'}
                </p>
              </div>
              <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30">
                <p className="text-xs text-gray-500 dark:text-gray-400">最新実行の競合平均順位</p>
                <p className="text-xl font-bold text-gray-800 dark:text-white mt-1">
                  {typeof latestRunCompetitorAverage === 'number' ? `${latestRunCompetitorAverage}位` : '-'}
                </p>
              </div>
              <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30">
                <p className="text-xs text-gray-500 dark:text-gray-400">表示対象の実行回数</p>
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
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">最新実行の競合比較（順位）</p>
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
                    <th className="text-left px-3 py-2 text-gray-600 dark:text-gray-300">実行日時</th>
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

      <div id="rank-nap-check-section" className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-white">店舗情報チェック（名前/住所/電話）</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              店舗情報（名前/住所/電話）と媒体設定値の一致状況を実行履歴で確認します。
            </p>
          </div>
          <div id="rank-nap-actions" className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadNapRuns()}
              disabled={isNapLoading || !activeStoreId || !isSupabaseConfigured}
              data-testid="nap-runs-reload"
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <RefreshCcw size={14} />
              再読込
            </button>
            <button
              type="button"
              onClick={() => void handleRunNapCheck()}
              disabled={isNapSubmitting || isNapLoading || !activeStoreId || !isSupabaseConfigured}
              data-testid="nap-run-execute"
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Play size={14} />
              店舗情報チェック実行
            </button>
          </div>
        </div>

        {selectedNapSummary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30">
              <p className="text-xs text-gray-500 dark:text-gray-400">対象媒体</p>
              <p className="text-lg font-bold text-gray-800 dark:text-white">{selectedNapSummary.total}</p>
            </div>
            <div className="p-3 rounded-xl border border-green-200 dark:border-green-900/30 bg-green-50 dark:bg-green-900/10">
              <p className="text-xs text-green-700 dark:text-green-300">一致</p>
              <p className="text-lg font-bold text-green-800 dark:text-green-200">{selectedNapSummary.match}</p>
            </div>
            <div className="p-3 rounded-xl border border-yellow-200 dark:border-yellow-900/30 bg-yellow-50 dark:bg-yellow-900/10">
              <p className="text-xs text-yellow-700 dark:text-yellow-300">不一致</p>
              <p className="text-lg font-bold text-yellow-800 dark:text-yellow-200">{selectedNapSummary.mismatch}</p>
            </div>
            <div className="p-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/30">
              <p className="text-xs text-gray-500 dark:text-gray-400">未設定</p>
              <p className="text-lg font-bold text-gray-800 dark:text-white">{selectedNapSummary.missing}</p>
            </div>
          </div>
        )}

        {isNapLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">店舗情報チェック履歴を読み込み中...</p>
        ) : napRuns.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">店舗情報チェック履歴はまだありません。</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">チェック履歴</p>
              {napRuns.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => void handleSelectNapRun(run.id)}
                  data-testid="nap-run-item"
                  data-run-id={run.id}
                  className={`w-full text-left p-3 rounded-xl border ${
                    selectedNapRunId === run.id
                      ? 'border-primary-300 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${napStatusClassName(run.status)}`}>
                      {napStatusLabel(run.status)}
                    </span>
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">{run.startedAt.toLocaleString('ja-JP')}</span>
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
                    一致 {run.summary.match} / 不一致 {run.summary.mismatch} / 未設定 {run.summary.missing}
                  </p>
                  {run.message && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 break-words">{run.message}</p>}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">選択中の実行詳細</p>
              {selectedNapRunId && selectedNapResults.length > 0 ? (
                <div className="max-h-80 overflow-y-auto pr-1 space-y-2">
                  {selectedNapResults.map((item) => (
                    <div
                      key={item.id}
                      className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-gray-800 dark:text-white">{item.providerName}</p>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                            item.status === 'MATCH'
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200'
                              : item.status === 'MISMATCH'
                                ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200'
                                : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
                          }`}
                        >
                          {napResultStatusLabel(item.status)}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2 text-[11px] text-gray-600 dark:text-gray-300">
                        <div>
                          <p className="font-semibold text-gray-700 dark:text-gray-200">店舗情報</p>
                          <p>名前: {item.expectedName || '-'}</p>
                          <p>住所: {item.expectedAddress || '-'}</p>
                          <p>電話: {item.expectedPhone || '-'}</p>
                        </div>
                        <div>
                          <p className="font-semibold text-gray-700 dark:text-gray-200">媒体設定</p>
                          <p>名前: {item.observedName || '-'}</p>
                          <p>住所: {item.observedAddress || '-'}</p>
                          <p>電話: {item.observedPhone || '-'}</p>
                        </div>
                      </div>
                      {item.mismatchFields.length > 0 && (
                        <p className="text-[11px] text-yellow-700 dark:text-yellow-300 mt-2">
                          不一致項目: {item.mismatchFields.join(', ')}
                        </p>
                      )}
                      {item.message && <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{item.message}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">実行履歴を選択すると詳細を表示します。</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div id="rank-alerts-section" className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-white">店舗情報アラート</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              店舗情報の不一致・未設定をアラートとして保持し、確認済み/解消を管理します。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadNapAlerts()}
              disabled={isNapAlertLoading || !activeStoreId || !isSupabaseConfigured}
              data-testid="nap-alert-reload"
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <RefreshCcw size={14} />
              再読込
            </button>
          </div>
        </div>

        {!activeStoreId ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">店舗を選択するとアラートを表示します。</p>
        ) : !isSupabaseConfigured ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Supabase未設定のため表示できません。</p>
        ) : isNapAlertLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">アラートを読み込み中...</p>
        ) : napAlerts.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">未対応アラートはありません。</p>
        ) : (
          <div className="space-y-2">
            {napAlerts.map((alert) => {
              const statusClassName =
                alert.status === 'OPEN'
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200'
                  : alert.status === 'ACKED'
                    ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200'
                    : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200';
              const disabled = napAlertUpdatingId === alert.id;

              return (
                <div
                  key={alert.id}
                  data-testid="nap-alert-item"
                  data-alert-id={alert.id}
                  className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-gray-800 dark:text-white">{alert.providerName}</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                        last: {alert.lastResultStatus}
                        {alert.mismatchFields.length > 0 ? ` / 不一致: ${alert.mismatchFields.join(', ')}` : ''}
                      </p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                        最終検知: {alert.lastDetectedAt.toLocaleString('ja-JP')} / 初回検知: {alert.firstDetectedAt.toLocaleString('ja-JP')}
                      </p>
                      {alert.note && <p className="text-[11px] text-gray-600 dark:text-gray-300 mt-1">メモ: {alert.note}</p>}
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusClassName}`}>{alert.status}</span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {alert.status === 'OPEN' ? (
                      <button
                        type="button"
                        onClick={() => void handleUpdateNapAlertStatus(alert, 'ACKED')}
                        disabled={disabled}
                        data-testid="nap-alert-toggle"
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        ACK
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleUpdateNapAlertStatus(alert, 'OPEN')}
                        disabled={disabled}
                        data-testid="nap-alert-toggle"
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        未対応に戻す
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => void handleUpdateNapAlertStatus(alert, 'RESOLVED')}
                      disabled={disabled}
                      data-testid="nap-alert-resolve"
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      解消
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div id="rank-collection-section" className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-white">日次順位収集</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              現在はテストデータでの収集のみ対応しています。本番収集は次の開発で対応予定です。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadCollectionRuns()}
              disabled={isRunLoading || !activeStoreId || !isSupabaseConfigured}
              data-testid="rank-runs-reload"
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <RefreshCcw size={14} />
              再読込
            </button>
            <button
              type="button"
              onClick={() => void handleRunCollectionMock()}
              disabled={isRunSubmitting || isRunLoading || !activeStoreId || !isSupabaseConfigured}
              data-testid="rank-run-execute"
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Play size={14} />
              収集を実行（テストデータ）
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
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">収集履歴</p>
              {collectionRuns.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => void handleSelectRun(run.id)}
                  data-testid="rank-run-item"
                  data-run-id={run.id}
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
                    モード: {collectionModeLabel(run.mode)} / 実行種別: {collectionTriggerLabel(run.triggerType)}
                  </p>
                  {run.message && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 break-words">{run.message}</p>
                  )}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">選択中の実行結果</p>
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
                              モード: {collectionModeLabel(result.mode)} / 状態: {runStatusLabel(result.status)}
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
                              モード: {collectionModeLabel(snapshot.mode)} / 状態: {runStatusLabel(snapshot.status)}
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
                <p className="text-sm text-gray-500 dark:text-gray-400">収集履歴を選択すると結果を表示します。</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div id="rank-competitors-section" className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-gray-800 dark:text-white">競合ターゲット</h2>
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
                data-testid="rank-competitor-item"
                data-competitor-id={competitor.id}
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
                  data-testid="rank-competitor-delete"
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
            data-testid="rank-competitor-name-input"
            className="md:col-span-2 w-full p-2.5 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg"
            disabled={isCompetitorSubmitting}
          />
          <input
            type="text"
            value={newCompetitorNote}
            onChange={(e) => setNewCompetitorNote(e.target.value)}
            placeholder="メモ（任意）"
            data-testid="rank-competitor-note-input"
            className="w-full p-2.5 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg"
            disabled={isCompetitorSubmitting}
          />
        </div>
        <button
          type="button"
          onClick={() => void handleCreateCompetitor()}
          disabled={isCompetitorSubmitting || !activeStoreId || !isSupabaseConfigured}
          data-testid="rank-competitor-add"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <PlusCircle size={16} />
          競合を追加
        </button>
      </div>

      <div id="rank-keywords-section" className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 space-y-5">
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
                <div
                  key={item.id}
                  data-testid="rank-keyword-item"
                  data-keyword-id={item.id}
                  className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30"
                >
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
            data-testid="rank-keyword-new-input"
            className="md:col-span-2 w-full p-2.5 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg"
            disabled={isSubmitting}
          />
          <input
            type="text"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="メモ（任意）"
            data-testid="rank-keyword-note-input"
            className="w-full p-2.5 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg"
            disabled={isSubmitting}
          />
        </div>
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={isSubmitting || !activeStoreId || !isSupabaseConfigured}
          data-testid="rank-keyword-add"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <PlusCircle size={16} />
          追加
        </button>
      </div>
    </div>
  );
};
