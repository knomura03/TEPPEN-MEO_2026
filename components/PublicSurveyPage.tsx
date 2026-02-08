import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Survey } from '../types';
import { surveyService } from '../services/surveyService';
import { getErrorMessage } from '../services/errorMessage';

interface PublicSurveyPageProps {
  publicToken: string;
}

export const PublicSurveyPage: React.FC<PublicSurveyPageProps> = ({ publicToken }) => {
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rating, setRating] = useState<number>(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const hasTrackedViewRef = useRef(false);

  const shouldShowReviewLink = useMemo(() => {
    if (!survey) return false;
    return isCompleted && rating >= survey.positiveThreshold && Boolean(survey.reviewRedirectUrl);
  }, [isCompleted, rating, survey]);
  const isPositiveSelection = useMemo(() => {
    if (!survey) return false;
    return rating >= survey.positiveThreshold;
  }, [rating, survey]);

  useEffect(() => {
    const loadSurvey = async () => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const row = await surveyService.getPublishedByToken(publicToken);
        if (!row) {
          setErrorMessage('公開中のアンケートが見つかりません。URLをご確認ください。');
          return;
        }
        setSurvey(row);
      } catch (error) {
        console.error('[PublicSurveyPage] Failed to load survey:', error);
        setErrorMessage(`アンケートの読み込みに失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`);
      } finally {
        setIsLoading(false);
      }
    };
    void loadSurvey();
  }, [publicToken]);

  useEffect(() => {
    if (!survey || hasTrackedViewRef.current) return;
    hasTrackedViewRef.current = true;
    void surveyService.trackPublicEvent({
      surveyId: survey.id,
      eventType: 'VIEW',
      metadata: { public_token: publicToken },
    });
  }, [survey, publicToken]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!survey) return;
    if (rating < 1 || rating > 5) {
      setErrorMessage('星評価（1〜5）を選択してください。');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await surveyService.submitResponse({
        surveyId: survey.id,
        rating,
        branchType: rating >= survey.positiveThreshold ? 'POSITIVE' : 'NEGATIVE',
        comment: comment.trim() || undefined,
      });
      setIsCompleted(true);
      if (rating >= survey.positiveThreshold && survey.reviewRedirectUrl) {
        void surveyService.trackPublicEvent({
          surveyId: survey.id,
          eventType: 'REDIRECT_CLICK',
          metadata: { source: 'auto' },
        });
        window.setTimeout(() => {
          window.location.assign(survey.reviewRedirectUrl!);
        }, 1500);
      }
    } catch (error) {
      console.error('[PublicSurveyPage] Failed to submit response:', error);
      setErrorMessage(`回答の送信に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-6">
        <div className="text-center space-y-3">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600 mx-auto"></div>
          <p className="text-sm text-gray-500 dark:text-gray-400">アンケートを読み込み中...</p>
        </div>
      </div>
    );
  }

  if (!survey || errorMessage) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-lg w-full bg-white dark:bg-gray-800 border border-red-200 dark:border-red-900/50 rounded-2xl p-6">
          <h1 className="text-lg font-bold text-red-700 dark:text-red-300">アンケートを表示できません</h1>
          <p className="text-sm text-red-700 dark:text-red-300 mt-2">{errorMessage || 'アンケートが見つかりません。'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6 md:p-10">
      <div className="max-w-2xl mx-auto bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl shadow-sm p-6 md:p-8">
        {!isCompleted ? (
          <>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-white">{survey.title}</h1>
            {survey.description && (
              <p className="mt-3 text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{survey.description}</p>
            )}

            <form onSubmit={handleSubmit} className="space-y-6 mt-8">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  総合満足度を教えてください（1〜5）
                </label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setRating(value)}
                      className={`w-12 h-12 rounded-xl border text-sm font-bold transition-all ${
                        rating === value
                          ? 'bg-primary-600 text-white border-primary-600'
                          : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                {rating > 0 && (
                  <p className="text-xs mt-2 text-gray-500 dark:text-gray-400">
                    {isPositiveSelection
                      ? `この評価は高評価導線（${survey.positiveThreshold}点以上）です。回答後に口コミページをご案内します。`
                      : `この評価は不満回収導線（${survey.positiveThreshold - 1}点以下）です。改善のためご意見をお聞かせください。`}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">ご意見（任意）</label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  className="w-full h-28 p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="気になる点や改善してほしい点があればご記入ください。"
                />
              </div>

              {errorMessage && (
                <div className="text-sm text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-xl p-3">
                  {errorMessage}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 rounded-xl bg-primary-600 hover:bg-primary-700 text-white font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSubmitting ? '送信中...' : '回答を送信する'}
              </button>
            </form>
          </>
        ) : (
          <div className="space-y-4">
            <h1 className="text-2xl font-bold text-gray-800 dark:text-white">ご回答ありがとうございました</h1>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              貴重なご意見をありがとうございます。今後のサービス改善に活用します。
            </p>
            {shouldShowReviewLink && survey.reviewRedirectUrl ? (
              <>
                <p className="text-sm text-green-700 dark:text-green-300">
                  口コミページへ自動で移動します。移動しない場合は下のボタンを押してください。
                </p>
                <a
                  href={survey.reviewRedirectUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    void surveyService.trackPublicEvent({
                      surveyId: survey.id,
                      eventType: 'REDIRECT_CLICK',
                      metadata: { source: 'manual' },
                    });
                  }}
                  className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white font-medium"
                >
                  Google口コミページへ進む
                </a>
              </>
            ) : (
              <p className="text-sm text-gray-600 dark:text-gray-300">
                頂いたご意見は店舗改善の優先タスクとして確認します。
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
