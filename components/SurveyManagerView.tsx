import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SurveyAnalytics, User, Survey } from '../types';
import { useStore } from '../contexts/StoreContext';
import { useNotification } from '../contexts/NotificationContext';
import { buildPublicSurveyUrl, surveyService } from '../services/surveyService';
import { surveyAssetService } from '../services/surveyAssetService';
import { surveyMediaService } from '../services/surveyMediaService';
import { DEFAULT_SURVEY_COPY } from '../services/surveyCopy';
import { getErrorMessage } from '../services/errorMessage';
import { PlusCircle, Save, Rocket, Archive, Copy, ExternalLink, Download, QrCode, FileText } from 'lucide-react';
import { PAGE_CARD_PADDED_CLASS, PAGE_CONTAINER_CLASS, PAGE_HEADER_DESCRIPTION_CLASS, PAGE_HEADER_TITLE_CLASS, PAGE_WARNING_CLASS } from './ui/pageLayout';

interface SurveyManagerViewProps {
  currentUser: User;
}

type HeaderImageMode = 'NONE' | 'UPLOAD' | 'URL';

const MAX_HEADER_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED_HEADER_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const trimToUndefined = (value: string): string | undefined => {
  const normalized = value.trim();
  return normalized ? normalized : undefined;
};

const isHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

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
  const [questionText, setQuestionText] = useState('');
  const [thanksTitle, setThanksTitle] = useState('');
  const [thanksBody, setThanksBody] = useState('');
  const [thanksPositiveMessage, setThanksPositiveMessage] = useState('');
  const [thanksNegativeMessage, setThanksNegativeMessage] = useState('');
  const [thanksButtonText, setThanksButtonText] = useState('');
  const [headerImageMode, setHeaderImageMode] = useState<HeaderImageMode>('NONE');
  const [headerImageUrlInput, setHeaderImageUrlInput] = useState('');
  const [headerImagePreviewUrl, setHeaderImagePreviewUrl] = useState('');
  const [headerImageFile, setHeaderImageFile] = useState<File | null>(null);
  const [positiveThreshold, setPositiveThreshold] = useState(4);
  const [analytics, setAnalytics] = useState<SurveyAnalytics | null>(null);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);
  const [isGeneratingAsset, setIsGeneratingAsset] = useState(false);
  const headerImageObjectUrlRef = useRef<string | null>(null);
  const getSurveyStatusLabel = (status: Survey['status']) => {
    if (status === 'PUBLISHED') return '公開中';
    if (status === 'DRAFT') return '下書き';
    return 'アーカイブ';
  };

  const selectedSurvey = useMemo(
    () => surveys.find((survey) => survey.id === selectedSurveyId) || null,
    [surveys, selectedSurveyId]
  );

  const clearObjectPreviewUrl = () => {
    if (headerImageObjectUrlRef.current) {
      URL.revokeObjectURL(headerImageObjectUrlRef.current);
      headerImageObjectUrlRef.current = null;
    }
  };

  const setPreviewWithFile = (file: File) => {
    clearObjectPreviewUrl();
    const nextObjectUrl = URL.createObjectURL(file);
    headerImageObjectUrlRef.current = nextObjectUrl;
    setHeaderImagePreviewUrl(nextObjectUrl);
  };

  const buildDraftPayload = (overrides?: {
    headerImageUrl?: string;
    headerImageStoragePath?: string;
  }) => {
    return {
      title: title.trim(),
      description: trimToUndefined(description),
      reviewRedirectUrl: trimToUndefined(reviewRedirectUrl),
      questionText: trimToUndefined(questionText),
      thanksTitle: trimToUndefined(thanksTitle),
      thanksBody: trimToUndefined(thanksBody),
      thanksPositiveMessage: trimToUndefined(thanksPositiveMessage),
      thanksNegativeMessage: trimToUndefined(thanksNegativeMessage),
      thanksButtonText: trimToUndefined(thanksButtonText),
      positiveThreshold,
      headerImageUrl: overrides?.headerImageUrl,
      headerImageStoragePath: overrides?.headerImageStoragePath,
    };
  };

  const resolveStaticImagePreference = (): { headerImageUrl?: string; headerImageStoragePath?: string } | null => {
    if (headerImageMode === 'NONE') {
      return { headerImageUrl: undefined, headerImageStoragePath: undefined };
    }
    if (headerImageMode === 'URL') {
      const normalizedUrl = trimToUndefined(headerImageUrlInput);
      if (!normalizedUrl) {
        addNotification('入力エラー', 'ヘッダー画像URLを入力してください。', 'WARNING');
        return null;
      }
      if (!isHttpUrl(normalizedUrl)) {
        addNotification('入力エラー', 'ヘッダー画像URLは http:// または https:// で入力してください。', 'WARNING');
        return null;
      }
      return { headerImageUrl: normalizedUrl, headerImageStoragePath: undefined };
    }
    if (!selectedSurvey?.headerImageStoragePath && !headerImageFile) {
      addNotification('入力エラー', 'アップロード画像を選択してください。', 'WARNING');
      return null;
    }
    return {
      headerImageUrl: selectedSurvey?.headerImageUrl,
      headerImageStoragePath: selectedSurvey?.headerImageStoragePath,
    };
  };

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
      clearObjectPreviewUrl();
      setTitle('');
      setDescription('');
      setReviewRedirectUrl('');
      setQuestionText('');
      setThanksTitle('');
      setThanksBody('');
      setThanksPositiveMessage('');
      setThanksNegativeMessage('');
      setThanksButtonText('');
      setHeaderImageMode('NONE');
      setHeaderImageUrlInput('');
      setHeaderImagePreviewUrl('');
      setHeaderImageFile(null);
      setPositiveThreshold(4);
      setAnalytics(null);
      return;
    }
    clearObjectPreviewUrl();
    setTitle(selectedSurvey.title);
    setDescription(selectedSurvey.description || '');
    setReviewRedirectUrl(selectedSurvey.reviewRedirectUrl || '');
    setQuestionText(selectedSurvey.questionText || '');
    setThanksTitle(selectedSurvey.thanksTitle || '');
    setThanksBody(selectedSurvey.thanksBody || '');
    setThanksPositiveMessage(selectedSurvey.thanksPositiveMessage || '');
    setThanksNegativeMessage(selectedSurvey.thanksNegativeMessage || '');
    setThanksButtonText(selectedSurvey.thanksButtonText || '');
    if (selectedSurvey.headerImageStoragePath && selectedSurvey.headerImageUrl) {
      setHeaderImageMode('UPLOAD');
      setHeaderImageUrlInput('');
      setHeaderImagePreviewUrl(selectedSurvey.headerImageUrl);
    } else if (selectedSurvey.headerImageUrl) {
      setHeaderImageMode('URL');
      setHeaderImageUrlInput(selectedSurvey.headerImageUrl);
      setHeaderImagePreviewUrl(selectedSurvey.headerImageUrl);
    } else {
      setHeaderImageMode('NONE');
      setHeaderImageUrlInput('');
      setHeaderImagePreviewUrl('');
    }
    setHeaderImageFile(null);
    setPositiveThreshold(selectedSurvey.positiveThreshold);
  }, [selectedSurvey]);

  useEffect(() => {
    return () => {
      clearObjectPreviewUrl();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const handleChangeHeaderImageMode = (mode: HeaderImageMode) => {
    setHeaderImageMode(mode);
    setHeaderImageFile(null);
    clearObjectPreviewUrl();

    if (mode === 'NONE') {
      setHeaderImageUrlInput('');
      setHeaderImagePreviewUrl('');
      return;
    }
    if (mode === 'URL') {
      const currentUrl = selectedSurvey?.headerImageStoragePath ? '' : (selectedSurvey?.headerImageUrl || '');
      setHeaderImageUrlInput(currentUrl);
      setHeaderImagePreviewUrl(currentUrl);
      return;
    }
    setHeaderImageUrlInput('');
    setHeaderImagePreviewUrl(selectedSurvey?.headerImageStoragePath ? (selectedSurvey.headerImageUrl || '') : '');
  };

  const handleSelectHeaderImageFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_HEADER_IMAGE_TYPES.has(file.type)) {
      addNotification('入力エラー', 'ヘッダー画像は JPEG / PNG / WEBP のみ対応です。', 'WARNING');
      event.currentTarget.value = '';
      return;
    }
    if (file.size > MAX_HEADER_IMAGE_BYTES) {
      addNotification('入力エラー', 'ヘッダー画像は3MB以下にしてください。', 'WARNING');
      event.currentTarget.value = '';
      return;
    }

    setHeaderImageMode('UPLOAD');
    setHeaderImageFile(file);
    setPreviewWithFile(file);
    event.currentTarget.value = '';
  };

  const handleCreateDraft = async () => {
    if (!activeStoreId) {
      addNotification('店舗未選択', '店舗を選択してから作成してください。', 'WARNING');
      return;
    }
    if (!title.trim()) {
      addNotification('入力エラー', 'タイトルを入力してください。', 'WARNING');
      return;
    }

    let initialImagePayload: { headerImageUrl?: string; headerImageStoragePath?: string } = {
      headerImageUrl: undefined,
      headerImageStoragePath: undefined,
    };
    if (headerImageMode === 'URL') {
      const normalizedUrl = trimToUndefined(headerImageUrlInput);
      if (!normalizedUrl) {
        addNotification('入力エラー', 'ヘッダー画像URLを入力してください。', 'WARNING');
        return;
      }
      if (!isHttpUrl(normalizedUrl)) {
        addNotification('入力エラー', 'ヘッダー画像URLは http:// または https:// で入力してください。', 'WARNING');
        return;
      }
      initialImagePayload = { headerImageUrl: normalizedUrl, headerImageStoragePath: undefined };
    } else if (headerImageMode === 'UPLOAD' && !headerImageFile) {
      addNotification('入力エラー', 'アップロード画像を選択してください。', 'WARNING');
      return;
    }

    setIsSubmitting(true);
    try {
      let created = await surveyService.createDraft({
        storeId: activeStoreId,
        authorUserId: currentUser.id,
        ...buildDraftPayload(initialImagePayload),
      });

      if (headerImageMode === 'UPLOAD' && headerImageFile) {
        const uploaded = await surveyMediaService.uploadHeaderImage({
          storeId: activeStoreId,
          surveyId: created.id,
          file: headerImageFile,
        });
        try {
          created = await surveyService.updateDraft({
            surveyId: created.id,
            ...buildDraftPayload({
              headerImageUrl: uploaded.publicUrl,
              headerImageStoragePath: uploaded.storagePath,
            }),
          });
        } catch (updateError) {
          try {
            await surveyMediaService.deleteHeaderImage(uploaded.storagePath);
          } catch {
            // ignore
          }
          throw updateError;
        }
        clearObjectPreviewUrl();
        setHeaderImageFile(null);
        setHeaderImagePreviewUrl(uploaded.publicUrl);
      }

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

    const existingStoragePath = selectedSurvey.headerImageStoragePath;
    let staticImagePreference = resolveStaticImagePreference();
    if (headerImageMode === 'UPLOAD' && headerImageFile) {
      staticImagePreference = {
        headerImageUrl: selectedSurvey.headerImageUrl,
        headerImageStoragePath: selectedSurvey.headerImageStoragePath,
      };
    }
    if (!staticImagePreference) {
      return;
    }

    setIsSubmitting(true);
    try {
      let updated = await surveyService.updateDraft({
        surveyId: selectedSurvey.id,
        ...buildDraftPayload(staticImagePreference),
      });

      if (headerImageMode === 'UPLOAD' && headerImageFile) {
        const uploaded = await surveyMediaService.uploadHeaderImage({
          storeId: selectedSurvey.storeId,
          surveyId: selectedSurvey.id,
          file: headerImageFile,
        });
        try {
          updated = await surveyService.updateDraft({
            surveyId: selectedSurvey.id,
            ...buildDraftPayload({
              headerImageUrl: uploaded.publicUrl,
              headerImageStoragePath: uploaded.storagePath,
            }),
          });
        } catch (updateError) {
          try {
            await surveyMediaService.deleteHeaderImage(uploaded.storagePath);
          } catch {
            // ignore
          }
          throw updateError;
        }

        if (existingStoragePath && existingStoragePath !== uploaded.storagePath) {
          try {
            await surveyMediaService.deleteHeaderImage(existingStoragePath);
          } catch (deleteError) {
            addNotification('画像削除警告', `旧ヘッダー画像の削除に失敗しました。${getErrorMessage(deleteError) ? `（${getErrorMessage(deleteError)}）` : ''}`, 'WARNING');
          }
        }
        clearObjectPreviewUrl();
        setHeaderImageFile(null);
        setHeaderImagePreviewUrl(uploaded.publicUrl);
      } else if ((headerImageMode === 'NONE' || headerImageMode === 'URL') && existingStoragePath) {
        try {
          await surveyMediaService.deleteHeaderImage(existingStoragePath);
        } catch (deleteError) {
          addNotification('画像削除警告', `旧ヘッダー画像の削除に失敗しました。${getErrorMessage(deleteError) ? `（${getErrorMessage(deleteError)}）` : ''}`, 'WARNING');
        }
      }

      addNotification('保存完了', 'アンケート下書きを更新しました。', 'SUCCESS');
      await loadSurveys();
      setSelectedSurveyId(updated.id);
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
    <div className={PAGE_CONTAINER_CLASS}>
      <div>
        <h1 className={PAGE_HEADER_TITLE_CLASS}>アンケート</h1>
        <p className={PAGE_HEADER_DESCRIPTION_CLASS}>
          アンケートを作成して公開URLを発行します。公開中はユーザーごとに1件までです。
        </p>
      </div>

      {!activeStoreId && (
        <div className={PAGE_WARNING_CLASS}>
          店舗が選択されていません。右上の店舗セレクタから選択してください。
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div id="survey-list-panel" className={`${PAGE_CARD_PADDED_CLASS} space-y-4`}>
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
                data-testid="survey-list-item"
                data-survey-id={survey.id}
                data-survey-status={survey.status}
                data-survey-title={survey.title}
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
                    {getSurveyStatusLabel(survey.status)}
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  回答数: {survey.responseCount} / 口コミ案内の基準点: {survey.positiveThreshold}点 / 更新: {survey.updatedAt.toLocaleString('ja-JP')}
                </p>
              </button>
            ))}
            {!isLoading && surveys.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400">アンケートがありません。右側で作成してください。</p>
            )}
          </div>
        </div>

        <div id="survey-editor-panel" className={`${PAGE_CARD_PADDED_CLASS} space-y-5`}>
          <h2 className="text-lg font-bold text-gray-800 dark:text-white">作成・編集</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">タイトル</label>
              <input
                data-testid="survey-title"
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
                口コミ案内の基準点（この点数以上で案内）
              </label>
              <select
                data-testid="survey-positive-threshold"
                value={positiveThreshold}
                onChange={(e) => setPositiveThreshold(Number(e.target.value))}
                className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value={3}>3点以上</option>
                <option value={4}>4点以上</option>
                <option value={5}>5点のみ</option>
              </select>
            </div>

            <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">ヘッダー画像（1枚）</label>
                <select
                  value={headerImageMode}
                  onChange={(e) => handleChangeHeaderImageMode(e.target.value as HeaderImageMode)}
                  className="w-full p-2.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="NONE">画像なし</option>
                  <option value="UPLOAD">画像をアップロード</option>
                  <option value="URL">画像URLを指定</option>
                </select>
              </div>

              {headerImageMode === 'UPLOAD' && (
                <div>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleSelectHeaderImageFile}
                    className="w-full text-sm text-gray-700 dark:text-gray-300 file:mr-3 file:px-3 file:py-2 file:border-0 file:rounded-lg file:bg-primary-100 file:text-primary-700 dark:file:bg-primary-900/40 dark:file:text-primary-200"
                  />
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">対応形式: JPEG/PNG/WEBP（3MB以下）</p>
                </div>
              )}

              {headerImageMode === 'URL' && (
                <div>
                  <input
                    type="url"
                    value={headerImageUrlInput}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      setHeaderImageUrlInput(nextValue);
                      setHeaderImagePreviewUrl(nextValue.trim());
                    }}
                    placeholder="https://..."
                    className="w-full p-2.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              )}

              {headerImagePreviewUrl && (
                <div className="space-y-2">
                  <img
                    src={headerImagePreviewUrl}
                    alt="ヘッダー画像プレビュー"
                    className="w-full max-h-44 object-cover rounded-xl border border-gray-200 dark:border-gray-700 bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => handleChangeHeaderImageMode('NONE')}
                    className="px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 rounded-lg"
                  >
                    画像を外す（保存時に反映）
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">設問文言</label>
              <input
                value={questionText}
                onChange={(e) => setQuestionText(e.target.value)}
                className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl outline-none focus:ring-2 focus:ring-primary-500"
                placeholder={DEFAULT_SURVEY_COPY.questionText}
              />
            </div>

            <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 space-y-3">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">サンクスページ文言</p>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">タイトル</label>
                <input
                  value={thanksTitle}
                  onChange={(e) => setThanksTitle(e.target.value)}
                  className="w-full p-2.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder={DEFAULT_SURVEY_COPY.thanksTitle}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">本文（共通）</label>
                <textarea
                  value={thanksBody}
                  onChange={(e) => setThanksBody(e.target.value)}
                  className="w-full h-20 p-2.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder={DEFAULT_SURVEY_COPY.thanksBody}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">高評価時メッセージ</label>
                <textarea
                  value={thanksPositiveMessage}
                  onChange={(e) => setThanksPositiveMessage(e.target.value)}
                  className="w-full h-20 p-2.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder={DEFAULT_SURVEY_COPY.thanksPositiveMessage}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">低評価時メッセージ</label>
                <textarea
                  value={thanksNegativeMessage}
                  onChange={(e) => setThanksNegativeMessage(e.target.value)}
                  className="w-full h-20 p-2.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder={DEFAULT_SURVEY_COPY.thanksNegativeMessage}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">高評価時ボタン文言</label>
                <input
                  value={thanksButtonText}
                  onChange={(e) => setThanksButtonText(e.target.value)}
                  className="w-full p-2.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder={DEFAULT_SURVEY_COPY.thanksButtonText}
                />
              </div>
            </div>
          </div>

          <div id="survey-action-buttons" className="flex flex-wrap gap-2">
            <button
              data-testid="survey-create-draft"
              type="button"
              onClick={() => void handleCreateDraft()}
              disabled={isSubmitting || !activeStoreId}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <PlusCircle size={16} />
              下書きを作成
            </button>

            <button
              data-testid="survey-save-draft"
              type="button"
              onClick={() => void handleSaveDraft()}
              disabled={isSubmitting || !selectedSurvey}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-900 text-white text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Save size={16} />
              保存
            </button>

            <button
              data-testid="survey-publish"
              type="button"
              onClick={() => void handlePublish()}
              disabled={isSubmitting || !selectedSurvey || selectedSurvey.status === 'PUBLISHED'}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Rocket size={16} />
              公開
            </button>

            <button
              data-testid="survey-archive"
              type="button"
              onClick={() => void handleArchive()}
              disabled={isSubmitting || !selectedSurvey || selectedSurvey.status === 'ARCHIVED'}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Archive size={16} />
              アーカイブ
            </button>

            <button
              data-testid="survey-download-csv"
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
            <div id="survey-public-assets" className="p-4 rounded-xl border border-green-200 dark:border-green-900/40 bg-green-50 dark:bg-green-900/20">
              <p className="text-sm font-medium text-green-800 dark:text-green-300">公開URL</p>
              <p
                data-testid="survey-public-url"
                className="text-xs text-green-700 dark:text-green-300 break-all mt-1"
              >
                {buildPublicSurveyUrl(selectedSurvey.publicToken)}
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  data-testid="survey-copy-public-url"
                  type="button"
                  onClick={() => void handleCopyPublicUrl()}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 text-xs font-medium text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600"
                >
                  <Copy size={14} />
                  URLをコピー
                </button>
                <button
                  data-testid="survey-open-public-url"
                  type="button"
                  onClick={handleOpenPublicUrl}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 text-xs font-medium text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600"
                >
                  <ExternalLink size={14} />
                  公開ページを開く
                </button>
                <button
                  data-testid="survey-download-qr"
                  type="button"
                  onClick={() => void handleDownloadQr()}
                  disabled={isGeneratingAsset}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 text-xs font-medium text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <QrCode size={14} />
                  QR画像
                </button>
                <button
                  data-testid="survey-print-pop"
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

          <div id="survey-analytics-panel" className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30">
            <h3 className="text-sm font-bold text-gray-800 dark:text-white mb-3">回答の集計</h3>
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
                  <p className="text-gray-500 dark:text-gray-400">高評価ルート</p>
                  <p className="text-base font-bold text-gray-800 dark:text-white">{analytics.positiveRate}% ({analytics.positiveCount})</p>
                </div>
                <div className="p-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  <p className="text-gray-500 dark:text-gray-400">改善ルート</p>
                  <p className="text-base font-bold text-gray-800 dark:text-white">{analytics.negativeRate}% ({analytics.negativeCount})</p>
                </div>
                <div className="p-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  <p className="text-gray-500 dark:text-gray-400">遷移クリック</p>
                  <p className="text-base font-bold text-gray-800 dark:text-white">{analytics.redirectClickCount}</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">高評価ルート内クリック率: {analytics.redirectClickRate}%</p>
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
