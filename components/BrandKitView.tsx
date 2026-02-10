import React, { useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { User } from '../types';
import { useStore } from '../contexts/StoreContext';
import { useNotification } from '../contexts/NotificationContext';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { brandKitService } from '../services/brandKitService';
import { getErrorMessage } from '../services/errorMessage';
import {
  PAGE_CARD_PADDED_CLASS,
  PAGE_CONTAINER_CLASS,
  PAGE_HEADER_DESCRIPTION_CLASS,
  PAGE_HEADER_TITLE_CLASS,
  PAGE_SECTION_DESCRIPTION_CLASS,
  PAGE_SECTION_TITLE_CLASS,
  PAGE_WARNING_CLASS,
} from './ui/pageLayout';

interface BrandKitViewProps {
  currentUser: User;
}

export const BrandKitView: React.FC<BrandKitViewProps> = ({ currentUser }) => {
  const { stores, activeStoreId } = useStore();
  const { addNotification } = useNotification();
  const [toneGuideInput, setToneGuideInput] = useState('');
  const [bannedWordsInput, setBannedWordsInput] = useState('');
  const [recommendedHashtagsInput, setRecommendedHashtagsInput] = useState('');
  const [signatureInput, setSignatureInput] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const activeOrgId = useMemo(() => {
    if (!activeStoreId) return null;
    const store = stores.find((item) => item.id === activeStoreId);
    return store?.orgId || null;
  }, [activeStoreId, stores]);

  useEffect(() => {
    const load = async () => {
      if (!isSupabaseConfigured || !activeOrgId) {
        setToneGuideInput('');
        setBannedWordsInput('');
        setRecommendedHashtagsInput('');
        setSignatureInput('');
        setLastUpdatedAt(null);
        return;
      }
      setIsLoading(true);
      try {
        const kit = await brandKitService.getBrandKit(activeOrgId);
        setToneGuideInput(kit?.toneGuide || '');
        setBannedWordsInput((kit?.bannedWords || []).join(', '));
        setRecommendedHashtagsInput((kit?.recommendedHashtags || []).join(', '));
        setSignatureInput(kit?.defaultSignature || '');
        setLastUpdatedAt(kit?.updatedAt || null);
      } catch (error) {
        addNotification('読み込みエラー', `ブランドキットを取得できませんでした。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [activeOrgId, addNotification]);

  const handleSave = async () => {
    if (!isSupabaseConfigured) {
      addNotification('未設定', 'Supabase未設定のため保存できません。', 'WARNING');
      return;
    }
    if (!activeOrgId) {
      addNotification('店舗未選択', '右上の店舗セレクタで店舗を選択してください。', 'WARNING');
      return;
    }

    setIsSaving(true);
    try {
      const updated = await brandKitService.upsertBrandKit({
        orgId: activeOrgId,
        toneGuide: toneGuideInput,
        bannedWords: brandKitService.parseListInput(bannedWordsInput),
        recommendedHashtags: brandKitService.parseListInput(recommendedHashtagsInput),
        defaultSignature: signatureInput,
        updatedBy: currentUser.id,
      });
      setLastUpdatedAt(updated.updatedAt || null);
      addNotification('保存完了', 'ブランドキットを保存しました。', 'SUCCESS');
    } catch (error) {
      addNotification('保存エラー', `ブランドキットの保存に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={PAGE_CONTAINER_CLASS}>
      <section>
        <h1 className={PAGE_HEADER_TITLE_CLASS}>ブランドキット</h1>
        <p className={PAGE_HEADER_DESCRIPTION_CLASS}>投稿文の表現ルール（口調・NGワード・推奨ハッシュタグ・署名）を管理します。</p>
      </section>

      {!isSupabaseConfigured && (
        <div className={PAGE_WARNING_CLASS}>Supabase未設定のため、ブランドキットの保存はできません。</div>
      )}
      {isSupabaseConfigured && !activeOrgId && (
        <div className={PAGE_WARNING_CLASS}>店舗が未選択です。右上の店舗セレクタで店舗を選択してください。</div>
      )}

      <section id="brand-kit-main" className={PAGE_CARD_PADDED_CLASS}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className={PAGE_SECTION_TITLE_CLASS}>投稿ルール</h2>
            <p className={PAGE_SECTION_DESCRIPTION_CLASS}>入力した内容は、同じ組織の投稿作成画面で共通利用されます。</p>
          </div>
          {isLoading && <span className="text-xs text-gray-500 dark:text-gray-400">読み込み中...</span>}
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="brandkit-tone-guide" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">口調ルール</label>
            <textarea
              id="brandkit-tone-guide"
              data-testid="brandkit-tone-guide"
              value={toneGuideInput}
              onChange={(e) => setToneGuideInput(e.target.value)}
              rows={3}
              placeholder="例: 誠実・端的・過度な煽り禁止"
              className="w-full p-2.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg"
            />
          </div>

          <div>
            <label htmlFor="brandkit-banned-words" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">使わない言葉（カンマ/改行区切り）</label>
            <textarea
              id="brandkit-banned-words"
              data-testid="brandkit-banned-words"
              value={bannedWordsInput}
              onChange={(e) => setBannedWordsInput(e.target.value)}
              rows={3}
              placeholder="例: 絶対, 100%保証"
              className="w-full p-2.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg"
            />
          </div>

          <div>
            <label htmlFor="brandkit-recommended-hashtags" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">推奨ハッシュタグ（カンマ/改行区切り）</label>
            <textarea
              id="brandkit-recommended-hashtags"
              data-testid="brandkit-recommended-hashtags"
              value={recommendedHashtagsInput}
              onChange={(e) => setRecommendedHashtagsInput(e.target.value)}
              rows={3}
              placeholder="例: #TEPPENMEO, #地域名グルメ"
              className="w-full p-2.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg"
            />
          </div>

          <div>
            <label htmlFor="brandkit-signature" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">定型署名</label>
            <textarea
              id="brandkit-signature"
              data-testid="brandkit-signature"
              value={signatureInput}
              onChange={(e) => setSignatureInput(e.target.value)}
              rows={2}
              placeholder="例: ご来店を心よりお待ちしております。"
              className="w-full p-2.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 mt-6">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            最終更新: {lastUpdatedAt ? lastUpdatedAt.toLocaleString('ja-JP') : '-'}
          </p>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving || !isSupabaseConfigured || !activeOrgId}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Save size={16} />
            {isSaving ? '保存中...' : '保存する'}
          </button>
        </div>
      </section>
    </div>
  );
};
