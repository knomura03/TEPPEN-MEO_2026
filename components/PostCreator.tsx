import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BrandKit, PostContentTemplate, Role, SocialPlatform, User } from '../types';
import { MOCK_ACCOUNTS } from '../constants';
import { geminiService } from '../services/geminiService';
import { postsService } from '../services/postsService';
import { postMediaService } from '../services/postMediaService';
import { postPublishService } from '../services/postPublishService';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { brandKitService } from '../services/brandKitService';
import { Send, Calendar, Image as ImageIcon, Sparkles, Loader2, X, Eye, MonitorSmartphone, UploadCloud } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';
import { useStore } from '../contexts/StoreContext';
import { PAGE_CARD_CLASS, PAGE_CONTAINER_CLASS, PAGE_HEADER_DESCRIPTION_CLASS, PAGE_HEADER_TITLE_CLASS, PAGE_WARNING_CLASS } from './ui/pageLayout';
import { SocialPlatformBadge } from './ui/SocialPlatformLogo';
import { formatViewLabel } from './ui/formatters';
import { Avatar } from './ui/Avatar';
import { COMMON_COPY } from './ui/copy';

interface PostCreatorProps {
  currentUser: User;
}

export const PostCreator: React.FC<PostCreatorProps> = ({ currentUser }) => {
  const { addNotification } = useNotification();
  const { activeStoreId, selectedStoreIds, stores } = useStore();
  const isApprovalRequester = currentUser.role === Role.USER;
  const isMultiStoreSelected = selectedStoreIds.length > 1;
  const [content, setContent] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<SocialPlatform[]>([]);
  const [scheduledDate, setScheduledDate] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // AI Generation State
  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState('親しみやすい');
  const [showAiModal, setShowAiModal] = useState(false);
  const [brandKit, setBrandKit] = useState<BrandKit | null>(null);
  const [templates, setTemplates] = useState<PostContentTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [isLoadingBrandAssets, setIsLoadingBrandAssets] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const maxFileSizeBytes = 10 * 1024 * 1024;

  const activeStore = useMemo(
    () => (activeStoreId ? stores.find((item) => item.id === activeStoreId) || null : null),
    [activeStoreId, stores]
  );
  const activeOrgId = activeStore?.orgId || null;

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) || null,
    [selectedTemplateId, templates]
  );

  const contentLint = useMemo(() => {
    return brandKitService.lintContent(content, brandKit || undefined);
  }, [content, brandKit]);

  useEffect(() => {
    if (!isSupabaseConfigured || !activeOrgId) {
      setBrandKit(null);
      setTemplates([]);
      setSelectedTemplateId('');
      return;
    }

    setIsLoadingBrandAssets(true);
    Promise.all([brandKitService.getBrandKit(activeOrgId), brandKitService.listTemplates(activeOrgId)])
      .then(([kit, templateRows]) => {
        setBrandKit(kit);
        setTemplates(templateRows);
        setSelectedTemplateId((prev) => {
          if (templateRows.length === 0) return '';
          if (prev && templateRows.some((template) => template.id === prev)) return prev;
          return templateRows[0].id;
        });
      })
      .catch((error) => {
        console.error('[PostCreator] Failed to load brand assets:', error);
        addNotification('読み込みエラー', 'テンプレート/ブランドキットの取得に失敗しました。', 'ERROR');
        setBrandKit(null);
        setTemplates([]);
        setSelectedTemplateId('');
      })
      .finally(() => {
        setIsLoadingBrandAssets(false);
      });
  }, [addNotification, activeOrgId]);

  const togglePlatform = (platform: SocialPlatform) => {
    setSelectedPlatforms(prev => 
      prev.includes(platform) ? prev.filter(p => p !== platform) : [...prev, platform]
    );
  };

  const handleGenerateContent = async () => {
    if (!geminiService.isConfigured()) {
      addNotification('AI未設定', 'GEMINI_API_KEY が未設定のため、AI生成は使えません。', 'WARNING');
      return;
    }
    setIsGenerating(true);
    const platformName = selectedPlatforms.length > 0 ? selectedPlatforms.join(', ') : 'SNS全般';
    
    try {
      const generatedText = await geminiService.generatePostCaption(topic, platformName, tone);
      setContent(generatedText);
      addNotification('AI生成完了', '魅力的なキャプションが生成されました！', 'SUCCESS');
    } catch (error) {
      addNotification('生成エラー', 'AIによる生成中にエラーが発生しました', 'ERROR');
    } finally {
      setIsGenerating(false);
      setShowAiModal(false);
    }
  };

  const handleApplyTemplate = () => {
    if (!selectedTemplate) {
      addNotification('テンプレート未選択', '適用するテンプレートを選択してください。', 'WARNING');
      return;
    }
    let nextContent = selectedTemplate.body.trim();
    if (brandKit?.defaultSignature) {
      const signature = brandKit.defaultSignature.trim();
      if (signature && !nextContent.includes(signature)) {
        nextContent = `${nextContent}\n\n${signature}`;
      }
    }
    setContent(nextContent);
    if (selectedTemplate.defaultPlatforms.length > 0) {
      setSelectedPlatforms(selectedTemplate.defaultPlatforms);
    }
    addNotification('テンプレート適用', `「${selectedTemplate.title}」を適用しました。`, 'SUCCESS');
  };

  const handleAppendRecommendedHashtag = (rawTag: string) => {
    const normalizedTag = rawTag.startsWith('#') ? rawTag : `#${rawTag}`;
    if (content.toLowerCase().includes(normalizedTag.toLowerCase())) return;
    const delimiter = content.trim().length === 0 ? '' : '\n';
    setContent((prev) => `${prev}${delimiter}${normalizedTag}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isMultiStoreSelected) {
      addNotification('複数店舗選択中', COMMON_COPY.multiStoreSnsDisabled, 'ERROR');
      return;
    }
    const targetStoreIds = activeStoreId ? [activeStoreId] : [];

    if (isSupabaseConfigured) {
      if (targetStoreIds.length === 0) {
        addNotification('店舗未設定', '投稿先の店舗が未設定のため投稿を保存できません。', 'ERROR');
        return;
      }

      let scheduledAtForCreate: Date | null = null;
      let immediatePublish = false;

      if (isApprovalRequester) {
        if (scheduledDate) {
          const shouldScheduleRequest = window.confirm('この日時で承認申請を作成します。よろしいですか？');
          if (!shouldScheduleRequest) return;
          scheduledAtForCreate = new Date(scheduledDate);
        } else {
          const shouldSubmitNow = window.confirm(
            '日時未指定のため、承認後にできるだけ早く公開する申請を作成します。よろしいですか？'
          );
          if (!shouldSubmitNow) return;
          scheduledAtForCreate = new Date();
        }
      } else if (scheduledDate) {
        const shouldSchedule = window.confirm('指定日時で予約投稿を作成します。よろしいですか？');
        if (!shouldSchedule) return;
        scheduledAtForCreate = new Date(scheduledDate);
      } else {
        const shouldPublishNow = window.confirm(
          '日時が未指定です。このまま今すぐ投稿しますか？\n「キャンセル」を選ぶと下書き保存になります。'
        );
        immediatePublish = shouldPublishNow;
      }

      setIsSubmitting(true);
      try {
        const { createdPosts, targetStoreCount } = await postsService.createBulk({
          storeIds: targetStoreIds,
          authorUserId: currentUser.id,
          content,
          platforms: selectedPlatforms,
          scheduledAt: scheduledAtForCreate,
          approvalStatus: isApprovalRequester ? 'PENDING' : 'APPROVED',
        });

        if (images.length > 0 && createdPosts.length > 0) {
          let failedCount = 0;
          for (const post of createdPosts) {
            if (!post.storeId) continue;
            try {
              const result = await postMediaService.uploadForPost({
                storeId: post.storeId,
                postId: post.id,
                files: images,
              });
              failedCount += result.failedCount;
            } catch {
              failedCount += images.length;
            }
          }
          if (failedCount > 0) {
            addNotification('画像アップロード一部失敗', `${failedCount}件の画像アップロードに失敗しました。`, 'WARNING');
          }
        }

        if (!isApprovalRequester && immediatePublish) {
          let successCount = 0;
          let failedCount = 0;
          const failedDetails: string[] = [];

          for (const post of createdPosts) {
            try {
              const results = await postPublishService.publishPost({ postId: post.id });
              const allSuccess = results.every((row) => row.status === 'SUCCESS');
              if (allSuccess) {
                successCount += 1;
              } else {
                failedCount += 1;
                const message = results
                  .filter((row) => row.status === 'FAILED')
                  .map((row) => `${row.provider}: ${row.message || '失敗'}`)
                  .join(' / ');
                failedDetails.push(message || `post=${post.id}`);
              }
            } catch (error) {
              failedCount += 1;
              failedDetails.push(error instanceof Error ? error.message : `post=${post.id}`);
            }
          }

          if (successCount > 0) {
            addNotification(
              '即時投稿完了',
              `${successCount}件の投稿を実行しました。`,
              'SUCCESS'
            );
          }
          if (failedCount > 0) {
            addNotification(
              '即時投稿で失敗あり',
              failedDetails.slice(0, 2).join(' / ') || `${failedCount}件の投稿で失敗しました。`,
              'WARNING'
            );
          }
        } else if (isApprovalRequester) {
          addNotification(
            '承認申請を作成',
            `承認待ちとして保存しました（${targetStoreCount}店舗 / ${selectedPlatforms.length}プラットフォーム）`,
            'SUCCESS'
          );
        } else {
          addNotification(
            scheduledDate ? '予約作成完了' : '下書き保存完了',
            scheduledDate
              ? `予約投稿を作成しました（${targetStoreCount}店舗 / ${selectedPlatforms.length}プラットフォーム）`
              : `下書きを保存しました（${targetStoreCount}店舗 / ${selectedPlatforms.length}プラットフォーム）`,
            'SUCCESS'
          );
        }

        setContent('');
        setImages([]);
        setImagePreviewUrls([]);
        setScheduledDate('');
        setSelectedPlatforms([]);
      } catch {
        addNotification('保存エラー', '投稿の保存に失敗しました。', 'ERROR');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }
    
    // Simulate API call
    setTimeout(() => {
      addNotification(
        scheduledDate ? '予約投稿完了' : '投稿完了',
        `${selectedPlatforms.length}つのプラットフォームへ${scheduledDate ? '予約' : ''}投稿しました！`,
        'SUCCESS'
      );
      
      setContent('');
      setImages([]);
      setImagePreviewUrls([]);
      setScheduledDate('');
      setSelectedPlatforms([]);
    }, 500);
  };

  // File Handling
  const processFiles = (files: File[]) => {
    const accepted: File[] = [];
    files.forEach((file) => {
      if (file.size > maxFileSizeBytes) {
        addNotification('ファイルサイズ超過', '10MB以下の画像を選んでください。', 'WARNING');
        return;
      }
      accepted.push(file);
    });
    if (accepted.length === 0) return;
    setImages((prev) => [...prev, ...accepted]);
    const urls = accepted.map((file) => URL.createObjectURL(file));
    setImagePreviewUrls((prev) => [...prev, ...urls]);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(Array.from(e.target.files));
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      processFiles(Array.from(e.dataTransfer.files));
    }
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
    setImagePreviewUrls(prev => prev.filter((_, i) => i !== index));
  };

  const isSubmitDisabled =
    selectedPlatforms.length === 0 ||
    !content ||
    isSubmitting ||
    (isSupabaseConfigured && (!activeStoreId || isMultiStoreSelected));

  // ----------------------------------------------------------------------
  // Preview Components
  // ----------------------------------------------------------------------
  // Previews are kept in light mode intentionally to simulate app appearance
  const InstagramPreview = () => (
    <div className="bg-white text-black border border-gray-200 rounded-sm max-w-[350px] mx-auto text-sm font-sans shadow-sm mb-4">
      <div className="p-3 flex items-center space-x-2 border-b border-gray-100">
        <div className="w-8 h-8 bg-gradient-to-tr from-yellow-400 to-purple-600 p-[2px] rounded-full">
            <div className="w-full h-full bg-white rounded-full p-[2px]">
              <Avatar
                src={currentUser.avatarUrl}
                alt={`${currentUser.name} のプロフィール画像`}
                sizeClassName="w-full h-full"
                iconSize={12}
              />
            </div>
        </div>
        <span className="font-semibold text-xs">{currentUser.username}</span>
      </div>
      <div className="aspect-square bg-gray-100 flex items-center justify-center overflow-hidden">
        {imagePreviewUrls.length > 0 ? (
          <img src={imagePreviewUrls[0]} alt="Post" className="w-full h-full object-cover" />
        ) : (
          <span className="text-gray-400 text-xs">画像なし</span>
        )}
      </div>
      <div className="p-3">
        <div className="flex space-x-3 mb-2">
            <div className="w-6 h-6 rounded-full border border-gray-800"></div> 
            <div className="w-6 h-6 rounded-full border border-gray-800"></div>
            <div className="w-6 h-6 rounded-full border border-gray-800"></div>
        </div>
        <div className="space-y-1">
          <p className="font-semibold text-xs">「いいね！」12件</p>
          <p className="text-xs">
            <span className="font-semibold mr-1">{currentUser.username}</span>
            {content || "キャプションがここに入ります..."}
          </p>
        </div>
      </div>
    </div>
  );

  const GoogleBusinessPreview = () => (
    <div className="bg-white text-black border border-gray-200 rounded-lg max-w-[350px] mx-auto shadow-sm mb-4 overflow-hidden">
      <div className="p-3 border-b border-gray-100 flex items-center space-x-2">
          <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center text-white text-[10px] font-bold">G</div>
          <span className="text-xs font-medium text-gray-700">Googleの最新情報</span>
      </div>
      {imagePreviewUrls.length > 0 && (
        <div className="h-40 bg-gray-100 overflow-hidden">
           <img src={imagePreviewUrls[0]} alt="Post" className="w-full h-full object-cover" />
        </div>
      )}
      <div className="p-4">
        <p className="text-xs text-gray-800 line-clamp-3 mb-3">
            {content || "投稿内容がここに表示されます..."}
        </p>
        <button className="text-xs bg-gray-100 hover:bg-gray-200 text-blue-700 px-4 py-1.5 rounded-full font-medium transition-colors">
            詳細
        </button>
      </div>
    </div>
  );

  return (
    <div className={`${PAGE_CONTAINER_CLASS} max-w-6xl mx-auto h-[calc(100vh-100px)] flex flex-col`}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className={PAGE_HEADER_TITLE_CLASS}>{formatViewLabel('CREATE_POST')}</h1>
          <p className={PAGE_HEADER_DESCRIPTION_CLASS}>投稿文を作成し、下書き保存や予約設定を行います。</p>
        </div>
        <button 
          onClick={() => setShowAiModal(true)}
          className="flex items-center space-x-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-4 py-2 rounded-lg hover:shadow-lg transition-all"
        >
          <Sparkles size={18} />
          <span>AIで文章を作成</span>
        </button>
      </div>

      {isMultiStoreSelected && (
        <div className={PAGE_WARNING_CLASS}>{COMMON_COPY.multiStoreSnsDisabled}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 overflow-hidden">
        {/* Editor Column */}
        <div id="post-editor-panel" className={`${PAGE_CARD_CLASS} p-6 overflow-y-auto`}>
            <form onSubmit={handleSubmit} className="space-y-6">
            {/* Platform Selection */}
            <div id="post-target-mode-section">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">投稿対象</label>
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-200">
                  {isMultiStoreSelected
                    ? COMMON_COPY.multiStoreSnsDisabled
                    : activeStore
                      ? `現在は「${activeStore.name}」へ投稿します。`
                      : '右上の店舗セレクタで投稿先の店舗を選択してください。'}
                </div>
            </div>

            <div id="post-template-section">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">テンプレート / ブランドキット</label>
                <div className="space-y-3 p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <select
                      data-testid="post-template-select"
                      value={selectedTemplateId}
                      onChange={(e) => setSelectedTemplateId(e.target.value)}
                      disabled={isLoadingBrandAssets || templates.length === 0}
                      className="md:col-span-2 w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm disabled:opacity-60"
                    >
                      {templates.length === 0 && <option value="">テンプレート未登録</option>}
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.title}
                        </option>
                      ))}
                    </select>
                    <button
                      data-testid="post-template-apply"
                      type="button"
                      onClick={handleApplyTemplate}
                      disabled={!selectedTemplate || isLoadingBrandAssets}
                      className="px-3 py-2 text-sm font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      テンプレート適用
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {isLoadingBrandAssets
                      ? 'ブランド設定を読み込み中...'
                      : templates.length > 0
                        ? `${templates.length}件のテンプレートが利用可能です。`
                        : 'テンプレート未登録です。左メニューの「投稿テンプレート」から追加してください。'}
                  </p>
                  {brandKit && (
                    <div className="space-y-2">
                      <p className="text-xs text-gray-600 dark:text-gray-300">
                        推奨ハッシュタグ: {brandKit.recommendedHashtags.length > 0 ? 'クリックで本文に追加できます。' : '未設定'}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {brandKit.recommendedHashtags.map((tag) => (
                          <button
                            key={tag}
                            data-testid={`post-recommended-tag-${tag.replace('#', '')}`}
                            type="button"
                            onClick={() => handleAppendRecommendedHashtag(tag)}
                            className="text-xs px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800"
                          >
                            {tag.startsWith('#') ? tag : `#${tag}`}
                          </button>
                        ))}
                        {brandKit.recommendedHashtags.length === 0 && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">推奨ハッシュタグは未設定です。</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
            </div>

            <div id="post-platform-section">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">投稿先を選択</label>
                <div className="flex flex-wrap gap-3">
                {MOCK_ACCOUNTS.map(account => (
                    <button
                    data-testid={`post-platform-${account.platform}`}
                    key={account.id}
                    type="button"
                    onClick={() => togglePlatform(account.platform)}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-full border transition-all ${
                        selectedPlatforms.includes(account.platform)
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-md'
                        : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                    }`}
                    >
                    <SocialPlatformBadge
                      platform={account.platform}
                      size={14}
                      className="text-sm font-medium"
                      labelClassName="text-sm font-medium"
                    />
                    </button>
                ))}
                </div>
            </div>

            {/* Content Area */}
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">投稿内容</label>
                <textarea
                data-testid="post-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full h-40 p-4 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none text-sm leading-relaxed"
                placeholder="ここに投稿内容を入力してください..."
                required
                />
                {contentLint.matchedBannedWords.length > 0 && (
                  <div className="mt-2 p-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
                    NGワードを検知: {contentLint.matchedBannedWords.join(', ')}
                  </div>
                )}
                {contentLint.missingRecommendedHashtags.length > 0 && (
                  <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs">
                    推奨ハッシュタグ未使用: {contentLint.missingRecommendedHashtags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).join(', ')}
                  </div>
                )}
            </div>

            {/* Media & Schedule */}
            <div className="space-y-6">
                <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">画像・動画</label>
                <div 
                    className={`
                        flex flex-col items-center justify-center w-full h-32 
                        border-2 border-dashed rounded-lg cursor-pointer transition-colors
                        ${isDragging 
                            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' 
                            : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700'}
                    `}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        {isDragging ? (
                            <UploadCloud className="w-8 h-8 mb-2 text-indigo-500" />
                        ) : (
                            <ImageIcon className="w-8 h-8 mb-2 text-gray-400" />
                        )}
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            {isDragging ? 'ここにドロップ' : 'クリックまたはドラッグ＆ドロップ'}
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">PNG, JPG (Max 10MB)</p>
                    </div>
                    <input 
                        ref={fileInputRef}
                        type="file" 
                        className="hidden" 
                        multiple 
                        accept="image/*" 
                        onChange={handleImageChange} 
                    />
                </div>
                
                {images.length > 0 && (
                    <div className="mt-4 grid grid-cols-4 gap-4">
                        {imagePreviewUrls.map((url, i) => (
                            <div key={i} className="relative group aspect-square rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600">
                                <img src={url} className="w-full h-full object-cover" alt="preview" />
                                <button 
                                    onClick={() => removeImage(i)}
                                    className="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
                </div>

                <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">投稿日時</label>
                <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Calendar className="h-4 w-4 text-gray-400" />
                    </div>
                <input
                    type="datetime-local"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="pl-9 block w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg p-2.5 text-sm focus:ring-indigo-500 focus:border-indigo-500"
                    />
                </div>
                {isApprovalRequester && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                    保存すると承認待ちになります。承認後に予約投稿として実行されます。
                  </p>
                )}
                </div>
            </div>

            {/* Actions */}
            <div id="post-submit-section" className="flex items-center justify-end space-x-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                <button
                data-testid="post-submit"
                type="submit"
                disabled={isSubmitDisabled}
                className="flex items-center space-x-2 px-6 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md w-full justify-center"
                >
                {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                <span>
                  {isSubmitting
                    ? '保存中...'
                    : isApprovalRequester
                    ? '承認申請を作成'
                    : scheduledDate
                    ? '予約投稿する'
                    : '投稿する'}
                </span>
                </button>
            </div>
            </form>
        </div>

        {/* Preview Column */}
        <div id="post-preview-panel" className="bg-gray-50 dark:bg-gray-900 rounded-xl shadow-inner border border-gray-200 dark:border-gray-700 p-6 overflow-y-auto flex flex-col">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                    <MonitorSmartphone size={20} />
                    プレビュー
                </h2>
                <div className="text-xs text-gray-500 dark:text-gray-400">※実際の表示とは異なる場合があります</div>
            </div>

            {selectedPlatforms.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-400 dark:text-gray-500">
                    <MonitorSmartphone size={48} className="mb-2 opacity-50" />
                    <p>プラットフォームを選択すると<br/>プレビューが表示されます</p>
                </div>
            ) : (
                <div className="space-y-6">
                    {selectedPlatforms.includes('INSTAGRAM') && (
                        <div>
                            <div className="text-xs font-bold text-gray-500 mb-2 uppercase text-center">Instagram</div>
                            <InstagramPreview />
                        </div>
                    )}
                    {selectedPlatforms.includes('GOOGLE_BUSINESS') && (
                        <div>
                            <div className="text-xs font-bold text-gray-500 mb-2 uppercase text-center">Google Business</div>
                            <GoogleBusinessPreview />
                        </div>
                    )}
                    {(selectedPlatforms.includes('FACEBOOK') || selectedPlatforms.includes('TIKTOK')) && (
                        <div className="text-center p-4 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
                            <p className="text-sm text-gray-500">Facebook/TikTokのプレビューは現在準備中です</p>
                        </div>
                    )}
                </div>
            )}
        </div>
      </div>

      {/* AI Assistant Modal */}
      {showAiModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-6 animate-fade-in border border-gray-100 dark:border-gray-700">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold flex items-center gap-2 text-gray-900 dark:text-white">
                <Sparkles className="text-purple-600" />
                AIアシスタント
              </h3>
              <button onClick={() => setShowAiModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X size={24} />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">トピック・テーマ</label>
                <input 
                  type="text" 
                  value={topic} 
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="例: 夏の新メニュー、休業日のお知らせ" 
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg p-2"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">トーン（口調）</label>
                <select 
                  value={tone} 
                  onChange={(e) => setTone(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg p-2"
                >
                  <option value="親しみやすい">親しみやすい（絵文字多め）</option>
                  <option value="フォーマル">フォーマル（ビジネス向け）</option>
                  <option value="情熱的">情熱的・エネルギッシュ</option>
                  <option value="ミニマル">ミニマル（短く簡潔に）</option>
                </select>
              </div>

              <div className="pt-4">
                <button
                  onClick={handleGenerateContent}
                  disabled={!topic || isGenerating}
                  className="w-full flex items-center justify-center space-x-2 bg-purple-600 text-white py-3 rounded-lg hover:bg-purple-700 disabled:opacity-50"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="animate-spin" size={20} />
                      <span>生成中...</span>
                    </>
                  ) : (
                    <span>アイデアを生成</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
