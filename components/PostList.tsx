import React, { useEffect, useState } from 'react';
import { MOCK_POSTS } from '../constants';
import { Post, PostApprovalActionType, PostApprovalComment, PostStatus, Role, User } from '../types';
import { Clock, CheckCircle, AlertCircle, Calendar, X, Image as ImageIcon, Loader2, MessageSquare } from 'lucide-react';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { postsService } from '../services/postsService';
import { postPublishService } from '../services/postPublishService';
import { getErrorMessage } from '../services/errorMessage';
import { useNotification } from '../contexts/NotificationContext';
import { useStore } from '../contexts/StoreContext';
import { postMediaService } from '../services/postMediaService';
import { ModalPortal } from './ModalPortal';

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

export const PostList: React.FC<PostListProps> = ({ currentUser }) => {
  const { addNotification } = useNotification();
  const { activeStoreId } = useStore();
  const canApprove = currentUser.role === Role.ADMIN || currentUser.role === Role.MANAGER;
  const isRequester = currentUser.role === Role.USER;
  const [posts, setPosts] = useState<Post[]>(MOCK_POSTS);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editScheduledDate, setEditScheduledDate] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [approvalProcessingPostId, setApprovalProcessingPostId] = useState<string | null>(null);
  const [publishingInstagramPostId, setPublishingInstagramPostId] = useState<string | null>(null);
  const [publishingFacebookPostId, setPublishingFacebookPostId] = useState<string | null>(null);
  const [historyPost, setHistoryPost] = useState<Post | null>(null);
  const [approvalComments, setApprovalComments] = useState<PostApprovalComment[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [newApprovalComment, setNewApprovalComment] = useState('');
  const [isAddingApprovalComment, setIsAddingApprovalComment] = useState(false);
  const [existingMedia, setExistingMedia] = useState<{ id: string; storagePath: string; signedUrl?: string }[]>([]);
  const [isLoadingMedia, setIsLoadingMedia] = useState(false);
  const [newImages, setNewImages] = useState<File[]>([]);
  const [newImagePreviews, setNewImagePreviews] = useState<string[]>([]);
  const maxFileSizeBytes = 10 * 1024 * 1024;

  const reload = async () => {
    if (!isSupabaseConfigured) {
      setPosts(MOCK_POSTS);
      return;
    }
    if (!activeStoreId) {
      setPosts([]);
      return;
    }
    try {
      const data = await postsService.listByStore(activeStoreId);
      setPosts(data);
    } catch {
      addNotification('読み込みエラー', '投稿の取得に失敗しました。', 'ERROR');
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStoreId]);

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

  const handlePublishInstagram = async (postId: string) => {
    if (!isSupabaseConfigured) {
      addNotification('モック', 'デモではInstagram投稿を実行できません。', 'INFO');
      return;
    }
    setPublishingInstagramPostId(postId);
    try {
      const result = await postPublishService.publishInstagramPost({
        postId,
        actorUserId: currentUser.id,
      });
      addNotification(
        'Instagram投稿完了',
        result.mode === 'REAL'
          ? 'Instagramへの投稿が完了しました。'
          : 'MOCK投稿として完了しました（GUI設定未完了のため）。',
        'SUCCESS'
      );
      await reload();
    } catch (error) {
      addNotification(
        'Instagram投稿エラー',
        getErrorMessage(error) || 'Instagram投稿の実行に失敗しました。',
        'ERROR'
      );
      await reload();
    } finally {
      setPublishingInstagramPostId(null);
    }
  };

  const handlePublishFacebook = async (postId: string) => {
    if (!isSupabaseConfigured) {
      addNotification('モック', 'デモではFacebook投稿を実行できません。', 'INFO');
      return;
    }
    setPublishingFacebookPostId(postId);
    try {
      const result = await postPublishService.publishFacebookPost({
        postId,
        actorUserId: currentUser.id,
      });
      addNotification(
        'Facebook投稿完了',
        result.mode === 'REAL'
          ? 'Facebookへの投稿が完了しました。'
          : 'MOCK投稿として完了しました（GUI設定未完了のため）。',
        'SUCCESS'
      );
      await reload();
    } catch (error) {
      addNotification(
        'Facebook投稿エラー',
        getErrorMessage(error) || 'Facebook投稿の実行に失敗しました。',
        'ERROR'
      );
      await reload();
    } finally {
      setPublishingFacebookPostId(null);
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
      publishingInstagramPostId === postId ||
      publishingFacebookPostId === postId ||
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

  const getCanPublishInstagram = (post: Post) => {
    if (!canApprove) return false;
    if (!post.platforms.includes('INSTAGRAM')) return false;
    if (post.approvalStatus !== 'APPROVED') return false;
    if (post.status === PostStatus.PUBLISHED) return false;
    if (post.scheduledDate && post.scheduledDate.getTime() > Date.now()) return false;
    return true;
  };

  const getCanPublishFacebook = (post: Post) => {
    if (!canApprove) return false;
    if (!post.platforms.includes('FACEBOOK')) return false;
    if (post.approvalStatus !== 'APPROVED') return false;
    if (post.status === PostStatus.PUBLISHED) return false;
    if (post.scheduledDate && post.scheduledDate.getTime() > Date.now()) return false;
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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">投稿管理</h1>
        <div className="flex gap-2">
            <select className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1 text-sm bg-white dark:bg-gray-700 dark:text-white">
                <option>すべてのステータス</option>
                <option>公開済み</option>
                <option>予約済み</option>
                <option>承認待ち</option>
                <option>差し戻し</option>
            </select>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
              <tr>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">ステータス</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-1/2">内容</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">プラットフォーム</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">日時</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {posts.map((post) => (
                <tr key={post.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusWithApproval(post)}
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-gray-900 dark:text-white line-clamp-2">{post.content}</p>
                    {post.rejectionReason && (
                      <p className="mt-1 text-xs text-rose-600 dark:text-rose-300">
                        差し戻し理由: {post.rejectionReason}
                      </p>
                    )}
                    {(post.imageUrls || []).length > 0 && (
                        <div className="mt-2 flex gap-1">
                            {(post.imageUrls || []).map((url, i) => (
                                <img key={i} src={url} alt="Post media" className="w-8 h-8 rounded object-cover border border-gray-200 dark:border-gray-600" />
                            ))}
                        </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex gap-1">
                      {post.platforms.map((p) => (
                        <span key={p} className="inline-block px-2 py-0.5 text-[10px] font-bold rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600">
                          {p.slice(0, 1)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    <div className="flex items-center gap-2">
                        <Calendar size={14} />
                        {getPostDateText(post)}
                    </div>
                    <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">{getStatusLabel(post)}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex flex-wrap gap-3 items-center">
                      {getCanEdit(post) && (
                        <button
                          onClick={() => openEdit(post)}
                          className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-900 dark:hover:text-indigo-300 disabled:opacity-60"
                          disabled={getActionDisabled(post.id)}
                        >
                          編集
                        </button>
                      )}
                      {getCanDelete(post) && (
                        <button
                          onClick={() => handleDelete(post.id)}
                          className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300 disabled:opacity-60"
                          disabled={getActionDisabled(post.id)}
                        >
                          削除
                        </button>
                      )}
                      {getCanShowSubmitApproval(post) && (
                        <button
                          onClick={() => void handleSubmitForApproval(post.id)}
                          className="text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-200 disabled:opacity-60"
                          disabled={getActionDisabled(post.id)}
                        >
                          承認申請
                        </button>
                      )}
                      {getCanPublishInstagram(post) && (
                        <button
                          onClick={() => void handlePublishInstagram(post.id)}
                          className="text-blue-700 dark:text-blue-300 hover:text-blue-900 dark:hover:text-blue-200 disabled:opacity-60"
                          disabled={getActionDisabled(post.id)}
                        >
                          {publishingInstagramPostId === post.id ? '投稿中...' : 'Instagram投稿'}
                        </button>
                      )}
                      {getCanPublishFacebook(post) && (
                        <button
                          onClick={() => void handlePublishFacebook(post.id)}
                          className="text-cyan-700 dark:text-cyan-300 hover:text-cyan-900 dark:hover:text-cyan-200 disabled:opacity-60"
                          disabled={getActionDisabled(post.id)}
                        >
                          {publishingFacebookPostId === post.id ? '投稿中...' : 'Facebook投稿'}
                        </button>
                      )}
                      {getCanShowApproveReject(post) && (
                        <>
                          <button
                            onClick={() => void handleApprove(post.id)}
                            className="text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 dark:hover:text-emerald-200 disabled:opacity-60"
                            disabled={getActionDisabled(post.id)}
                          >
                            承認
                          </button>
                          <button
                            onClick={() => void handleReject(post.id)}
                            className="text-rose-700 dark:text-rose-300 hover:text-rose-900 dark:hover:text-rose-200 disabled:opacity-60"
                            disabled={getActionDisabled(post.id)}
                          >
                            差し戻し
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => openHistory(post)}
                        className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white disabled:opacity-60 inline-flex items-center gap-1"
                        disabled={getActionDisabled(post.id)}
                      >
                        <MessageSquare size={14} />
                        履歴
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
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

            <div className="p-5 space-y-4">
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

              <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
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
