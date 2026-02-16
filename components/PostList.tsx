import React, { useEffect, useMemo, useState } from 'react';
import { ExternalProviderPost, Post, PostApprovalActionType, PostApprovalComment, PostStatus, Role, User } from '../types';
import { Clock, CheckCircle, AlertCircle, Calendar, X, Image as ImageIcon, Loader2, MessageSquare, RefreshCw, Link2 } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '../services/supabaseClient';
import { postsService } from '../services/postsService';
import { postPublishService } from '../services/postPublishService';
import { getErrorMessage } from '../services/errorMessage';
import { useNotification } from '../contexts/NotificationContext';
import { useStore } from '../contexts/StoreContext';
import { postMediaService } from '../services/postMediaService';
import { providerPostsService } from '../services/providerPostsService';
import { featureFlagsService, resolveFeatureState } from '../services/featureFlagsService';
import { ModalPortal } from './ModalPortal';
import { PAGE_CARD_CLASS, PAGE_CONTAINER_CLASS, PAGE_HEADER_DESCRIPTION_CLASS, PAGE_HEADER_TITLE_CLASS } from './ui/pageLayout';
import { SocialPlatformBadge, SocialPlatformLogo } from './ui/SocialPlatformLogo';
import { formatViewLabel } from './ui/formatters';

const formatDate = (date: Date) => {
  const y = date.getFullYear();
  const m = ('0' + (date.getMonth() + 1)).slice(-2);
  const d = ('0' + date.getDate()).slice(-2);
  const h = ('0' + date.getHours()).slice(-2);
  const min = ('0' + date.getMinutes()).slice(-2);
  return `${y}/${m}/${d} ${h}:${min}`;
};

const formatCommentDate = (date: Date) => {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const h = ('0' + date.getHours()).slice(-2);
  const min = ('0' + date.getMinutes()).slice(-2);
  return `${y}年${m}月${d}日 ${h}:${min}`;
};

const toDatetimeLocalValue = (date: Date) => {
  const y = date.getFullYear();
  const m = ('0' + (date.getMonth() + 1)).slice(-2);
  const d = ('0' + date.getDate()).slice(-2);
  const h = ('0' + date.getHours()).slice(-2);
  const min = ('0' + date.getMinutes()).slice(-2);
  return `${y}-${m}-${d}T${h}:${min}`;
};

interface PostListProps {
  currentUser: User;
}

type SourceFilter = 'ALL' | 'TEPPEN' | 'EXTERNAL';
type PlatformFilter = 'ALL' | 'INSTAGRAM' | 'FACEBOOK' | 'GBP';

type LocalRow = {
  source: 'TEPPEN';
  key: string;
  post: Post;
  createdAt: Date;
  text: string;
  platforms: PlatformFilter[];
};

type ExternalRow = {
  source: 'EXTERNAL';
  key: string;
  externalPost: ExternalProviderPost;
  createdAt: Date;
  text: string;
  platforms: PlatformFilter[];
};

type UnifiedRow = LocalRow | ExternalRow;

type PostMetricValue = number | null;
type PostMetricSummary = {
  impressions: PostMetricValue;
  profileViews: PostMetricValue;
  likes: PostMetricValue;
  comments: PostMetricValue;
};

const PLATFORM_FILTER_LABELS: Record<PlatformFilter, string> = {
  ALL: 'すべて',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  GBP: 'Googleビジネスプロフィール',
};

const EXTERNAL_PROVIDER_TO_PLATFORM: Record<string, PlatformFilter> = {
  INSTAGRAM: 'INSTAGRAM',
  FACEBOOK: 'FACEBOOK',
  GBP: 'GBP',
};

const toPlatformFilterFromProvider = (provider: string): PlatformFilter => {
  const normalized = String(provider || '').toUpperCase();
  return EXTERNAL_PROVIDER_TO_PLATFORM[normalized] || 'FACEBOOK';
};

const toExternalPostKey = (provider: string, externalPostId: string): string => {
  return `${toPlatformFilterFromProvider(provider)}:${externalPostId}`;
};

const toPlatformFilterValues = (post: Post): PlatformFilter[] => {
  const values: PlatformFilter[] = [];
  for (const platform of post.platforms) {
    if (platform === 'INSTAGRAM' || platform === 'FACEBOOK') {
      values.push(platform);
    } else if (platform === 'GOOGLE_BUSINESS') {
      values.push('GBP');
    }
  }
  return Array.from(new Set(values));
};

const EMPTY_POST_METRICS: PostMetricSummary = {
  impressions: null,
  profileViews: null,
  likes: null,
  comments: null,
};

const mergeMetricValue = (left: PostMetricValue, right: PostMetricValue): PostMetricValue => {
  if (left === null && right === null) return null;
  return (left || 0) + (right || 0);
};

const formatMetricValue = (value: PostMetricValue): string => {
  if (value === null || value === undefined) return '—';
  return Number(value).toLocaleString('ja-JP');
};

export const PostList: React.FC<PostListProps> = ({ currentUser }) => {
  const { addNotification } = useNotification();
  const { activeStoreId, selectedStoreIds, stores } = useStore();
  const isMultiStoreSelected = selectedStoreIds.length > 1;
  const activeOrgId = useMemo(() => {
    if (!activeStoreId) return null;
    return stores.find((store) => store.id === activeStoreId)?.orgId || null;
  }, [activeStoreId, stores]);
  const canApprove =
    currentUser.role === Role.ADMIN || currentUser.role === Role.SUPERVISOR || currentUser.role === Role.MANAGER;
  const isRequester = currentUser.role === Role.USER;
  const [posts, setPosts] = useState<Post[]>([]);
  const [externalPosts, setExternalPosts] = useState<ExternalProviderPost[]>([]);
  const [isFetchingExternalPosts, setIsFetchingExternalPosts] = useState(false);
  const [lastExternalFetchedAt, setLastExternalFetchedAt] = useState<Date | null>(null);
  const [remoteAutoFetchEnabled, setRemoteAutoFetchEnabled] = useState(false);
  const [externalFetchErrors, setExternalFetchErrors] = useState<Record<string, string>>({});
  const [knownExternalPostKeys, setKnownExternalPostKeys] = useState<string[]>([]);
  const [postExternalKeysByPostId, setPostExternalKeysByPostId] = useState<Record<string, string[]>>({});
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editScheduledDate, setEditScheduledDate] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [approvalProcessingPostId, setApprovalProcessingPostId] = useState<string | null>(null);
  const [publishingNowPostId, setPublishingNowPostId] = useState<string | null>(null);
  const [historyPost, setHistoryPost] = useState<Post | null>(null);
  const [approvalComments, setApprovalComments] = useState<PostApprovalComment[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [newApprovalComment, setNewApprovalComment] = useState('');
  const [isAddingApprovalComment, setIsAddingApprovalComment] = useState(false);
  const [existingMedia, setExistingMedia] = useState<{ id: string; storagePath: string; signedUrl?: string }[]>([]);
  const [isLoadingMedia, setIsLoadingMedia] = useState(false);
  const [newImages, setNewImages] = useState<File[]>([]);
  const [newImagePreviews, setNewImagePreviews] = useState<string[]>([]);
  const [postSearchTerm, setPostSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'PENDING' | 'REJECTED' | 'FAILED'>('ALL');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('ALL');
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>('ALL');
  const [selectedPostIds, setSelectedPostIds] = useState<string[]>([]);
  const [isBulkDeletingPosts, setIsBulkDeletingPosts] = useState(false);
  const maxFileSizeBytes = 10 * 1024 * 1024;

  const reloadPublishedExternalPostKeys = async () => {
    if (!isSupabaseConfigured || !supabase || !activeStoreId) {
      setKnownExternalPostKeys([]);
      setPostExternalKeysByPostId({});
      return;
    }

    const { data, error } = await supabase
      .from('post_publish_logs')
      .select('post_id, provider, external_post_id')
      .eq('store_id', activeStoreId)
      .not('external_post_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) {
      setKnownExternalPostKeys([]);
      setPostExternalKeysByPostId({});
      return;
    }

    const keySet = new Set<string>();
    const keyMapByPostId: Record<string, string[]> = {};
    (data || []).forEach((row) => {
      const typed = row as { post_id?: string | null; provider?: string; external_post_id?: string };
      const provider = String(typed.provider || '').toUpperCase();
      const externalPostId = String(typed.external_post_id || '').trim();
      if (!externalPostId) return;
      const normalizedProvider = provider === 'GOOGLE_BUSINESS' ? 'GBP' : provider;
      const key = toExternalPostKey(normalizedProvider, externalPostId);
      if (!key) return;

      keySet.add(key);
      const postId = String(typed.post_id || '').trim();
      if (!postId) return;
      if (!keyMapByPostId[postId]) keyMapByPostId[postId] = [];
      if (!keyMapByPostId[postId].includes(key)) keyMapByPostId[postId].push(key);
    });

    const keys = Array.from(keySet);
    setKnownExternalPostKeys(keys);
    setPostExternalKeysByPostId(keyMapByPostId);
  };

  const loadRemoteAutoFetchFlag = async () => {
    if (!isSupabaseConfigured || !activeOrgId) {
      setRemoteAutoFetchEnabled(false);
      return;
    }
    try {
      const rows = await featureFlagsService.listByOrg(activeOrgId, activeStoreId || undefined);
      const state = resolveFeatureState(rows, 'remote_posts_autofetch', activeStoreId || undefined);
      setRemoteAutoFetchEnabled(state === 'ENABLED');
    } catch {
      setRemoteAutoFetchEnabled(false);
    }
  };

  const fetchExternalPosts = async (params?: { force?: boolean; silent?: boolean }) => {
    if (!isSupabaseConfigured || !activeStoreId) {
      setExternalPosts([]);
      setExternalFetchErrors({});
      setLastExternalFetchedAt(null);
      return;
    }

    setIsFetchingExternalPosts(true);
    try {
      const result = await providerPostsService.fetch({
        storeId: activeStoreId,
        limit: 50,
        force: params?.force ?? false,
      });
      setExternalPosts(result.merged);
      setExternalFetchErrors(result.errors || {});
      setLastExternalFetchedAt(result.fetchedAt);

      if (!params?.silent) {
        const errorCount = Object.keys(result.errors || {}).length;
        const messageParts = [`外部投稿 ${result.merged.length}件を取得しました。`];
        if (result.cacheHit) {
          messageParts.push('5分以内のキャッシュを表示しています。');
        }
        if (errorCount > 0) {
          messageParts.push(`${errorCount}件の連携先で取得エラーがあります。`);
        }
        addNotification('外部投稿を更新', messageParts.join(' '), errorCount > 0 ? 'WARNING' : 'SUCCESS');
      }
    } catch (error) {
      if (!params?.silent) {
        addNotification('外部投稿の取得エラー', getErrorMessage(error) || '外部投稿の取得に失敗しました。', 'ERROR');
      }
    } finally {
      setIsFetchingExternalPosts(false);
    }
  };

  const reload = async () => {
    if (!isSupabaseConfigured) {
      setPosts([]);
      return;
    }
    if (selectedStoreIds.length === 0) {
      setPosts([]);
      return;
    }
    try {
      const data = await postsService.listByStores(selectedStoreIds);
      setPosts(data);
    } catch {
      addNotification('読み込みエラー', '投稿の取得に失敗しました。', 'ERROR');
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStoreIds.join(',')]);

  useEffect(() => {
    if (!activeStoreId) {
      setExternalPosts([]);
      setExternalFetchErrors({});
      setLastExternalFetchedAt(null);
      setKnownExternalPostKeys([]);
      setPostExternalKeysByPostId({});
      setRemoteAutoFetchEnabled(false);
      return;
    }
    void reloadPublishedExternalPostKeys();
    void loadRemoteAutoFetchFlag();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStoreId, activeOrgId]);

  useEffect(() => {
    if (!activeStoreId || !remoteAutoFetchEnabled) return;
    void fetchExternalPosts({ force: false, silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStoreId, remoteAutoFetchEnabled]);

  useEffect(() => {
    const existing = new Set(posts.map((post) => post.id));
    setSelectedPostIds((prev) => prev.filter((id) => existing.has(id)));
  }, [posts]);

  const handleDelete = async (postId: string) => {
    if (!window.confirm('この投稿を削除しますか？')) return;

    if (!isSupabaseConfigured) {
      addNotification('モック', 'デモでは削除できません。', 'INFO');
      return;
    }

    try {
      await postsService.delete(postId);
      addNotification('削除完了', '投稿を削除しました。', 'SUCCESS');
      await reload();
    } catch {
      addNotification('削除エラー', '投稿の削除に失敗しました。', 'ERROR');
    }
  };

  const togglePostSelection = (postId: string) => {
    setSelectedPostIds((prev) => (
      prev.includes(postId)
        ? prev.filter((id) => id !== postId)
        : [...prev, postId]
    ));
  };

  const handleApprove = async (postId: string) => {
    if (!isSupabaseConfigured) {
      addNotification('モック', 'デモでは承認できません。', 'INFO');
      return;
    }
    setApprovalProcessingPostId(postId);
    try {
      await postsService.approve(postId, currentUser.id);
      addNotification('承認完了', '投稿を承認しました。', 'SUCCESS');
      await reload();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '投稿の承認に失敗しました。';
      addNotification('承認エラー', message, 'ERROR');
    } finally {
      setApprovalProcessingPostId(null);
    }
  };

  const handleReject = async (postId: string) => {
    const reason = window.prompt('差し戻し理由（任意）を入力してください。', '');
    if (reason === null) return;
    if (!isSupabaseConfigured) {
      addNotification('モック', 'デモでは差し戻しできません。', 'INFO');
      return;
    }
    setApprovalProcessingPostId(postId);
    try {
      await postsService.reject(postId, currentUser.id, reason);
      addNotification('差し戻し完了', '投稿を差し戻しました。', 'SUCCESS');
      await reload();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '差し戻しに失敗しました。';
      addNotification('差し戻しエラー', message, 'ERROR');
    } finally {
      setApprovalProcessingPostId(null);
    }
  };

  const handleSubmitForApproval = async (postId: string) => {
    if (!isSupabaseConfigured) {
      addNotification('モック', 'デモでは承認申請できません。', 'INFO');
      return;
    }
    setApprovalProcessingPostId(postId);
    try {
      await postsService.submitForApproval(postId, currentUser.id);
      addNotification('申請完了', '承認申請を送信しました。', 'SUCCESS');
      await reload();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '承認申請に失敗しました。';
      addNotification('申請エラー', message, 'ERROR');
    } finally {
      setApprovalProcessingPostId(null);
    }
  };

  const handlePublishNow = async (post: Post) => {
    if (!isSupabaseConfigured) {
      addNotification('モック', 'デモでは即時投稿を実行できません。', 'INFO');
      return;
    }
    if (isMultiStoreSelected) {
      addNotification('複数店舗選択中', '複数店舗選択中は投稿を実行できません。店舗を1つだけ選択してください。', 'WARNING');
      return;
    }

    if (!window.confirm('この予約投稿を今すぐ公開しますか？（予約日時は無視されます）')) {
      return;
    }

    setPublishingNowPostId(post.id);
    try {
      const results = await postPublishService.publishPost({
        postId: post.id,
      });
      const failed = results.filter((item) => item.status === 'FAILED');
      if (failed.length > 0) {
        const message = failed.map((item) => `${item.provider}: ${item.message || '投稿失敗'}`).join(' / ');
        addNotification('即時投稿で失敗あり', message, 'WARNING');
      } else {
        addNotification('即時投稿完了', '予約投稿を各SNSへ公開しました。', 'SUCCESS');
      }
      await Promise.all([reload(), reloadPublishedExternalPostKeys()]);
    } catch (error) {
      addNotification(
        '即時投稿エラー',
        getErrorMessage(error) || '即時投稿の実行に失敗しました。',
        'ERROR'
      );
      await Promise.all([reload(), reloadPublishedExternalPostKeys()]);
    } finally {
      setPublishingNowPostId(null);
    }
  };

  const loadApprovalComments = async (postId: string) => {
    if (!isSupabaseConfigured) {
      setApprovalComments([]);
      return;
    }
    setIsLoadingHistory(true);
    try {
      const comments = await postsService.listApprovalComments(postId);
      setApprovalComments(comments);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '履歴の取得に失敗しました。';
      addNotification('履歴取得エラー', message, 'ERROR');
      setApprovalComments([]);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const openHistory = (post: Post) => {
    setHistoryPost(post);
    setNewApprovalComment('');
    void loadApprovalComments(post.id);
  };

  const closeHistory = () => {
    if (isAddingApprovalComment) return;
    setHistoryPost(null);
    setApprovalComments([]);
    setNewApprovalComment('');
  };

  const handleAddApprovalComment = async () => {
    if (!historyPost || !newApprovalComment.trim()) return;
    if (!isSupabaseConfigured) {
      addNotification('モック', 'デモでは履歴コメントを追加できません。', 'INFO');
      return;
    }
    setIsAddingApprovalComment(true);
    try {
      await postsService.addApprovalComment(historyPost.id, currentUser.id, newApprovalComment.trim());
      addNotification('コメント追加完了', '履歴コメントを追加しました。', 'SUCCESS');
      setNewApprovalComment('');
      await loadApprovalComments(historyPost.id);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '履歴コメントの追加に失敗しました。';
      addNotification('コメント追加エラー', message, 'ERROR');
    } finally {
      setIsAddingApprovalComment(false);
    }
  };

  const loadMedia = async (postId: string) => {
    if (!isSupabaseConfigured) return;
    setIsLoadingMedia(true);
    try {
      const list = await postMediaService.listForPost(postId);
      setExistingMedia(list);
    } catch {
      addNotification('読み込みエラー', '画像の取得に失敗しました。', 'ERROR');
    } finally {
      setIsLoadingMedia(false);
    }
  };

  const openEdit = (post: Post) => {
    setEditingPost(post);
    setEditContent(post.content);
    setEditScheduledDate(post.scheduledDate ? toDatetimeLocalValue(post.scheduledDate) : '');
    setExistingMedia([]);
    setNewImages([]);
    setNewImagePreviews([]);
    void loadMedia(post.id);
  };

  const closeEdit = () => {
    if (isSaving) return;
    setEditingPost(null);
    setEditContent('');
    setEditScheduledDate('');
    setExistingMedia([]);
    setNewImages([]);
    setNewImagePreviews([]);
  };

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
    setNewImages((prev) => [...prev, ...accepted]);
    const urls = accepted.map((file) => URL.createObjectURL(file));
    setNewImagePreviews((prev) => [...prev, ...urls]);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(Array.from(e.target.files));
    }
  };

  const removeNewImage = (index: number) => {
    setNewImages((prev) => prev.filter((_, i) => i !== index));
    setNewImagePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const removeExistingImage = async (id: string, storagePath: string) => {
    if (!confirm('この画像を削除しますか？')) return;
    setIsLoadingMedia(true);
    try {
      await postMediaService.deleteMedia({ id, storagePath });
      setExistingMedia((prev) => prev.filter((m) => m.id !== id));
      addNotification('削除完了', '画像を削除しました。', 'SUCCESS');
    } catch {
      addNotification('削除エラー', '画像の削除に失敗しました。', 'ERROR');
    } finally {
      setIsLoadingMedia(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingPost) return;

    if (!isSupabaseConfigured) {
      addNotification('モック', 'デモでは編集できません。', 'INFO');
      closeEdit();
      return;
    }

    setIsSaving(true);
    try {
      const scheduledAt = editScheduledDate ? new Date(editScheduledDate) : null;
      await postsService.update(editingPost.id, {
        content: editContent,
        scheduledAt,
        status: scheduledAt ? PostStatus.SCHEDULED : PostStatus.DRAFT,
      });

      if (isSupabaseConfigured && newImages.length > 0 && activeStoreId) {
        try {
          const result = await postMediaService.uploadForPost({
            storeId: activeStoreId,
            postId: editingPost.id,
            files: newImages,
          });
          if (result.failedCount > 0) {
            addNotification('画像アップロード一部失敗', `${result.failedCount}件の画像アップロードに失敗しました。`, 'WARNING');
          }
        } catch (error: any) {
          addNotification(
            '画像アップロード失敗',
            `投稿は更新されましたが、画像のアップロードに失敗しました。${error?.message ? `（${error.message}）` : ''}`,
            'WARNING'
          );
        }
      }

      addNotification('更新完了', '投稿を更新しました。', 'SUCCESS');
      closeEdit();
      await reload();
    } catch {
      addNotification('更新エラー', '投稿の更新に失敗しました。', 'ERROR');
    } finally {
      setIsSaving(false);
    }
  };

  const getStatusBadge = (status: PostStatus) => {
    switch (status) {
      case PostStatus.PUBLISHED:
        return <span className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"><CheckCircle size={12}/> 公開済み</span>;
      case PostStatus.SCHEDULED:
        return <span className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"><Clock size={12}/> 予約済み</span>;
      case PostStatus.FAILED:
        return <span className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"><AlertCircle size={12}/> エラー</span>;
      default:
        return <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">下書き</span>;
    }
  };

  const getApprovalBadge = (post: Post) => {
    if (post.approvalStatus === 'PENDING') {
      return <span className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">承認待ち</span>;
    }
    if (post.approvalStatus === 'REJECTED') {
      return <span className="text-xs px-2 py-1 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200">差し戻し</span>;
    }
    if (post.approvalStatus === 'APPROVED') {
      return <span className="text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">承認済み</span>;
    }
    return null;
  };

  const getActionDisabled = (postId: string) => {
    return (
      approvalProcessingPostId === postId ||
      publishingNowPostId === postId ||
      isSaving
    );
  };

  const getStatusWithApproval = (post: Post) => {
    const statusBadge = getStatusBadge(post.status);
    const approvalBadge = getApprovalBadge(post);
    return (
      <div className="flex flex-col gap-1">
        {statusBadge}
        {approvalBadge}
      </div>
    );
  };

  const getPostDateText = (post: Post) => {
    if (post.scheduledDate) return formatDate(post.scheduledDate);
    if (post.publishedDate) return formatDate(post.publishedDate);
    return '-';
  };

  const getCanShowSubmitApproval = (post: Post) => {
    return isRequester && post.authorId === currentUser.id && (post.approvalStatus === 'NONE' || post.approvalStatus === 'REJECTED');
  };

  const getCanShowApproveReject = (post: Post) => {
    return canApprove && post.approvalStatus === 'PENDING';
  };

  const getCanEdit = (post: Post) => {
    if (canApprove) return true;
    return post.authorId === currentUser.id;
  };

  const getCanDelete = (post: Post) => {
    if (canApprove) return true;
    return post.authorId === currentUser.id;
  };

  const getCanPublishNow = (post: Post) => {
    if (!canApprove) return false;
    if (post.status !== PostStatus.SCHEDULED) return false;
    if (post.approvalStatus !== 'APPROVED') return false;
    if (!post.platforms || post.platforms.length === 0) return false;
    return true;
  };

  const getStatusLabel = (post: Post) => {
    if (post.approvalStatus === 'PENDING') return '承認待ち';
    if (post.approvalStatus === 'REJECTED') return '差し戻し';
    if (post.approvalStatus === 'APPROVED' && post.status === PostStatus.DRAFT) return '承認済み下書き';
    switch (post.status) {
      case PostStatus.PUBLISHED:
        return '公開済み';
      case PostStatus.SCHEDULED:
        return '予約済み';
      case PostStatus.FAILED:
        return 'エラー';
      default:
        return '下書き';
    }
  };

  const getActionLabel = (action: PostApprovalActionType) => {
    if (action === 'SUBMIT') return '承認申請';
    if (action === 'APPROVE') return '承認';
    if (action === 'REJECT') return '差し戻し';
    return 'コメント';
  };

  const getActionBadgeClass = (action: PostApprovalActionType) => {
    if (action === 'SUBMIT') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200';
    if (action === 'APPROVE') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200';
    if (action === 'REJECT') return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200';
    return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200';
  };

  const matchesStatusFilter = (post: Post) => {
    if (statusFilter === 'ALL') return true;
    if (statusFilter === 'PENDING') return post.approvalStatus === 'PENDING';
    if (statusFilter === 'REJECTED') return post.approvalStatus === 'REJECTED';
    if (statusFilter === 'DRAFT') return post.status === PostStatus.DRAFT && post.approvalStatus !== 'PENDING' && post.approvalStatus !== 'REJECTED';
    if (statusFilter === 'SCHEDULED') return post.status === PostStatus.SCHEDULED;
    if (statusFilter === 'PUBLISHED') return post.status === PostStatus.PUBLISHED;
    if (statusFilter === 'FAILED') return post.status === PostStatus.FAILED;
    return true;
  };

  const externalPostKeySet = useMemo(() => new Set(knownExternalPostKeys), [knownExternalPostKeys]);

  const unifiedRows = useMemo(() => {
    const normalizedSearch = postSearchTerm.trim().toLowerCase();

    const localRows: LocalRow[] = posts.map((post) => {
      const createdAt =
        post.publishedDate ||
        post.scheduledDate ||
        post.approvedAt ||
        post.submittedForApprovalAt ||
        post.rejectedAt ||
        new Date(0);
      return {
        source: 'TEPPEN',
        key: `local:${post.id}`,
        post,
        createdAt,
        text: post.content,
        platforms: toPlatformFilterValues(post),
      };
    });

    const externalRows: ExternalRow[] = externalPosts
      .filter((externalPost) => !externalPostKeySet.has(toExternalPostKey(externalPost.provider, externalPost.externalPostId)))
      .map((externalPost) => ({
        source: 'EXTERNAL',
        key: `external:${toExternalPostKey(externalPost.provider, externalPost.externalPostId)}`,
        externalPost,
        createdAt: externalPost.createdAt,
        text: externalPost.content,
        platforms: [toPlatformFilterFromProvider(externalPost.provider)],
      }));

    return [...localRows, ...externalRows]
      .filter((row) => {
        if (sourceFilter !== 'ALL' && row.source !== sourceFilter) return false;

        if (platformFilter !== 'ALL' && !row.platforms.includes(platformFilter)) return false;

        if (row.source === 'TEPPEN') {
          if (!matchesStatusFilter(row.post)) return false;
        } else if (statusFilter !== 'ALL' && statusFilter !== 'PUBLISHED') {
          return false;
        }

        if (!normalizedSearch) return true;
        return row.text.toLowerCase().includes(normalizedSearch);
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }, [externalPostKeySet, externalPosts, platformFilter, postSearchTerm, posts, sourceFilter, statusFilter]);

  const externalMetricsByKey = useMemo<Record<string, PostMetricSummary>>(() => {
    const next: Record<string, PostMetricSummary> = {};
    externalPosts.forEach((post) => {
      const key = toExternalPostKey(post.provider, post.externalPostId);
      next[key] = {
        impressions: post.metrics?.impressions ?? null,
        profileViews: post.metrics?.profileViews ?? null,
        likes: post.metrics?.likes ?? null,
        comments: post.metrics?.comments ?? null,
      };
    });
    return next;
  }, [externalPosts]);

  const localPostMetricsById = useMemo<Record<string, PostMetricSummary>>(() => {
    const next: Record<string, PostMetricSummary> = {};
    Object.entries(postExternalKeysByPostId as Record<string, string[]>).forEach(([postId, keys]) => {
      let merged: PostMetricSummary = { ...EMPTY_POST_METRICS };
      let hasAny = false;
      keys.forEach((key) => {
        const metrics = externalMetricsByKey[key];
        if (!metrics) return;
        merged = {
          impressions: mergeMetricValue(merged.impressions, metrics.impressions),
          profileViews: mergeMetricValue(merged.profileViews, metrics.profileViews),
          likes: mergeMetricValue(merged.likes, metrics.likes),
          comments: mergeMetricValue(merged.comments, metrics.comments),
        };
        hasAny = true;
      });
      if (hasAny) next[postId] = merged;
    });
    return next;
  }, [externalMetricsByKey, postExternalKeysByPostId]);

  const visibleDeletableLocalPostIds = useMemo(() => {
    return unifiedRows
      .filter((row): row is LocalRow => row.source === 'TEPPEN')
      .filter((row) => getCanDelete(row.post))
      .map((row) => row.post.id);
  }, [unifiedRows]);

  const selectedVisibleLocalPostIds = useMemo(() => {
    const visibleSet = new Set(visibleDeletableLocalPostIds);
    return selectedPostIds.filter((id) => visibleSet.has(id));
  }, [selectedPostIds, visibleDeletableLocalPostIds]);

  const toggleSelectAllVisiblePosts = () => {
    if (visibleDeletableLocalPostIds.length === 0) {
      setSelectedPostIds([]);
      return;
    }
    if (selectedVisibleLocalPostIds.length === visibleDeletableLocalPostIds.length) {
      setSelectedPostIds((prev) => prev.filter((id) => !visibleDeletableLocalPostIds.includes(id)));
      return;
    }
    setSelectedPostIds((prev) => Array.from(new Set([...prev, ...visibleDeletableLocalPostIds])));
  };

  const handleBulkDeletePosts = async () => {
    if (selectedVisibleLocalPostIds.length === 0) {
      addNotification('選択エラー', '削除対象の投稿を選択してください。', 'WARNING');
      return;
    }
    if (!window.confirm(`選択した ${selectedVisibleLocalPostIds.length} 件の投稿を削除しますか？`)) {
      return;
    }

    if (!isSupabaseConfigured) {
      addNotification('モック', 'デモでは一括削除できません。', 'INFO');
      return;
    }

    setIsBulkDeletingPosts(true);
    try {
      await postsService.deleteMany(selectedVisibleLocalPostIds);
      addNotification('一括削除完了', `${selectedVisibleLocalPostIds.length} 件の投稿を削除しました。`, 'SUCCESS');
      setSelectedPostIds((prev) => prev.filter((id) => !selectedVisibleLocalPostIds.includes(id)));
      await reload();
    } catch {
      addNotification('一括削除エラー', '投稿の一括削除に失敗しました。', 'ERROR');
    } finally {
      setIsBulkDeletingPosts(false);
    }
  };

  const renderPostMetrics = (metrics: PostMetricSummary) => {
    const items = [
      { key: 'impressions', label: '表示回数', value: metrics.impressions },
      { key: 'profileViews', label: 'プロフィール閲覧', value: metrics.profileViews },
      { key: 'likes', label: 'いいね', value: metrics.likes },
      { key: 'comments', label: 'コメント', value: metrics.comments },
    ];
    return (
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {items.map((item) => (
          <div
            key={item.key}
            className="inline-flex items-center justify-between rounded-md border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/60 px-2 py-1 text-[11px]"
          >
            <span className="text-gray-500 dark:text-gray-300">{item.label}</span>
            <span className="font-semibold text-gray-900 dark:text-white">{formatMetricValue(item.value)}</span>
          </div>
        ))}
      </div>
    );
  };

  const actionButtonBaseClass =
    'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border text-xs font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed';
  const actionButtonClass = {
    neutral: `${actionButtonBaseClass} border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-600`,
    primary: `${actionButtonBaseClass} border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-200 hover:bg-indigo-100 dark:hover:bg-indigo-900/40`,
    success: `${actionButtonBaseClass} border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/40`,
    warning: `${actionButtonBaseClass} border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40`,
    danger: `${actionButtonBaseClass} border-rose-200 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-900/40`,
    info: `${actionButtonBaseClass} border-cyan-200 dark:border-cyan-700 bg-cyan-50 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-200 hover:bg-cyan-100 dark:hover:bg-cyan-900/40`,
  };

  return (
    <div className={PAGE_CONTAINER_CLASS}>
      <div className="flex flex-col gap-3 md:flex-row md:justify-between md:items-center">
        <div>
          <h1 className={PAGE_HEADER_TITLE_CLASS}>{formatViewLabel('POST_LIST')}</h1>
          <p className={PAGE_HEADER_DESCRIPTION_CLASS}>TEPPEN投稿と外部投稿をまとめて確認できます。</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <button
            id="post-list-fetch-external"
            data-testid="post-list-fetch-external"
            type="button"
            onClick={() => void fetchExternalPosts({ force: true })}
            disabled={!activeStoreId || isFetchingExternalPosts}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isFetchingExternalPosts ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            外部投稿を更新
          </button>
          <input
            id="post-list-filter-search"
            data-testid="post-filter-search"
            type="text"
            value={postSearchTerm}
            onChange={(e) => setPostSearchTerm(e.target.value)}
            placeholder="本文で検索"
            className="w-full sm:w-64 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white"
          />
          <select
            id="post-list-filter-status"
            data-testid="post-filter-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'PENDING' | 'REJECTED' | 'FAILED')}
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white"
          >
            <option value="ALL">すべての状態</option>
            <option value="DRAFT">下書き</option>
            <option value="SCHEDULED">予約済み</option>
            <option value="PUBLISHED">公開済み</option>
            <option value="PENDING">承認待ち</option>
            <option value="REJECTED">差し戻し</option>
            <option value="FAILED">エラー</option>
          </select>
          <select
            id="post-list-filter-source"
            data-testid="post-filter-source"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white"
          >
            <option value="ALL">作成元: すべて</option>
            <option value="TEPPEN">作成元: TEPPEN</option>
            <option value="EXTERNAL">作成元: 外部</option>
          </select>
          <select
            id="post-list-filter-platform"
            data-testid="post-filter-platform"
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value as PlatformFilter)}
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white"
          >
            {Object.entries(PLATFORM_FILTER_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label === 'すべて' ? '投稿先: すべて' : `投稿先: ${label}`}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1 text-xs text-gray-500 dark:text-gray-400">
        <p>
          外部投稿の取得モード:
          {remoteAutoFetchEnabled ? ' 自動取得（5分キャッシュ）' : ' 手動更新のみ'}
          {lastExternalFetchedAt ? ` / 最終取得: ${formatDate(lastExternalFetchedAt)}` : ''}
        </p>
        {Object.keys(externalFetchErrors).length > 0 && (
          <p className="text-amber-700 dark:text-amber-300">
            一部取得エラー: {Object.entries(externalFetchErrors).map(([provider, message]) => `${provider}: ${message}`).join(' / ')}
          </p>
        )}
      </div>

      <div className={`${PAGE_CARD_CLASS} p-4 flex flex-wrap items-center justify-between gap-3`}>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          一括削除対象: {selectedVisibleLocalPostIds.length} 件（表示中のTEPPEN投稿のみ）
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleSelectAllVisiblePosts}
            className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg"
          >
            {selectedVisibleLocalPostIds.length === visibleDeletableLocalPostIds.length && visibleDeletableLocalPostIds.length > 0
              ? '選択解除'
              : '表示中を選択'}
          </button>
          <button
            type="button"
            onClick={() => void handleBulkDeletePosts()}
            disabled={selectedVisibleLocalPostIds.length === 0 || isBulkDeletingPosts}
            className="px-3 py-2 text-sm font-medium text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isBulkDeletingPosts ? '削除中...' : `選択削除 (${selectedVisibleLocalPostIds.length})`}
          </button>
        </div>
      </div>

      <div id="post-list-table" className={`${PAGE_CARD_CLASS} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
              <tr>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">選択</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">ステータス</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-1/2">内容</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">プラットフォーム</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">日時</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {unifiedRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-sm text-gray-500 dark:text-gray-400">
                    条件に一致する投稿がありません。
                  </td>
                </tr>
              )}
              {unifiedRows.map((row) =>
                row.source === 'TEPPEN' ? (
                <tr
                  key={row.post.id}
                  data-testid="post-row"
                  data-post-id={row.post.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <td className="px-4 py-4 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={selectedPostIds.includes(row.post.id)}
                      onChange={() => togglePostSelection(row.post.id)}
                      disabled={!getCanDelete(row.post)}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusWithApproval(row.post)}
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-gray-900 dark:text-white line-clamp-2">{row.post.content}</p>
                    {row.post.rejectionReason && (
                      <p className="mt-1 text-xs text-rose-600 dark:text-rose-300">
                        差し戻し理由: {row.post.rejectionReason}
                      </p>
                    )}
                    {(row.post.imageUrls || []).length > 0 && (
                        <div className="mt-2 flex gap-1">
                            {(row.post.imageUrls || []).map((url, i) => (
                                <img key={i} src={url} alt="Post media" className="w-8 h-8 rounded object-cover border border-gray-200 dark:border-gray-600" />
                            ))}
                        </div>
                    )}
                    {renderPostMetrics(localPostMetricsById[row.post.id] || EMPTY_POST_METRICS)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex gap-1">
                      {row.post.platforms.map((p) => (
                        <span key={p} className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600">
                          <SocialPlatformLogo platform={p as 'INSTAGRAM' | 'FACEBOOK' | 'GOOGLE_BUSINESS'} size={12} />
                          {p === 'GOOGLE_BUSINESS' ? 'GBP' : p === 'INSTAGRAM' ? 'IG' : 'FB'}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    <div className="flex items-center gap-2">
                        <Calendar size={14} />
                        {getPostDateText(row.post)}
                    </div>
                    <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">{getStatusLabel(row.post)}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex flex-wrap gap-3 items-center">
                      {getCanEdit(row.post) && (
                        <button
                          onClick={() => openEdit(row.post)}
                          className={actionButtonClass.primary}
                          disabled={getActionDisabled(row.post.id)}
                        >
                          編集
                        </button>
                      )}
                      {getCanDelete(row.post) && (
                        <button
                          onClick={() => handleDelete(row.post.id)}
                          className={actionButtonClass.danger}
                          disabled={getActionDisabled(row.post.id)}
                        >
                          削除
                        </button>
                      )}
                      {getCanShowSubmitApproval(row.post) && (
                        <button
                          onClick={() => void handleSubmitForApproval(row.post.id)}
                          data-testid={`post-submit-approval-${row.post.id}`}
                          className={actionButtonClass.warning}
                          disabled={getActionDisabled(row.post.id)}
                        >
                          承認申請
                        </button>
                      )}
                      {getCanPublishNow(row.post) && (
                        <button
                          onClick={() => void handlePublishNow(row.post)}
                          data-testid={`post-publish-now-${row.post.id}`}
                          className={actionButtonClass.info}
                          disabled={getActionDisabled(row.post.id) || isMultiStoreSelected}
                          title={isMultiStoreSelected ? '複数店舗選択中は実行できません。店舗を1つだけ選択してください。' : undefined}
                        >
                          {publishingNowPostId === row.post.id ? '投稿中...' : 'すぐ投稿'}
                        </button>
                      )}
                      {getCanShowApproveReject(row.post) && (
                        <>
                          <button
                            onClick={() => void handleApprove(row.post.id)}
                            data-testid={`post-approve-${row.post.id}`}
                            className={actionButtonClass.success}
                            disabled={getActionDisabled(row.post.id)}
                          >
                            承認
                          </button>
                          <button
                            onClick={() => void handleReject(row.post.id)}
                            data-testid={`post-reject-${row.post.id}`}
                            className={actionButtonClass.danger}
                            disabled={getActionDisabled(row.post.id)}
                          >
                            差し戻し
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => openHistory(row.post)}
                        className={actionButtonClass.neutral}
                        disabled={getActionDisabled(row.post.id)}
                      >
                        <MessageSquare size={14} />
                        履歴
                      </button>
                    </div>
                  </td>
                </tr>
                ) : (
                  <tr
                    key={row.key}
                    data-testid="post-row-external"
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <td className="px-4 py-4 whitespace-nowrap">
                      <span className="text-gray-300 dark:text-gray-600">—</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col gap-1">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-200">
                          <CheckCircle size={12} />
                          外部投稿
                        </span>
                        <span className="text-[11px] text-gray-400 dark:text-gray-500">公開済み</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-gray-900 dark:text-white line-clamp-2">{row.externalPost.content || '(本文なし)'}</p>
                      <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">外部ID: {row.externalPost.externalPostId}</p>
                      {renderPostMetrics({
                        impressions: row.externalPost.metrics?.impressions ?? null,
                        profileViews: row.externalPost.metrics?.profileViews ?? null,
                        likes: row.externalPost.metrics?.likes ?? null,
                        comments: row.externalPost.metrics?.comments ?? null,
                      })}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <SocialPlatformBadge
                        platform={row.externalPost.provider}
                        size={12}
                        className="px-2 py-0.5 text-[10px] font-bold rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600"
                        labelClassName="text-[10px] font-bold"
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      <div className="flex items-center gap-2">
                        <Calendar size={14} />
                        {formatDate(row.externalPost.createdAt)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      {row.externalPost.permalink ? (
                        <a
                          href={row.externalPost.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={actionButtonClass.primary}
                        >
                          <Link2 size={14} />
                          投稿を開く
                        </a>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">操作なし</span>
                      )}
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editingPost && (
        <ModalPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="w-full max-w-2xl bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <div className="font-bold text-gray-900 dark:text-white">投稿を編集</div>
              <button
                type="button"
                onClick={closeEdit}
                disabled={isSaving}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-300 disabled:opacity-60"
                aria-label="閉じる"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-2">内容</label>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={6}
                  className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl p-3 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-2">
                  予約日時（空にすると下書き）
                </label>
                <input
                  type="datetime-local"
                  value={editScheduledDate}
                  onChange={(e) => setEditScheduledDate(e.target.value)}
                  className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl p-3 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-2">画像</label>
                {isLoadingMedia && (
                  <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2 mb-2">
                    <Loader2 className="animate-spin" size={14} />
                    読み込み中...
                  </div>
                )}

                {existingMedia.length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">既存画像</div>
                    <div className="grid grid-cols-5 gap-2">
                      {existingMedia.map((media) => (
                        <div key={media.id} className="relative aspect-square rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                          {media.signedUrl ? (
                            <img src={media.signedUrl} alt="media" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">no image</div>
                          )}
                          <button
                            type="button"
                            onClick={() => void removeExistingImage(media.id, media.storagePath)}
                            className="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-bold text-gray-600 dark:text-gray-200 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700">
                    <ImageIcon size={16} />
                    画像を追加
                    <input type="file" accept="image/*" multiple className="hidden" onChange={handleImageChange} />
                  </label>
                  <span className="text-xs text-gray-500 dark:text-gray-400">PNG, JPG (Max 10MB)</span>
                </div>
                {newImagePreviews.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">追加画像</div>
                    <div className="grid grid-cols-5 gap-2">
                      {newImagePreviews.map((url, i) => (
                        <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                          <img src={url} alt="preview" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => removeNewImage(i)}
                            className="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/30 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeEdit}
                disabled={isSaving}
                className="px-4 py-2 text-sm font-bold rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void handleSaveEdit()}
                disabled={isSaving}
                className="px-4 py-2 text-sm font-bold rounded-xl bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-70"
              >
                {isSaving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {historyPost && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
            <div className="w-full max-w-2xl bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                <div>
                  <div className="font-bold text-gray-900 dark:text-white">差し戻しコメント履歴</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-1">{historyPost.content}</div>
                </div>
                <button
                  type="button"
                  onClick={closeHistory}
                  disabled={isAddingApprovalComment}
                  className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-300 disabled:opacity-60"
                  aria-label="閉じる"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                {isLoadingHistory ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
                    <Loader2 className="animate-spin" size={16} />
                    履歴を読み込み中...
                  </div>
                ) : approvalComments.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">履歴はまだありません。</p>
                ) : (
                  <div className="space-y-3">
                    {approvalComments.map((entry) => (
                      <div key={entry.id} className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-xs font-semibold px-2 py-1 rounded ${getActionBadgeClass(entry.actionType)}`}>
                            {getActionLabel(entry.actionType)}
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">{formatCommentDate(entry.createdAt)}</span>
                        </div>
                        {entry.comment && (
                          <p className="text-sm text-gray-800 dark:text-gray-100 mt-2 whitespace-pre-wrap">{entry.comment}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {canApprove && (
                <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/30 space-y-2">
                  <label className="block text-xs font-bold text-gray-600 dark:text-gray-300">修正コメントを追加</label>
                  <textarea
                    value={newApprovalComment}
                    onChange={(e) => setNewApprovalComment(e.target.value)}
                    rows={3}
                    placeholder="例: 1行目の表現をもう少し柔らかくしてください。"
                    className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-sm text-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleAddApprovalComment()}
                      disabled={isAddingApprovalComment || !newApprovalComment.trim()}
                      className="px-4 py-2 text-sm font-bold rounded-xl bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isAddingApprovalComment ? '追加中...' : 'コメント追加'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};
