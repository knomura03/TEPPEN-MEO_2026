import React, { useEffect, useMemo, useState } from 'react';
import { User, Role } from '../types';
import { MOCK_USERS } from '../constants';
import { Trash2, UserPlus, Download, Edit2, Mail, MoreVertical, TrendingUp, Users as UsersIcon, Award, Clock } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { userManagementService } from '../services/userManagementService';
import { useStore } from '../contexts/StoreContext';
import { supabase } from '../services/supabaseClient';

interface UserManagementProps {
  currentUser: User;
}

export const UserManagement: React.FC<UserManagementProps> = ({ currentUser }) => {
  const { addNotification } = useNotification();
  const { stores, activeStoreId } = useStore();
  const [users, setUsers] = useState<User[]>(MOCK_USERS);
  const [isLoading, setIsLoading] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>(Role.USER);
  const [inviteStoreId, setInviteStoreId] = useState<string>('');
  const [isInviting, setIsInviting] = useState(false);

  const activeOrgId = useMemo(() => {
    if (!activeStoreId) return null;
    const store = stores.find((s) => s.id === activeStoreId);
    return store?.orgId || null;
  }, [activeStoreId, stores]);

  useEffect(() => {
    if (!inviteStoreId && activeStoreId) {
      setInviteStoreId(activeStoreId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStoreId]);

  const loadUsers = async (orgId: string | null) => {
    if (!isSupabaseConfigured) {
      setUsers(MOCK_USERS);
      return;
    }
    if (!orgId) {
      setUsers([]);
      return;
    }
    setIsLoading(true);
    try {
      const data = await userManagementService.listUsersByOrg(orgId);
      setUsers(data);
    } catch {
      addNotification('読み込みエラー', 'ユーザー一覧の取得に失敗しました。', 'ERROR');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const loadUsers = async () => {
      await loadUsers(activeOrgId);
    };

    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);
  
  const canManage = (targetUser: User) => {
    if (currentUser.role === Role.ADMIN) return true;
    if (currentUser.role === Role.MANAGER) {
      return targetUser.role === Role.USER;
    }
    return false;
  };

  const handleDelete = (userId: string) => {
    if (window.confirm('本当にこのユーザーを削除しますか？これにより、ユーザーの契約およびデータが完全に削除されます。')) {
      if (!isSupabaseConfigured) {
        setUsers((prev) => prev.filter(u => u.id !== userId));
        addNotification('ユーザー削除完了', 'ユーザーと関連データを削除しました。', 'SUCCESS');
        return;
      }
      if (!activeOrgId) {
        addNotification('店舗未選択', '店舗が選択されていません。', 'WARNING');
        return;
      }
      setDeletingUserId(userId);
      userManagementService
        .removeUserFromOrg(activeOrgId, userId)
        .then(() => {
          setUsers((prev) => prev.filter(u => u.id !== userId));
          addNotification('ユーザー削除完了', 'ユーザーの所属を解除しました。', 'SUCCESS');
        })
        .catch(() => {
          addNotification('削除エラー', 'ユーザーの削除に失敗しました。', 'ERROR');
        })
        .finally(() => {
          setDeletingUserId(null);
        });
    }
  };

  const handleInvite = async () => {
    if (!inviteName.trim() || !inviteEmail.trim()) {
      addNotification('入力エラー', '名前とメールアドレスを入力してください。', 'WARNING');
      return;
    }
    if (!inviteStoreId) {
      addNotification('店舗未選択', '店舗を選択してください。', 'WARNING');
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      addNotification('準備中', 'Supabase未設定のため招待できません。', 'INFO');
      return;
    }

    setIsInviting(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-create-user', {
        body: {
          name: inviteName.trim(),
          email: inviteEmail.trim(),
          role: inviteRole,
          storeId: inviteStoreId,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      addNotification('招待完了', '招待メールを送信しました。', 'SUCCESS');
      setInviteName('');
      setInviteEmail('');
      setInviteRole(Role.USER);
      setIsInviteOpen(false);
      await loadUsers(activeOrgId);
    } catch (err) {
      const message = err && typeof err === 'object' && 'message' in err ? String((err as { message?: string }).message || '') : '招待に失敗しました。';
      addNotification('招待エラー', message || '招待に失敗しました。', 'ERROR');
    } finally {
      setIsInviting(false);
    }
  };

  const handleExport = () => {
    // CSV Export Mock
    const headers = ['ID', 'Username', 'Name', 'Email', 'Role', 'Plan', 'Registered At'];
    const csvContent = [
        headers.join(','),
        ...users.map(u => [u.id, u.username, u.name, u.email, u.role, u.plan, u.lastLoginAt.toISOString()].join(','))
    ].join('\n');
    
    // 実際にはBlobを作成してダウンロードさせる
    console.log(csvContent);
    addNotification('エクスポート完了', 'ユーザーリストをCSVとしてダウンロードしました。', 'SUCCESS');
  };

  const roleLabel = (role: Role) => {
    switch (role) {
      case Role.ADMIN: return '開発者 (Admin)';
      case Role.MANAGER: return '代理店 (Manager)';
      case Role.USER: return '店舗 (User)';
      default: return role;
    }
  };

  const roleColor = (role: Role) => {
    switch (role) {
      case Role.ADMIN: return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800';
      case Role.MANAGER: return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800';
      case Role.USER: return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800';
    }
  };

  // Stats
  const totalUsers = users.length;
  const activeUsers = users.filter(u => new Date().getTime() - u.lastLoginAt.getTime() < 7 * 24 * 60 * 60 * 1000).length; // Past 7 days (registered)
  const newThisMonth = 2; // Mock

  const StatCard = ({ title, value, icon: Icon, color }: any) => (
      <div className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm flex items-center gap-4">
          <div className={`p-3 rounded-xl ${color} bg-opacity-10 text-white`}>
              <Icon className={`w-6 h-6 ${color.replace('bg-', 'text-')}`} />
          </div>
          <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">{title}</p>
              <p className="text-2xl font-bold text-gray-800 dark:text-white">{value}</p>
          </div>
      </div>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white">ユーザー・契約管理</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {currentUser.role === Role.ADMIN 
              ? 'システム全体の全ユーザーおよび代理店を管理します。' 
              : '契約店舗（一般ユーザー）のアカウント管理を行います。'}
          </p>
        </div>
        <div className="flex gap-3">
            <button 
                onClick={handleExport}
                className="flex items-center space-x-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-white px-4 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-600 transition-all"
            >
                <Download size={18} />
                <span>CSVエクスポート</span>
            </button>
            <button
                onClick={() => setIsInviteOpen(true)}
                className="flex items-center space-x-2 bg-primary-600 text-white px-4 py-2 rounded-xl hover:bg-primary-700 shadow-md shadow-primary-200 dark:shadow-none transition-all"
            >
                <UserPlus size={18} />
                <span>新規ユーザー作成</span>
            </button>
        </div>
      </div>

      {!activeOrgId && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-200 text-sm rounded-xl p-4">
          店舗が選択されていません。右上の店舗セレクタから選択してください。
        </div>
      )}

      {/* KPI Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatCard title="総契約アカウント" value={totalUsers} icon={UsersIcon} color="bg-blue-500" />
          <StatCard title="直近7日登録" value={activeUsers} icon={TrendingUp} color="bg-green-500" />
          <StatCard title="今月の新規契約" value={newThisMonth} icon={Award} color="bg-purple-500" />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">ユーザー情報</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">契約プラン</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">権限ロール</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">登録日</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-right">アクション</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {isLoading && (
                <tr>
                  <td colSpan={5} className="px-6 py-6 text-sm text-gray-500 dark:text-gray-400">読み込み中...</td>
                </tr>
              )}
              {!isLoading && users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-6 text-sm text-gray-500 dark:text-gray-400">ユーザーがいません。</td>
                </tr>
              )}
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10">
                        <img className="h-10 w-10 rounded-full bg-gray-200 dark:bg-gray-600 object-cover border border-gray-200 dark:border-gray-600" src={user.avatarUrl} alt="" />
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-bold text-gray-900 dark:text-white">{user.name}</div>
                        <div className="flex items-center text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                             <Mail size={12} className="mr-1" />
                             {user.email || '未設定'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex flex-col">
                        <span className="text-sm font-bold text-gray-800 dark:text-white">{user.plan || 'FREE'}</span>
                        <span className="text-xs text-gray-400">次回更新: 2024/12/31</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-3 py-1 inline-flex text-xs leading-5 font-bold rounded-full border ${roleColor(user.role)}`}>
                      {roleLabel(user.role)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center text-sm text-gray-600 dark:text-gray-300">
                        <Clock size={14} className="mr-2 text-gray-400" />
                        {user.lastLoginAt ? user.lastLoginAt.toLocaleDateString() : '—'}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    {/* 自分自身は編集不可。権限ロジックに基づく表示 */}
                    {user.id !== currentUser.id && canManage(user) ? (
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          className="p-2 text-gray-500 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400 bg-gray-100 dark:bg-gray-700 rounded-lg transition-colors"
                          title="詳細編集"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          onClick={() => handleDelete(user.id)}
                          disabled={deletingUserId === user.id}
                          className="p-2 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 bg-red-50 dark:bg-red-900/20 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                          title="削除"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ) : (
                      <div className="text-gray-300 dark:text-gray-600 text-xs italic">
                        {user.id === currentUser.id ? 'あなた' : '操作権限なし'}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isInviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-xl p-6">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">新規ユーザー作成（招待）</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">名前</label>
                <input
                  type="text"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">メールアドレス</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">権限ロール</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as Role)}
                    className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                  >
                    {currentUser.role === Role.ADMIN && (
                      <>
                        <option value={Role.ADMIN}>ADMIN</option>
                        <option value={Role.MANAGER}>MANAGER</option>
                      </>
                    )}
                    <option value={Role.USER}>USER</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">店舗</label>
                  <select
                    value={inviteStoreId}
                    onChange={(e) => setInviteStoreId(e.target.value)}
                    className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                  >
                    <option value="">選択してください</option>
                    {stores.map((store) => (
                      <option key={store.id} value={store.id}>
                        {store.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                招待メールはSupabaseから送信されます。MANAGER/ADMINは全店アクセス、USERは選択店舗に所属します。
              </p>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setIsInviteOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg"
              >
                キャンセル
              </button>
              <button
                onClick={handleInvite}
                disabled={isInviting}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isInviting ? '送信中...' : '招待を送信'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
