import React, { useEffect, useMemo, useState } from 'react';
import { PlusCircle, Save, Trash2, Pencil, X, Play, RefreshCcw } from 'lucide-react';
import { RankCollectionResult, RankCollectionRun, RankKeyword, User } from '../types';
import { useStore } from '../contexts/StoreContext';
import { useNotification } from '../contexts/NotificationContext';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { rankKeywordService } from '../services/rankKeywordService';
import { rankCollectionService } from '../services/rankCollectionService';
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
  const [isRunLoading, setIsRunLoading] = useState(false);
  const [isRunSubmitting, setIsRunSubmitting] = useState(false);

  const activeStore = useMemo(() => {
    if (!activeStoreId) return null;
    return stores.find((store) => store.id === activeStoreId) || null;
  }, [activeStoreId, stores]);

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
      return;
    }

    setIsRunLoading(true);
    try {
      const runs = await rankCollectionService.listRunsByStore(activeStoreId, 15);
      setCollectionRuns(runs);
      if (runs.length === 0) {
        setSelectedRunId(null);
        setSelectedRunResults([]);
        return;
      }

      const nextSelectedRunId = selectedRunId && runs.some((run) => run.id === selectedRunId) ? selectedRunId : runs[0].id;
      setSelectedRunId(nextSelectedRunId);
      const results = await rankCollectionService.listResultsByRun(nextSelectedRunId);
      setSelectedRunResults(results);
    } catch (error) {
      console.error('[RankTrackerView] Failed to load rank collection runs:', error);
      addNotification(
        '読み込みエラー',
        `順位収集履歴の取得に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`,
        'ERROR'
      );
      setCollectionRuns([]);
      setSelectedRunResults([]);
    } finally {
      setIsRunLoading(false);
    }
  };

  const loadRunResults = async (runId: string) => {
    if (!isSupabaseConfigured) {
      setSelectedRunResults([]);
      return;
    }
    try {
      const results = await rankCollectionService.listResultsByRun(runId);
      setSelectedRunResults(results);
    } catch (error) {
      console.error('[RankTrackerView] Failed to load rank collection results:', error);
      addNotification(
        '読み込みエラー',
        `収集結果の取得に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`,
        'ERROR'
      );
      setSelectedRunResults([]);
    }
  };

  useEffect(() => {
    void loadKeywords();
    void loadCollectionRuns();
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
        result.message || `順位収集を実行しました。（${result.collectedCount}件）`,
        'SUCCESS'
      );
      await loadCollectionRuns();
    } catch (error) {
      console.error('[RankTrackerView] Failed to run rank collection:', error);
      addNotification('収集エラー', getErrorMessage(error) || '順位収集の実行に失敗しました。', 'ERROR');
    } finally {
      setIsRunSubmitting(false);
    }
  };

  const handleSelectRun = async (runId: string) => {
    setSelectedRunId(runId);
    await loadRunResults(runId);
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

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white">順位計測（キーワード管理）</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            店舗ごとの順位計測に使うキーワードを管理します。順位の自動収集は P3-02 で追加します。
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
              {selectedRunId && selectedRunResults.length > 0 ? (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
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
                <p className="text-sm text-gray-500 dark:text-gray-400">runを選択すると結果を表示します。</p>
              )}
            </div>
          </div>
        )}
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
