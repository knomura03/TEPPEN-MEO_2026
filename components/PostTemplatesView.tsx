import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { PostContentTemplate, SocialPlatform, User } from '../types';
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
import { SocialPlatformBadge } from './ui/SocialPlatformLogo';
import { formatViewLabel } from './ui/formatters';

interface PostTemplatesViewProps {
  currentUser: User;
}

const PLATFORM_OPTIONS: SocialPlatform[] = ['INSTAGRAM', 'FACEBOOK', 'GOOGLE_BUSINESS'];

export const PostTemplatesView: React.FC<PostTemplatesViewProps> = ({ currentUser }) => {
  const { stores, activeStoreId } = useStore();
  const { addNotification } = useNotification();
  const [templates, setTemplates] = useState<PostContentTemplate[]>([]);
  const [titleInput, setTitleInput] = useState('');
  const [bodyInput, setBodyInput] = useState('');
  const [platforms, setPlatforms] = useState<SocialPlatform[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [removingTemplateId, setRemovingTemplateId] = useState<string | null>(null);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [isBulkRemoving, setIsBulkRemoving] = useState(false);

  const activeOrgId = useMemo(() => {
    if (!activeStoreId) return null;
    const store = stores.find((item) => item.id === activeStoreId);
    return store?.orgId || null;
  }, [activeStoreId, stores]);

  useEffect(() => {
    const load = async () => {
      if (!isSupabaseConfigured || !activeOrgId) {
        setTemplates([]);
        return;
      }
      setIsLoading(true);
      try {
        const rows = await brandKitService.listTemplates(activeOrgId);
        setTemplates(rows);
      } catch (error) {
        addNotification('読み込みエラー', `投稿テンプレートを取得できませんでした。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [activeOrgId, addNotification]);

  const togglePlatform = (platform: SocialPlatform) => {
    setPlatforms((prev) => (
      prev.includes(platform) ? prev.filter((value) => value !== platform) : [...prev, platform]
    ));
  };

  const handleCreate = async () => {
    if (!isSupabaseConfigured) {
      addNotification('未設定', 'Supabase未設定のため作成できません。', 'WARNING');
      return;
    }
    if (!activeOrgId) {
      addNotification('店舗未選択', '右上の店舗セレクタで店舗を選択してください。', 'WARNING');
      return;
    }
    if (!titleInput.trim() || !bodyInput.trim()) {
      addNotification('入力エラー', 'テンプレート名と本文を入力してください。', 'WARNING');
      return;
    }

    setIsCreating(true);
    try {
      const created = await brandKitService.createTemplate({
        orgId: activeOrgId,
        title: titleInput.trim(),
        body: bodyInput.trim(),
        defaultPlatforms: Array.from(new Set(platforms)),
        createdBy: currentUser.id,
      });
      setTemplates((prev) => [created, ...prev]);
      setTitleInput('');
      setBodyInput('');
      setPlatforms([]);
      addNotification('作成完了', '投稿テンプレートを作成しました。', 'SUCCESS');
    } catch (error) {
      addNotification('作成エラー', `投稿テンプレートの作成に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    } finally {
      setIsCreating(false);
    }
  };

  useEffect(() => {
    const available = new Set(templates.map((template) => template.id));
    setSelectedTemplateIds((prev) => prev.filter((id) => available.has(id)));
  }, [templates]);

  const toggleTemplateSelection = (templateId: string) => {
    setSelectedTemplateIds((prev) => (
      prev.includes(templateId)
        ? prev.filter((id) => id !== templateId)
        : [...prev, templateId]
    ));
  };

  const toggleSelectAllTemplates = () => {
    if (templates.length === 0) {
      setSelectedTemplateIds([]);
      return;
    }
    setSelectedTemplateIds((prev) => (
      prev.length === templates.length ? [] : templates.map((template) => template.id)
    ));
  };

  const handleRemove = async (templateId: string) => {
    setRemovingTemplateId(templateId);
    try {
      await brandKitService.removeTemplate(templateId);
      setTemplates((prev) => prev.filter((template) => template.id !== templateId));
      addNotification('削除完了', '投稿テンプレートを削除しました。', 'INFO');
    } catch (error) {
      addNotification('削除エラー', `投稿テンプレートの削除に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    } finally {
      setRemovingTemplateId(null);
    }
  };

  const handleBulkRemove = async () => {
    if (selectedTemplateIds.length === 0) {
      addNotification('選択エラー', '削除対象のテンプレートを選択してください。', 'WARNING');
      return;
    }
    if (!window.confirm(`選択した ${selectedTemplateIds.length} 件のテンプレートを削除しますか？`)) {
      return;
    }

    setIsBulkRemoving(true);
    try {
      await brandKitService.removeTemplates(selectedTemplateIds);
      setTemplates((prev) => prev.filter((template) => !selectedTemplateIds.includes(template.id)));
      setSelectedTemplateIds([]);
      addNotification('一括削除完了', `${selectedTemplateIds.length} 件の投稿テンプレートを削除しました。`, 'SUCCESS');
    } catch (error) {
      addNotification('一括削除エラー', `投稿テンプレートの一括削除に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    } finally {
      setIsBulkRemoving(false);
    }
  };

  return (
    <div className={PAGE_CONTAINER_CLASS}>
      <section>
        <h1 className={PAGE_HEADER_TITLE_CLASS}>{formatViewLabel('POST_TEMPLATES')}</h1>
        <p className={PAGE_HEADER_DESCRIPTION_CLASS}>よく使う投稿文を登録して、投稿作成時にすばやく呼び出せます。</p>
      </section>

      {!isSupabaseConfigured && (
        <div className={PAGE_WARNING_CLASS}>Supabase未設定のため、投稿テンプレートの保存はできません。</div>
      )}
      {isSupabaseConfigured && !activeOrgId && (
        <div className={PAGE_WARNING_CLASS}>店舗が未選択です。右上の店舗セレクタで店舗を選択してください。</div>
      )}

      <section id="post-templates-main" className={`${PAGE_CARD_PADDED_CLASS} space-y-4`}>
        <div>
          <h2 className={PAGE_SECTION_TITLE_CLASS}>テンプレートを作成</h2>
          <p className={PAGE_SECTION_DESCRIPTION_CLASS}>作成したテンプレートは新規投稿画面に表示されます。</p>
        </div>

        <div className="space-y-3">
          <input
            id="template-title"
            data-testid="template-title"
            type="text"
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            placeholder="テンプレート名（例: 新商品のお知らせ）"
            className="w-full p-2.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg"
          />
          <textarea
            id="template-body"
            data-testid="template-body"
            value={bodyInput}
            onChange={(e) => setBodyInput(e.target.value)}
            rows={4}
            placeholder="テンプレート本文"
            className="w-full p-2.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg"
          />
          <div className="flex flex-wrap gap-2">
            {PLATFORM_OPTIONS.map((platform) => (
              <label key={platform} className="inline-flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-lg">
                <input
                  type="checkbox"
                  checked={platforms.includes(platform)}
                  onChange={() => togglePlatform(platform)}
                  data-testid={`template-platform-${platform}`}
                />
                <SocialPlatformBadge platform={platform} size={13} labelClassName="text-xs" />
              </label>
            ))}
          </div>
          <button
            id="template-create"
            data-testid="template-create"
            type="button"
            onClick={() => void handleCreate()}
            disabled={isCreating || !isSupabaseConfigured || !activeOrgId}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Plus size={16} />
            {isCreating ? '作成中...' : 'テンプレートを作成'}
          </button>
        </div>

        <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-white">登録済みテンプレート</h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleSelectAllTemplates}
                className="px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg"
              >
                {selectedTemplateIds.length === templates.length && templates.length > 0 ? '選択解除' : 'すべて選択'}
              </button>
              <button
                type="button"
                onClick={() => void handleBulkRemove()}
                disabled={selectedTemplateIds.length === 0 || isBulkRemoving}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-red-600 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Trash2 size={12} />
                {isBulkRemoving ? '削除中...' : `選択削除 (${selectedTemplateIds.length})`}
              </button>
            </div>
          </div>
          {isLoading && <p className="text-xs text-gray-500 dark:text-gray-400">読み込み中...</p>}
          {!isLoading && templates.length === 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400">テンプレートはまだありません。</p>
          )}
          <div className="space-y-2">
            {templates.map((template) => (
              <div key={template.id} className="p-3 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/60">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedTemplateIds.includes(template.id)}
                      onChange={() => toggleTemplateSelection(template.id)}
                      className="mt-1 h-4 w-4"
                    />
                    <div>
                    <p className="text-sm font-semibold text-gray-800 dark:text-white">{template.title}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap break-words mt-1">{template.body}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {template.defaultPlatforms.length > 0 ? template.defaultPlatforms.map((platform) => (
                        <SocialPlatformBadge
                          key={`${template.id}-${platform}`}
                          platform={platform}
                          size={12}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700"
                          labelClassName="text-[10px]"
                        />
                      )) : (
                        <span className="text-[10px] text-gray-500 dark:text-gray-400">投稿先指定なし</span>
                      )}
                    </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRemove(template.id)}
                    disabled={removingTemplateId === template.id}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-md hover:bg-red-100 dark:hover:bg-red-900/40 disabled:opacity-60"
                  >
                    <Trash2 size={12} />
                    {removingTemplateId === template.id ? '削除中' : '削除'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};
