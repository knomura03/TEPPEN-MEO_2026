import React, { useEffect, useState } from 'react';
import { MOCK_POSTS } from '../constants';
import { Post, PostStatus } from '../types';
import { Clock, CheckCircle, AlertCircle, Calendar } from 'lucide-react';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { postsService } from '../services/postsService';
import { useNotification } from '../contexts/NotificationContext';
import { useStore } from '../contexts/StoreContext';

const formatDate = (date: Date) => {
  const y = date.getFullYear();
  const m = ('0' + (date.getMonth() + 1)).slice(-2);
  const d = ('0' + date.getDate()).slice(-2);
  const h = ('0' + date.getHours()).slice(-2);
  const min = ('0' + date.getMinutes()).slice(-2);
  return `${y}/${m}/${d} ${h}:${min}`;
};

export const PostList: React.FC = () => {
  const { addNotification } = useNotification();
  const { activeStoreId } = useStore();
  const [posts, setPosts] = useState<Post[]>(MOCK_POSTS);

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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">投稿管理</h1>
        <div className="flex gap-2">
            <select className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1 text-sm bg-white dark:bg-gray-700 dark:text-white">
                <option>すべてのステータス</option>
                <option>公開済み</option>
                <option>予約済み</option>
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
                    {getStatusBadge(post.status)}
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-gray-900 dark:text-white line-clamp-2">{post.content}</p>
                    {post.imageUrls.length > 0 && (
                        <div className="mt-2 flex gap-1">
                            {post.imageUrls.map((url, i) => (
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
                        {post.scheduledDate 
                            ? formatDate(post.scheduledDate) 
                            : post.publishedDate ? formatDate(post.publishedDate) : '-'}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <button className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-900 dark:hover:text-indigo-300 mr-3">編集</button>
                    <button
                      onClick={() => handleDelete(post.id)}
                      className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
