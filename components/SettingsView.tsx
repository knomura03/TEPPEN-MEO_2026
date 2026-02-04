import React, { useEffect, useState } from 'react';
import { User, Role, SocialAccount } from '../types';
import { MOCK_ACCOUNTS } from '../constants';
import { Save, Lock, User as UserIcon, Mail, Link as LinkIcon, AlertTriangle, Key, Shield, MapPin, Store, CreditCard } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';
import { useStore } from '../contexts/StoreContext';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { storesService } from '../services/storesService';
import { profilesService } from '../services/profilesService';
import { authService } from '../services/authService';

interface SettingsViewProps {
  currentUser: User;
  onProfileUpdated?: (user: User) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ currentUser, onProfileUpdated }) => {
  const { addNotification } = useNotification();
  const { activeStoreId, reloadStores } = useStore();
  const [activeTab, setActiveTab] = useState<'PROFILE' | 'STORE' | 'INTEGRATIONS' | 'SYSTEM'>('PROFILE');

  const getProfileSaveErrorMessage = (error: unknown) => {
    const rawMessage = typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: string }).message || '')
        : '';
    if (!rawMessage) return 'ユーザー情報の保存に失敗しました。';

    const message = rawMessage.toLowerCase();
    if (message.includes('invalid login credentials')) {
      return '現在のパスワードが正しくありません。';
    }
    if (message.includes('rate limit')) {
      return 'メール送信の上限に達しました。数分〜1時間ほど待ってから再試行してください（既に届いた確認メールがあればそちらで完了できます）。';
    }
    if (message.includes('already requested')) {
      return 'メール変更は既に申請されています。旧メールに届いた確認メールのリンクを先にクリックしてください。';
    }
    if (message.includes('email') && message.includes('already')) {
      return 'このメールアドレスは既に使用されています。';
    }
    return `ユーザー情報の保存に失敗しました。(${rawMessage})`;
  };
  
  // Profile State
  const [name, setName] = useState(currentUser.name);
  const [email, setEmail] = useState(currentUser.email);
  const [newEmail, setNewEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Store Info State
  const [storeName, setStoreName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [businessHours, setBusinessHours] = useState('');
  const [category, setCategory] = useState('');
  const [isLoadingStore, setIsLoadingStore] = useState(false);
  const [isSavingStore, setIsSavingStore] = useState(false);

  // Integrations State (Mock)
  const [accounts, setAccounts] = useState<SocialAccount[]>(MOCK_ACCOUNTS);

  // System State (Admin Only)
  const [apiKey, setApiKey] = useState('****************************');

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      addNotification('入力エラー', '表示名を入力してください。', 'WARNING');
      return;
    }

    const trimmedCurrentPassword = currentPassword.trim();
    const trimmedNewPassword = newPassword.trim();
    const trimmedNewEmail = newEmail.trim();
    const trimmedEmail = email.trim();

    const wantsPasswordChange = trimmedNewPassword.length > 0;
    const wantsEmailChange = trimmedNewEmail.length > 0 && trimmedNewEmail !== trimmedEmail;
    const hasCurrentPassword = trimmedCurrentPassword.length > 0;

    if ((wantsPasswordChange || wantsEmailChange) && !hasCurrentPassword) {
      addNotification('入力エラー', '現在のパスワードを入力してください。', 'WARNING');
      return;
    }
    if (hasCurrentPassword && !wantsPasswordChange && !wantsEmailChange) {
      addNotification('入力エラー', '変更内容がありません。', 'WARNING');
      return;
    }
    if (wantsPasswordChange && trimmedNewPassword.length < 6) {
      addNotification('入力エラー', '新しいパスワードは6文字以上で入力してください。', 'WARNING');
      return;
    }
    if (wantsEmailChange) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedNewEmail)) {
        addNotification('入力エラー', '新しいメールアドレスの形式が正しくありません。', 'WARNING');
        return;
      }
    }

    if (!isSupabaseConfigured) {
      addNotification('プロフィール更新', 'Supabase未設定のため変更できません。', 'INFO');
      return;
    }

    setIsSavingProfile(true);
    try {
      if (wantsPasswordChange) {
        try {
          await authService.changePassword(trimmedCurrentPassword, trimmedNewPassword);
          setCurrentPassword('');
          setNewPassword('');
          addNotification('パスワード更新', 'パスワードを更新しました。', 'SUCCESS');
        } catch (error) {
          addNotification('パスワード更新エラー', getProfileSaveErrorMessage(error), 'ERROR');
        }
      }

      if (wantsEmailChange) {
        try {
          await authService.changeEmail(trimmedCurrentPassword, trimmedNewEmail);
          setNewEmail('');
          addNotification('メール変更', '確認メールを送信しました。リンクをクリックして完了してください。', 'INFO');
        } catch (error) {
          addNotification('メール変更エラー', getProfileSaveErrorMessage(error), 'ERROR');
        }
      }

      const nextEmail = trimmedEmail ? trimmedEmail : '';
      const profile = await profilesService.upsertProfile(currentUser.id, {
        name: name.trim(),
        email: nextEmail ? nextEmail : null,
        avatarUrl: currentUser.avatarUrl ?? null,
      });
      const updatedUser: User = {
        ...currentUser,
        name: profile.name || name.trim(),
        email: profile.email || nextEmail || trimmedEmail,
        avatarUrl: profile.avatarUrl || currentUser.avatarUrl,
      };
      setName(updatedUser.name);
      setEmail(updatedUser.email);
      onProfileUpdated?.(updatedUser);
      addNotification('プロフィール更新', 'ユーザー情報を保存しました。', 'SUCCESS');
    } catch (error) {
      addNotification('保存エラー', getProfileSaveErrorMessage(error), 'ERROR');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleSaveStore = (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeName.trim()) {
      addNotification('入力エラー', '店舗名を入力してください。', 'WARNING');
      return;
    }
    if (!activeStoreId) {
      addNotification('店舗未選択', '店舗が選択されていません。', 'WARNING');
      return;
    }
    if (!isSupabaseConfigured) {
      addNotification('店舗情報更新', 'Supabase未設定のためローカル表示のみ更新しました。', 'INFO');
      return;
    }

    const normalizeText = (value: string) => {
      const trimmed = value.trim();
      return trimmed.length === 0 ? null : trimmed;
    };

    setIsSavingStore(true);
    storesService
      .updateStore(activeStoreId, {
        name: storeName.trim(),
        address: normalizeText(address),
        phone: normalizeText(phone),
        category: normalizeText(category),
        businessHours: normalizeText(businessHours),
      })
      .then(async (updated) => {
        setStoreName(updated.name);
        setAddress(updated.address || '');
        setPhone(updated.phone || '');
        setCategory(updated.category || '');
        setBusinessHours(updated.businessHours || '');
        await reloadStores();
        addNotification('店舗情報更新', 'MEO対策用の店舗情報を更新しました。', 'SUCCESS');
      })
      .catch(() => {
        addNotification('保存エラー', '店舗情報の保存に失敗しました。', 'ERROR');
      })
      .finally(() => {
        setIsSavingStore(false);
      });
  }

  useEffect(() => {
    const loadProfile = async () => {
      if (!isSupabaseConfigured) {
        setName(currentUser.name);
        setEmail(currentUser.email);
        setNewEmail('');
        return;
      }

      setIsLoadingProfile(true);
      try {
        const profile = await profilesService.getProfile(currentUser.id);
        setName(profile?.name || currentUser.name);
        setEmail(profile?.email || currentUser.email);
        setNewEmail('');
      } catch {
        addNotification('読み込みエラー', 'プロフィール情報の取得に失敗しました。', 'ERROR');
      } finally {
        setIsLoadingProfile(false);
      }
    };

    void loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.id]);

  useEffect(() => {
    const loadStoreInfo = async () => {
      if (!activeStoreId) {
        setStoreName('');
        setAddress('');
        setPhone('');
        setCategory('');
        setBusinessHours('');
        return;
      }

      if (!isSupabaseConfigured) {
        setStoreName('TEPPEN総本店');
        setAddress(currentUser.storeInfo?.address || '');
        setPhone(currentUser.storeInfo?.phone || '');
        setCategory(currentUser.storeInfo?.category || '');
        setBusinessHours(currentUser.storeInfo?.businessHours || '');
        return;
      }

      setIsLoadingStore(true);
      try {
        const store = await storesService.getById(activeStoreId);
        if (store) {
          setStoreName(store.name);
          setAddress(store.address || '');
          setPhone(store.phone || '');
          setCategory(store.category || '');
          setBusinessHours(store.businessHours || '');
        } else {
          addNotification('店舗情報', '店舗データが見つかりません。', 'WARNING');
        }
      } catch {
        addNotification('読み込みエラー', '店舗情報の取得に失敗しました。', 'ERROR');
      } finally {
        setIsLoadingStore(false);
      }
    };

    void loadStoreInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStoreId]);

  const handleToggleConnection = (id: string) => {
    setAccounts(prev => prev.map(acc => {
      if (acc.id === id) {
        const newState = !acc.isConnected;
        addNotification(
          newState ? '連携完了' : '連携解除', 
          `${acc.platform}との連携を${newState ? '開始' : '解除'}しました。`,
          newState ? 'SUCCESS' : 'INFO'
        );
        return { ...acc, isConnected: newState };
      }
      return acc;
    }));
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-white">設定</h1>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden flex flex-col md:flex-row min-h-[600px]">
        {/* Sidebar */}
        <div className="w-full md:w-64 bg-gray-50 dark:bg-gray-900/50 border-r border-gray-100 dark:border-gray-700 p-4">
          <nav className="space-y-2">
            <button
              onClick={() => setActiveTab('PROFILE')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                activeTab === 'PROFILE' 
                  ? 'bg-white dark:bg-gray-800 text-primary-600 shadow-sm font-semibold' 
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <UserIcon size={18} />
              <span>プロフィール・プラン</span>
            </button>
            <button
              onClick={() => setActiveTab('STORE')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                activeTab === 'STORE' 
                  ? 'bg-white dark:bg-gray-800 text-primary-600 shadow-sm font-semibold' 
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <Store size={18} />
              <span>店舗情報 (MEO)</span>
            </button>
            <button
              onClick={() => setActiveTab('INTEGRATIONS')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                activeTab === 'INTEGRATIONS' 
                  ? 'bg-white dark:bg-gray-800 text-primary-600 shadow-sm font-semibold' 
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <LinkIcon size={18} />
              <span>SNS連携設定</span>
            </button>
            {currentUser.role === Role.ADMIN && (
              <button
                onClick={() => setActiveTab('SYSTEM')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  activeTab === 'SYSTEM' 
                    ? 'bg-white dark:bg-gray-800 text-primary-600 shadow-sm font-semibold' 
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <Shield size={18} />
                <span>システム管理</span>
              </button>
            )}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 p-8 overflow-y-auto">
          {activeTab === 'PROFILE' && (
            <div className="max-w-2xl space-y-8">
               {/* Plan Info */}
               <div className="bg-gradient-to-r from-primary-600 to-primary-500 rounded-2xl p-6 text-white shadow-lg">
                   <div className="flex justify-between items-start">
                       <div>
                           <p className="text-primary-100 text-sm font-medium mb-1">現在のプラン</p>
                           <h3 className="text-2xl font-bold">{currentUser.plan || 'FREE'} PLAN</h3>
                           <p className="text-sm text-primary-100 mt-2">次回更新日: 2024年12月31日</p>
                       </div>
                       <CreditCard className="text-primary-200 w-12 h-12 opacity-50" />
                   </div>
               </div>

              <div>
                <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-1">基本情報</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">アカウントの表示名や連絡先情報を管理します。</p>
              </div>

              <form onSubmit={handleSaveProfile} className="space-y-6">
                <div className="flex items-center gap-6">
                  <img 
                    src={currentUser.avatarUrl} 
                    alt="avatar" 
                    className="w-20 h-20 rounded-full object-cover border-4 border-gray-100 dark:border-gray-700 shadow-sm"
                  />
                  <button type="button" className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors">
                    画像を変更
                  </button>
                </div>

                <div className="grid gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">表示名</label>
                    <div className="relative">
                      <UserIcon className="absolute left-3 top-3 text-gray-400" size={18} />
                      <input 
                        type="text" 
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={isLoadingProfile || isSavingProfile}
                        className="pl-10 w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">メールアドレス</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 text-gray-400" size={18} />
                      <input 
                        type="email" 
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled
                        className="pl-10 w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">※ログイン用メールは下で変更できます（確認メールで確定）。</p>
                  </div>
                </div>

                <div className="pt-6 border-t border-gray-100 dark:border-gray-700">
                   <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-4">メールアドレス変更</h3>
                   <div className="grid gap-4 mb-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">新しいメールアドレス</label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-3 text-gray-400" size={18} />
                          <input 
                            type="email" 
                            value={newEmail}
                            onChange={(e) => setNewEmail(e.target.value)}
                            placeholder="example@domain.com"
                            disabled={isSavingProfile}
                            className="pl-10 w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                          />
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">※変更には現在のパスワードが必要です。</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">※確認メールは現在のメールアドレスに届きます。</p>
                      </div>
                   </div>

                   <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-4">パスワード変更</h3>
                   <div className="grid gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">現在のパスワード</label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-3 text-gray-400" size={18} />
                          <input 
                            type="password" 
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            disabled={isSavingProfile}
                            className="pl-10 w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">新しいパスワード</label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-3 text-gray-400" size={18} />
                          <input 
                            type="password" 
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            disabled={isSavingProfile}
                            className="pl-10 w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                          />
                        </div>
                      </div>
                   </div>
                </div>

                <div className="flex justify-end pt-4">
                  <button
                    type="submit"
                    disabled={isLoadingProfile || isSavingProfile}
                    className="flex items-center gap-2 px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-xl shadow-lg shadow-primary-200 dark:shadow-none transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <Save size={18} />
                    {isSavingProfile ? '保存中...' : '保存する'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'STORE' && (
              <div className="max-w-2xl space-y-8">
                  <div>
                    <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-1">店舗情報設定</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Googleマップ等に反映される正確な店舗情報を入力してください。</p>
                  </div>
                  {!activeStoreId && (
                    <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-200 text-sm rounded-xl p-4">
                      店舗が選択されていません。右上の店舗セレクタから選択してください。
                    </div>
                  )}
                  {isLoadingStore && (
                    <div className="text-sm text-gray-500 dark:text-gray-400">店舗情報を読み込み中...</div>
                  )}

                  <form onSubmit={handleSaveStore} className="space-y-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">店舗名 (NAP: Name)</label>
                        <input 
                            type="text" 
                            value={storeName}
                            onChange={(e) => setStoreName(e.target.value)}
                            disabled={isLoadingStore || isSavingStore}
                            className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">住所 (NAP: Address)</label>
                        <div className="relative">
                            <MapPin className="absolute left-3 top-3 text-gray-400" size={18} />
                            <input 
                                type="text" 
                                value={address}
                                onChange={(e) => setAddress(e.target.value)}
                                placeholder="例: 東京都港区六本木..."
                                disabled={isLoadingStore || isSavingStore}
                                className="pl-10 w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                            />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">電話番号 (NAP: Phone)</label>
                            <input 
                                type="text" 
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                placeholder="03-xxxx-xxxx"
                                disabled={isLoadingStore || isSavingStore}
                                className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">カテゴリ</label>
                            <input 
                                type="text" 
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                placeholder="例: イタリア料理店"
                                disabled={isLoadingStore || isSavingStore}
                                className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                            />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">営業時間</label>
                        <textarea 
                            value={businessHours}
                            onChange={(e) => setBusinessHours(e.target.value)}
                            placeholder="月: 10:00-19:00&#10;火: 10:00-19:00..."
                            disabled={isLoadingStore || isSavingStore}
                            className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all h-32"
                        />
                      </div>

                      <div className="flex justify-end pt-4">
                        <button
                          type="submit"
                          disabled={isLoadingStore || isSavingStore}
                          className="flex items-center gap-2 px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-xl shadow-lg shadow-primary-200 dark:shadow-none transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            <Save size={18} />
                            {isSavingStore ? '保存中...' : '店舗情報を保存'}
                        </button>
                    </div>
                  </form>
              </div>
          )}

          {activeTab === 'INTEGRATIONS' && (
            <div className="max-w-3xl space-y-6">
              <div>
                <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-1">SNS連携設定</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">投稿や分析を行うアカウントを接続します。</p>
              </div>

              <div className="grid gap-4">
                {accounts.map(account => (
                  <div key={account.id} className="flex items-center justify-between p-5 bg-white dark:bg-gray-700 border border-gray-100 dark:border-gray-600 rounded-2xl shadow-sm hover:shadow-md transition-all">
                    <div className="flex items-center gap-4">
                      <div className={`
                        w-12 h-12 rounded-full flex items-center justify-center text-white text-xl font-bold
                        ${account.platform === 'INSTAGRAM' ? 'bg-gradient-to-tr from-yellow-400 to-purple-600' : 
                          account.platform === 'FACEBOOK' ? 'bg-blue-600' :
                          account.platform === 'GOOGLE_BUSINESS' ? 'bg-blue-500' :
                           'bg-gray-400'}
                      `}>
                        {account.platform[0]}
                      </div>
                      <div>
                        <h3 className="font-bold text-gray-800 dark:text-white">{account.name}</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{account.handle}</p>
                      </div>
                    </div>
                    <div>
                      {account.isConnected ? (
                        <button 
                          onClick={() => handleToggleConnection(account.id)}
                          className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 rounded-lg transition-colors"
                        >
                          連携解除
                        </button>
                      ) : (
                        <button 
                          onClick={() => handleToggleConnection(account.id)}
                          className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg shadow-md shadow-primary-200 dark:shadow-none transition-all"
                        >
                          連携する
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                
                {currentUser.role === Role.ADMIN && (
                   <div className="mt-4 p-4 border border-dashed border-gray-300 dark:border-gray-600 rounded-xl text-center">
                      <button className="text-primary-600 font-medium hover:underline">+ 新しいプラットフォームを追加 (Admin Only)</button>
                   </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'SYSTEM' && currentUser.role === Role.ADMIN && (
             <div className="max-w-2xl space-y-8">
               <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 p-4 rounded-xl flex gap-3">
                 <AlertTriangle className="text-orange-600 dark:text-orange-400 flex-shrink-0" />
                 <div>
                   <h3 className="font-bold text-orange-800 dark:text-orange-300 text-sm">開発者エリア</h3>
                   <p className="text-xs text-orange-700 dark:text-orange-400 mt-1">この設定を変更するとシステム全体に影響が及びます。</p>
                 </div>
               </div>

               <div>
                 <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-4">API設定</h2>
                 <div className="space-y-4">
                   <div>
                     <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Google Gemini API Key</label>
                     <div className="flex gap-2">
                       <div className="relative flex-1">
                          <Key className="absolute left-3 top-3 text-gray-400" size={18} />
                          <input 
                            type="password" 
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            className="pl-10 w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl font-mono text-sm"
                          />
                       </div>
                       <button className="px-4 py-2 bg-gray-800 text-white rounded-xl text-sm hover:bg-gray-900 transition-colors">更新</button>
                     </div>
                   </div>
                 </div>
               </div>
               
               <div>
                  <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-4">システムメンテナンス</h2>
                  <div className="flex gap-4">
                    <button className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50">キャッシュクリア</button>
                    <button className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50">ログダウンロード</button>
                  </div>
               </div>
             </div>
          )}
        </div>
      </div>
    </div>
  );
};
