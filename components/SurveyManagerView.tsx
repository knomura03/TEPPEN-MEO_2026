import React, { useEffect, useMemo, useState } from 'react';
import { SurveyAnalytics, User, Survey } from '../types';
import { useStore } from '../contexts/StoreContext';
import { useNotification } from '../contexts/NotificationContext';
import { buildPublicSurveyUrl, surveyService } from '../services/surveyService';
import { surveyAssetService } from '../services/surveyAssetService';
import { getErrorMessage } from '../services/errorMessage';
import { PlusCircle, Save, Rocket, Archive, Copy, ExternalLink, Download, QrCode, FileText } from 'lucide-react';

interface SurveyManagerViewProps {
  currentUser: User;
}

export const SurveyManagerView: React.FC<SurveyManagerViewProps> = ({ currentUser }) => {
  const { activeStoreId } = useStore();
  const { addNotification } = useNotification();
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedSurveyId, setSelectedSurveyId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [reviewRedirectUrl, setReviewRedirectUrl] = useState('');
  const [positiveThreshold, setPositiveThreshold] = useState(4);
  const [analytics, setAnalytics] = useState<SurveyAnalytics | null>(null);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);
  const [isGeneratingAsset, setIsGeneratingAsset] = useState(false);

  const selectedSurvey = useMemo(
    () => surveys.find((survey) => survey.id === selectedSurveyId) || null,
    [surveys, selectedSurveyId]
  );

  const loadSurveys = async () => {
    if (!activeStoreId) {
      setSurveys([]);
      setSelectedSurveyId(null);
      return;
    }
    setIsLoading(true);
    try {
      const rows = await surveyService.listByStore(activeStoreId);
      setSurveys(rows);
      if (!selectedSurveyId && rows.length > 0) {
        setSelectedSurveyId(rows[0].id);
      }
    } catch (error) {
      console.error('[SurveyManagerView] Failed to load surveys:', error);
      addNotification('読み込みエラー', `アンケート一覧の取得に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadSurveys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStoreId]);

  useEffect(() => {
    if (!selectedSurvey) {
      setTitle('');
      setDescription('');
      setReviewRedirectUrl('');
      setPositiveThreshold(4);
      setAnalytics(null);
      return;
    }
    setTitle(selectedSurvey.title);
    setDescription(selectedSurvey.description || '');
    setReviewRedirectUrl(selectedSurvey.reviewRedirectUrl || '');
    setPositiveThreshold(selectedSurvey.positiveThreshold);
  }, [selectedSurvey]);

  useEffect(() => {
    const loadAnalytics = async () => {
      if (!selectedSurvey) {
        setAnalytics(null);
        return;
      }
      setIsLoadingAnalytics(true);
      try {
        const next = await surveyService.getAnalytics(selectedSurvey.id);
        setAnalytics(next);
      } catch (error) {
        console.error('[SurveyManagerView] Failed to load analytics:', error);
        addNotification('集計エラー', `アンケート指標の取得に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
      } finally {
        setIsLoadingAnalytics(false);
      }
    };
    void loadAnalytics();
  }, [selectedSurvey, addNotification]);

  const handleCreateDraft = async () => {
    if (!activeStoreId) {
      addNotification('店舗未選択', '店舗を選択してから作成してください。', 'WARNING');
      return;
    }
    if (!title.trim()) {
      addNotification('入力エラー', 'タイトルを入力してください。', 'WARNING');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await surveyService.createDraft({
        storeId: activeStoreId,
        authorUserId: currentUser.id,
        title: title.trim(),
        description: description.trim() || undefined,
        reviewRedirectUrl: reviewRedirectUrl.trim() || undefined,
        positiveThreshold,
      });
      addNotification('アンケート作成', '下書きを作成しました。', 'SUCCESS');
      await loadSurveys();
      setSelectedSurveyId(created.id);
    } catch (error) {
      console.error('[SurveyManagerView] Failed to create survey draft:', error);
      addNotification('作成エラー', `アンケート作成に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!selectedSurvey) {
      addNotification('選択エラー', 'アンケートを選択してください。', 'WARNING');
      return;
    }
    if (!title.trim()) {
      addNotification('入力エラー', 'タイトルを入力してください。', 'WARNING');
      return;
    }

    setIsSubmitting(true);
    try {
      await surveyService.updateDraft({
        surveyId: selectedSurvey.id,
        title: title.trim(),
        description: description.trim() || undefined,
        reviewRedirectUrl: reviewRedirectUrl.trim() || undefined,
        positiveThreshold,
      });
      addNotification('保存完了', 'アンケート下書きを更新しました。', 'SUCCESS');
      await loadSurveys();
    } catch (error) {
      console.error('[SurveyManagerView] Failed to update survey:', error);
      addNotification('保存エラー', `アンケート更新に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePublish = async () => {
    if (!selectedSurvey) {
      addNotification('選択エラー', 'アンケートを選択してください。', 'WARNING');
      return;
    }

    setIsSubmitting(true);
    try {
      const published = await surveyService.publish(selectedSurvey.id);
      addNotification('公開完了', 'アンケートを公開しました。', 'SUCCESS');
      await loadSurveys();
      const publicUrl = published.publicToken ? buildPublicSurveyUrl(published.publicToken) : null;
      if (publicUrl) {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(publicUrl);
          addNotification('公開URLコピー', '公開URLをクリップボードにコピーしました。', 'INFO');
        } else {
          addNotification('公開URL', publicUrl, 'INFO');
        }
      }
    } catch (error) {
      console.error('[SurveyManagerView] Failed to publish survey:', error);
      addNotification('公開エラー', getErrorMessage(error) || 'アンケート公開に失敗しました。', 'ERROR');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchive = async () => {
    if (!selectedSurvey) {
      addNotification('選択エラー', 'アンケートを選択してください。', 'WARNING');
      return;
    }

    setIsSubmitting(true);
    try {
      await surveyService.archive(selectedSurvey.id);
      addNotification('アーカイブ', 'アンケートをアーカイブしました。', 'INFO');
      await loadSurveys();
    } catch (error) {
      console.error('[SurveyManagerView] Failed to archive survey:', error);
      addNotification('アーカイブエラー', `アーカイブに失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyPublicUrl = async () => {
    if (!selectedSurvey?.publicToken) {
      addNotification('未公開', 'このアンケートはまだ公開されていません。', 'WARNING');
      return;
    }
    const url = buildPublicSurveyUrl(selectedSurvey.publicToken);
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
      addNotification('コピー完了', '公開URLをコピーしました。', 'SUCCESS');
      return;
    }
    addNotification('公開URL', url, 'INFO');
  };

  const handleOpenPublicUrl = () => {
    if (!selectedSurvey?.publicToken) {
      addNotification('未公開', 'このアンケートはまだ公開されていません。', 'WARNING');
      return;
    }
    window.open(buildPublicSurveyUrl(selectedSurvey.publicToken), '_blank', 'noopener,noreferrer');
  };

  const handleDownloadCsv = async () => {
    if (!selectedSurvey) {
      addNotification('選択エラー', 'アンケートを選択してください。', 'WARNING');
      return;
    }
    try {
      const csv = await surveyService.buildResponsesCsv(selectedSurvey.id);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `survey_${selectedSurvey.id}_responses.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      addNotification('CSV出力', '回答CSVをダウンロードしました。', 'SUCCESS');
    } catch (error) {
      console.error('[SurveyManagerView] Failed to download CSV:', error);
      addNotification('CSV出力エラー', `CSV出力に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    }
  };

  const handleDownloadQr = async () => {
    if (!selectedSurvey?.publicToken) {
      addNotification('未公開', '公開後にQRを生成できます。', 'WARNING');
      return;
    }
    setIsGeneratingAsset(true);
    try {
      const publicUrl = buildPublicSurveyUrl(selectedSurvey.publicToken);
      await surveyAssetService.downloadQrPng({
        publicUrl,
        surveyTitle: selectedSurvey.title,
      });
      addNotification('QR生成', '口コミ依頼QRをダウンロードしました。', 'SUCCESS');
    } catch (error) {
      console.error('[SurveyManagerView] Failed to download QR:', error);
      addNotification('QR生成エラー', `QR生成に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    } finally {
      setIsGeneratingAsset(false);
    }
  };

  const handlePrintPop = async () => {
    if (!selectedSurvey?.publicToken) {
      addNotification('未公開', '公開後にPOPを生成できます。', 'WARNING');
      return;
    }
    setIsGeneratingAsset(true);
    try {
      const publicUrl = buildPublicSurveyUrl(selectedSurvey.publicToken);
      await surveyAssetService.openPopPrintWindow({
        publicUrl,
        surveyTitle: selectedSurvey.title,
        surveyDescription: selectedSurvey.description,
        positiveThreshold: selectedSurvey.positiveThreshold,
      });
      addNotification('POP生成', '印刷画面を開きました。ブラウザの印刷でPDF保存できます。', 'INFO');
    } catch (error) {
      console.error('[SurveyManagerView] Failed to generate POP:', error);
      addNotification('POP生成エラー', `POP生成に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    } finally {
      setIsGeneratingAsset(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">アンケート管理</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          アンケートを作成して公開URLを発行します。公開中はユーザーごとに1件までです。
        </p>
      </div>

      {!activeStoreId && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-200 text-sm rounded-xl p-4">
          店舗が選択されていません。右上の店舗セレクタから選択してください。
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-800 dark:text-white">アンケート一覧</h2>
            <button
              type="button"
              onClick={() => void loadSurveys()}
              className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 rounded-lg"
            >
              再読み込み
            </button>
          </div>

          {isLoading && <p className="text-sm text-gray-500 dark:text-gray-400">読み込み中...</p>}

          <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
            {surveys.map((survey) => (
              <button
                key={survey.id}
                type="button"
                onClick={() => setSelectedSurveyId(survey.id)}
                className={`w-full text-left p-4 rounded-xl border transition-all ${
                  selectedSurveyId === survey.id
                    ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/20'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-gray-800 dark:text-white truncate">{survey.title}</p>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full ${
                      survey.status === 'PUBLISHED'
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                        : survey.status === 'DRAFT'
                          ? 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                    }`}
                  >
                    {survey.status}
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  回答数: {survey.responseCount} / 高評価しきい値: {survey.positiveThreshold} / 更新: {survey.updatedAt.toLocaleString('ja-JP')}
                </p>
              </button>
            ))}
            {!isLoading && surveys.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400">アンケートがありません。右側で作成してください。</p>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-5 space-y-5">
          <h2 className="text-lg font-bold text-gray-800 dark:text-white">作成・編集</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">タイトル</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="例: ご来店アンケート"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">説明文</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full h-24 p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="例: ご協力ありがとうございます。1分で終わる簡単アンケートです。"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                高評価時の遷移URL（任意）
              </label>
              <input
                type="url"
                value={reviewRedirectUrl}
                onChange={(e) => setReviewRedirectUrl(e.target.value)}
                className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="https://..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                高評価しきい値（この点数以上で口コミ導線）
              </label>
              <select
                value={positiveThreshold}
                onChange={(e) => setPositiveThreshold(Number(e.target.value))}
                className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value={3}>3点以上</option>
                <option value={4}>4点以上</option>
                <option value={5}>5点のみ</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleCreateDraft()}
              disabled={isSubmitting || !activeStoreId}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <PlusCircle size={16} />
              下書きを作成
            </button>

            <button
              type="button"
              onClick={() => void handleSaveDraft()}
              disabled={isSubmitting || !selectedSurvey}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-900 text-white text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Save size={16} />
              保存
            </button>

            <button
              type="button"
              onClick={() => void handlePublish()}
              disabled={isSubmitting || !selectedSurvey || selectedSurvey.status === 'PUBLISHED'}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Rocket size={16} />
              公開
            </button>

            <button
              type="button"
              onClick={() => void handleArchive()}
              disabled={isSubmitting || !selectedSurvey || selectedSurvey.status === 'ARCHIVED'}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Archive size={16} />
              アーカイブ
            </button>

            <button
              type="button"
              onClick={() => void handleDownloadCsv()}
              disabled={!selectedSurvey}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Download size={16} />
              回答CSV
            </button>
          </div>

          {selectedSurvey?.status === 'PUBLISHED' && selectedSurvey.publicToken && (
            <div className="p-4 rounded-xl border border-green-200 dark:border-green-900/40 bg-green-50 dark:bg-green-900/20">
              <p className="text-sm font-medium text-green-800 dark:text-green-300">公開URL</p>
              <p className="text-xs text-green-700 dark:text-green-300 break-all mt-1">
                {buildPublicSurveyUrl(selectedSurvey.publicToken)}
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => void handleCopyPublicUrl()}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 text-xs font-medium text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600"
                >
                  <Copy size={14} />
                  URLをコピー
                </button>
                <button
                  type="button"
                  onClick={handleOpenPublicUrl}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 text-xs font-medium text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600"
                >
                  <ExternalLink size={14} />
                  公開ページを開く
                </button>
                <button
                  type="button"
                  onClick={() => void handleDownloadQr()}
                  disabled={isGeneratingAsset}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 text-xs font-medium text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <QrCode size={14} />
                  QR画像
                </button>
                <button
                  type="button"
                  onClick={() => void handlePrintPop()}
                  disabled={isGeneratingAsset}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 text-xs font-medium text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <FileText size={14} />
                  POP印刷(PDF)
                </button>
              </div>
            </div>
          )}

          <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30">
            <h3 className="text-sm font-bold text-gray-800 dark:text-white mb-3">指標（P1-03）</h3>
            {isLoadingAnalytics && <p className="text-xs text-gray-500 dark:text-gray-400">集計中...</p>}
            {!isLoadingAnalytics && analytics && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  <p className="text-gray-500 dark:text-gray-400">閲覧数</p>
                  <p className="text-base font-bold text-gray-800 dark:text-white">{analytics.viewCount}</p>
                </div>
                <div className="p-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  <p className="text-gray-500 dark:text-gray-400">回答数</p>
                  <p className="text-base font-bold text-gray-800 dark:text-white">{analytics.responseCount}</p>
                </div>
                <div className="p-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  <p className="text-gray-500 dark:text-gray-400">回答率</p>
                  <p className="text-base font-bold text-gray-800 dark:text-white">{analytics.completionRate}%</p>
                </div>
                <div className="p-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  <p className="text-gray-500 dark:text-gray-400">高評価分岐</p>
                  <p className="text-base font-bold text-gray-800 dark:text-white">{analytics.positiveRate}% ({analytics.positiveCount})</p>
                </div>
                <div className="p-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  <p className="text-gray-500 dark:text-gray-400">不満回収分岐</p>
                  <p className="text-base font-bold text-gray-800 dark:text-white">{analytics.negativeRate}% ({analytics.negativeCount})</p>
                </div>
                <div className="p-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  <p className="text-gray-500 dark:text-gray-400">遷移クリック</p>
                  <p className="text-base font-bold text-gray-800 dark:text-white">{analytics.redirectClickCount}</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">高評価内クリック率: {analytics.redirectClickRate}%</p>
                </div>
              </div>
            )}
            {!isLoadingAnalytics && !analytics && (
              <p className="text-xs text-gray-500 dark:text-gray-400">アンケートを選択すると指標を表示します。</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
