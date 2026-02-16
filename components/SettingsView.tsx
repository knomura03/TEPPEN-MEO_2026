import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Mail,
  AlertTriangle,
  Camera,
  Key,
  Link as LinkIcon,
  Lock,
  Save,
  Settings,
  ShieldCheck,
  Store,
  User as UserIcon,
} from 'lucide-react';
import { FeatureFlag, Role, User, VisibilityState } from '../types';
import { DEFAULT_FEATURE_VISIBILITY } from '../constants';
import { useNotification } from '../contexts/NotificationContext';
import { useStore } from '../contexts/StoreContext';
import { resolveFeatureState, featureFlagsService } from '../services/featureFlagsService';
import { authService } from '../services/authService';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { getErrorMessage } from '../services/errorMessage';
import { profilesService } from '../services/profilesService';
import { avatarService } from '../services/avatarService';
import {
  PAGE_CONTAINER_CLASS,
  PAGE_HEADER_DESCRIPTION_CLASS,
  PAGE_HEADER_TITLE_CLASS,
  PAGE_SECTION_DESCRIPTION_CLASS,
  PAGE_SECTION_TITLE_CLASS,
  PAGE_WARNING_CLASS,
} from './ui/pageLayout';
import { SYSTEM_FEATURE_OPTIONS } from './ui/copy';
import {
  resetSidebarNavLabels,
  resetSidebarNavOrder,
  getSidebarNavLabels,
  getSidebarNavOrder,
  setSidebarNavLabels,
  setSidebarNavOrder,
  SidebarNavLabelMap,
  SidebarNavView,
} from '../services/navigationOrderService';
import { Avatar } from './ui/Avatar';

interface SettingsViewProps {
  currentUser: User;
  onProfileUpdated?: (user: User) => void;
}

type SettingsTab = 'PROFILE' | 'SYSTEM';
const SETTINGS_INITIAL_TAB_STORAGE_KEY = 'teppen_meo_settings_initial_tab';
const FEATURE_FLAG_OPTIONS: typeof SYSTEM_FEATURE_OPTIONS = SYSTEM_FEATURE_OPTIONS;

const resolveInitialSettingsTab = (): SettingsTab => {
  if (typeof window === 'undefined') {
    return 'PROFILE';
  }
  const raw = localStorage.getItem(SETTINGS_INITIAL_TAB_STORAGE_KEY);
  if (raw === 'SYSTEM') return 'SYSTEM';
  if (raw === 'PROFILE') return 'PROFILE';
  return 'PROFILE';
};

const canAccessByFlag = (
  flags: FeatureFlag[],
  featureKey: string,
  storeId?: string
): boolean => {
  return resolveFeatureState(flags, featureKey, storeId) !== 'HIDDEN';
};

const getFeatureStateLabel = (state: VisibilityState): string => {
  if (state === 'ENABLED') return '全体公開';
  if (state === 'ADMIN_ONLY') return '内部のみ';
  return '非表示';
};

const normalizeNavLabel = (value: string): string => value.trim().slice(0, 24);

export const SettingsView: React.FC<SettingsViewProps> = ({ currentUser, onProfileUpdated }) => {
  const { addNotification } = useNotification();
  const { stores, selectedStoreIds, activeStoreId, activeStoreId: storeIdForSingleOnly, filteredStores } = useStore();

  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    const tab = resolveInitialSettingsTab();
    localStorage.removeItem(SETTINGS_INITIAL_TAB_STORAGE_KEY);
    return tab;
  });

  const isInternal = currentUser.role === Role.ADMIN || currentUser.role === Role.SUPERVISOR;
  const isAdmin = currentUser.role === Role.ADMIN;
  const isMultiStoreSelected = selectedStoreIds.length > 1;

  const activeOrgId = useMemo(() => {
    if (activeStoreId) {
      return stores.find((store) => store.id === activeStoreId)?.orgId || null;
    }
    const firstStore = filteredStores[0];
    return firstStore?.orgId || null;
  }, [activeStoreId, stores, filteredStores]);

  // Profile states
  const [name, setName] = useState(currentUser.name);
  const [email, setEmail] = useState(currentUser.email);
  const [avatarUrl, setAvatarUrl] = useState(currentUser.avatarUrl || '');
  const [newEmail, setNewEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const lastProfileSaveMessageRef = useRef<string | null>(null);

  // Feature/システム states
  const [featureFlags, setFeatureFlags] = useState<FeatureFlag[]>([]);
  const [isLoadingFlags, setIsLoadingFlags] = useState(false);
  const [updatingFeatureKey, setUpdatingFeatureKey] = useState<string | null>(null);
  const [sidebarMenuOrder, setSidebarMenuOrderState] = useState<SidebarNavView[]>(() => getSidebarNavOrder());
  const [sidebarMenuLabels, setSidebarMenuLabelsState] = useState<SidebarNavLabelMap>(() => getSidebarNavLabels());
  const [draggingMenuId, setDraggingMenuId] = useState<SidebarNavView | null>(null);

  const canShowProfileTab = canAccessByFlag(featureFlags, 'settings_profile');
  const canShowSystemTab = isInternal && canAccessByFlag(featureFlags, 'settings_system', storeIdForSingleOnly || undefined);

  useEffect(() => {
    const tabs = [] as SettingsTab[];
    if (canShowProfileTab) tabs.push('PROFILE');
    if (canShowSystemTab) tabs.push('SYSTEM');
    if (!tabs.includes(activeTab)) {
      setActiveTab(tabs[0] || 'PROFILE');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canShowProfileTab, canShowSystemTab]);

  useEffect(() => {
    if (!isSupabaseConfigured || !activeOrgId) {
      setFeatureFlags([]);
      return;
    }
    const loadFlags = async () => {
      setIsLoadingFlags(true);
      try {
        const next = await featureFlagsService.listByOrg(activeOrgId, selectedStoreIds.length === 1 ? activeStoreId || undefined : undefined);
        setFeatureFlags(next);
      } catch (error) {
        console.error('[SettingsView] Failed to load feature flags:', error);
        addNotification('読み込みエラー', `機能設定の読込に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
        setFeatureFlags([]);
      } finally {
        setIsLoadingFlags(false);
      }
    };
    void loadFlags();
  }, [activeOrgId, selectedStoreIds.length, activeStoreId, addNotification]);

  const handleAvatarClick = () => {
    avatarInputRef.current?.click();
  };

  const handleAvatarChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (!file) return;
    if (!isSupabaseConfigured) {
      addNotification('画像変更', 'Supabase未設定のため画像を更新できません。', 'WARNING');
      return;
    }
    setIsUploadingAvatar(true);
    try {
      const nextUrl = await avatarService.uploadForUser({ userId: currentUser.id, file, previousAvatarUrl: avatarUrl || null });
      const profile = await profilesService.upsertProfile(currentUser.id, {
        name,
        email: email,
        avatarUrl: nextUrl,
      });
      const updatedUser: User = {
        ...currentUser,
        name: profile.name || name,
        email: profile.email || email,
        avatarUrl: profile.avatarUrl || nextUrl,
      };
      setAvatarUrl(updatedUser.avatarUrl || '');
      onProfileUpdated?.(updatedUser);
      addNotification('画像更新', 'プロフィール画像を更新しました。', 'SUCCESS');
    } catch (error) {
      addNotification('画像更新エラー', `プロフィール画像の更新に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    } finally {
      setIsUploadingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  const handleSaveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedCurrentPassword = currentPassword.trim();
    const trimmedNewPassword = newPassword.trim();
    const trimmedNewEmail = newEmail.trim();
    const wantsPassword = trimmedCurrentPassword.length > 0 || trimmedNewPassword.length > 0;
    const wantsEmail = trimmedNewEmail.length > 0;

    if (!trimmedName) {
      addNotification('入力エラー', '表示名を入力してください。', 'WARNING');
      return;
    }
    if ((wantsPassword || wantsEmail) && trimmedCurrentPassword.length === 0) {
      addNotification('入力エラー', '現在のパスワードを入力してください。', 'WARNING');
      return;
    }
    if (wantsPassword && trimmedNewPassword.length < 6) {
      addNotification('入力エラー', '新しいパスワードは6文字以上で入力してください。', 'WARNING');
      return;
    }
    if (wantsEmail) {
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedNewEmail);
      if (!isEmail) {
        addNotification('入力エラー', 'メールアドレスの形式が正しくありません。', 'WARNING');
        return;
      }
    }

    if (!isSupabaseConfigured) {
      addNotification('プロフィール更新', 'Supabase未設定のため保存できません。', 'INFO');
      return;
    }

    setIsSavingProfile(true);
    try {
      if (wantsPassword) {
        await authService.changePassword(trimmedCurrentPassword, trimmedNewPassword);
      }
      if (wantsEmail) {
        await authService.changeEmail(trimmedCurrentPassword, trimmedNewEmail);
        setNewEmail('');
        addNotification('メール変更', '確認メールを送信しました。メール内リンクを開いて反映してください。', 'INFO');
      }

      const profile = await profilesService.upsertProfile(currentUser.id, {
        name: trimmedName,
        email: email || (trimmedNewEmail ? trimmedNewEmail : null),
        avatarUrl: avatarUrl || null,
      });
      const updatedUser: User = {
        ...currentUser,
        name: profile.name || trimmedName,
        email: profile.email || email,
        avatarUrl: profile.avatarUrl || avatarUrl,
      };
      setName(updatedUser.name);
      setEmail(updatedUser.email || '');
      setCurrentPassword('');
      setNewPassword('');
      setAvatarUrl(updatedUser.avatarUrl || '');
      lastProfileSaveMessageRef.current = `profileSaved:${Date.now()}`;
      onProfileUpdated?.(updatedUser);
      addNotification('保存完了', 'プロフィールを更新しました。', 'SUCCESS');
    } catch (error) {
      addNotification('保存エラー', `プロフィール更新に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleUpdateFeature = async (featureKey: string, nextState: VisibilityState) => {
    if (!activeOrgId || !isInternal) return;
    setUpdatingFeatureKey(featureKey);
    try {
      await featureFlagsService.upsert({
        orgId: activeOrgId,
        storeId: selectedStoreIds.length === 1 ? (activeStoreId || undefined) : undefined,
        featureKey,
        state: nextState,
      });
      setFeatureFlags((prev) =>
        prev.map((item) => {
          if (item.featureKey !== featureKey) return item;
          return { ...item, state: nextState };
        })
      );
      addNotification('更新完了', `${featureKey} の表示状態を変更しました。`, 'SUCCESS');
    } catch (error) {
      addNotification('更新エラー', `機能公開設定の更新に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    } finally {
      setUpdatingFeatureKey(null);
    }
  };

  const handleSidebarMove = (from: SidebarNavView, to: SidebarNavView) => {
    if (!isAdmin) return;
    if (!draggingMenuId) return;

    const fromIndex = sidebarMenuOrder.indexOf(from);
    const toIndex = sidebarMenuOrder.indexOf(to);
    if (fromIndex < 0 || toIndex < 0) return;
    const next = [...sidebarMenuOrder];
    next.splice(fromIndex, 1);
    next.splice(toIndex, 0, draggingMenuId);
    setSidebarMenuOrderState(next);
    setDraggingMenuId(null);
  };

  const handleSaveSidebarOrder = () => {
    if (!isAdmin) return;
    setSidebarNavOrder(sidebarMenuOrder);
    addNotification('保存完了', 'サイドバー表示順を保存しました。', 'SUCCESS');
  };

  const handleSaveSidebarLabels = () => {
    if (!isAdmin) return;
    setSidebarNavLabels(sidebarMenuLabels);
    addNotification('保存完了', 'サイドバー表示名を保存しました。', 'SUCCESS');
  };

  const handleResetSidebarOrder = () => {
    if (!isAdmin) return;
    const next = resetSidebarNavOrder();
    setSidebarMenuOrderState(next);
    addNotification('初期化', '表示順を初期値に戻しました。', 'SUCCESS');
  };

  const handleResetSidebarLabels = () => {
    if (!isAdmin) return;
    setSidebarMenuLabelsState(resetSidebarNavLabels());
    addNotification('初期化', '表示名を初期値に戻しました。', 'SUCCESS');
  };

  const navigateTo = (view: string) => {
    if (typeof window === 'undefined') return;
    window.location.href = `/?view=${encodeURIComponent(view)}`;
  };

  const tabList: Array<{ id: SettingsTab; label: string; testId: string }> = [];
  if (canShowProfileTab) tabList.push({ id: 'PROFILE', label: 'プロフィール', testId: 'settings-tab-profile' });
  if (canShowSystemTab) tabList.push({ id: 'SYSTEM', label: 'システム', testId: 'settings-tab-system' });

  const isEditingAllowed = !isMultiStoreSelected;

  useEffect(() => {
    if (!isInternal) return;
    setSidebarMenuOrderState(getSidebarNavOrder());
    setSidebarMenuLabelsState(getSidebarNavLabels());
  }, [isInternal]);

  return (
    <div id="settings-page" className={PAGE_CONTAINER_CLASS}>
      <section>
        <h1 className={PAGE_HEADER_TITLE_CLASS}>設定</h1>
        <p className={PAGE_HEADER_DESCRIPTION_CLASS}>
          アカウントのプロフィール、表示設定、システム運用設定を切り替えて管理します。
        </p>
      </section>

      {tabList.length > 1 ? (
        <nav className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
          {tabList.map((tab) => (
            <button
              key={tab.id}
              id={`settings-tab-${tab.id === 'PROFILE' ? 'profile' : 'system'}`}
              data-testid={tab.testId}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-primary-500 text-primary-700 dark:text-primary-300'
                  : 'border-transparent text-gray-500 dark:text-gray-300 hover:text-primary-700 dark:hover:text-primary-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      ) : null}

      {activeTab === 'PROFILE' && (
        <div className="max-w-3xl space-y-6">
          <section className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-4 md:p-6 space-y-6">
            <div>
              <h2 className={PAGE_SECTION_TITLE_CLASS}>プロフィール</h2>
              <p className={PAGE_SECTION_DESCRIPTION_CLASS}>表示名・メールアドレス・画像を管理します。</p>
            </div>

            <div className="space-y-2">
              <p className="text-sm text-gray-500 dark:text-gray-400">現在の画像</p>
              <div className="flex items-center gap-4">
                <Avatar src={avatarUrl || currentUser.avatarUrl} size={64} />
                <button
                  type="button"
                  onClick={handleAvatarClick}
                  disabled={isUploadingAvatar}
                  className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm"
                >
                  <Camera size={16} />
                  {isUploadingAvatar ? '更新中...' : '画像を変更'}
                </button>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarChange}
                  className="hidden"
                />
              </div>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">表示名</label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-3 text-gray-400" size={18} />
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="w-full pl-10 p-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700"
                    disabled={isSavingProfile}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">ログインメール</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 text-gray-400" size={18} />
                  <input
                    value={email}
                    readOnly
                    className="w-full pl-10 p-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">メールアドレスを変更する</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 text-gray-400" size={18} />
                  <input
                    value={newEmail}
                    onChange={(event) => setNewEmail(event.target.value)}
                    placeholder="新しいメールアドレス"
                    className="w-full pl-10 p-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700"
                    disabled={isSavingProfile}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">パスワード更新（任意）</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 text-gray-400" size={18} />
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    placeholder="現在のパスワード"
                    className="w-full pl-10 p-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700"
                    disabled={isSavingProfile}
                  />
                </div>
              </div>
              <div>
                <div className="relative">
                  <Key className="absolute left-3 top-3 text-gray-400" size={18} />
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    placeholder="新しいパスワード"
                    className="w-full pl-10 p-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700"
                    disabled={isSavingProfile}
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isSavingProfile}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold disabled:opacity-60"
                >
                  <Save size={16} />
                  {isSavingProfile ? '保存中...' : 'プロフィール保存'}
                </button>
              </div>
            </form>
          </section>

          {isMultiStoreSelected && (
            <div className={PAGE_WARNING_CLASS}>
              <div className="font-semibold">複数店舗が選択中です</div>
              <p className="mt-1 text-sm">プロフィール編集は通常通り可能ですが、店舗依存機能は「設定＞システム」のみ有効です。</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'SYSTEM' && isInternal && (
        <div className="max-w-4xl space-y-6">
          <div className={PAGE_WARNING_CLASS}>
            <AlertTriangle size={18} />
            <div>
              <h3 className="font-bold">システム設定</h3>
              <p className="text-sm mt-1">この設定はシステムの挙動を変えるため、必要な場合のみ変更してください。</p>
            </div>
          </div>

          {!isSupabaseConfigured && (
            <div className={PAGE_WARNING_CLASS}>Supabase未設定のためシステム機能の編集はできません。</div>
          )}

          <section className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-4 md:p-6 space-y-4">
            <h2 className={PAGE_SECTION_TITLE_CLASS}>管理画面への導線</h2>
            <p className={PAGE_SECTION_DESCRIPTION_CLASS}>移動が必要な操作は、対応ページから実行してください。</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => navigateTo('STORE_MANAGEMENT')}
                className="inline-flex items-center justify-start gap-2 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 text-sm font-semibold"
              >
                <Store size={16} />
                店舗管理を開く
              </button>
              <button
                type="button"
                onClick={() => navigateTo('PLATFORM_MANAGEMENT')}
                className="inline-flex items-center justify-start gap-2 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 text-sm font-semibold"
              >
                <LinkIcon size={16} />
                プラットフォーム管理を開く
              </button>
              <button
                type="button"
                onClick={() => navigateTo('GROUP_MANAGEMENT')}
                className="inline-flex items-center justify-start gap-2 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 text-sm font-semibold"
              >
                <Settings size={16} />
                グループ管理を開く
              </button>
              {isAdmin ? (
                <button
                  type="button"
                  onClick={() => navigateTo('MANAGEMENT_UNIT_MANAGEMENT')}
                  className="inline-flex items-center justify-start gap-2 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 text-sm font-semibold"
                >
                  <ShieldCheck size={16} />
                  管理ユニット管理を開く
                </button>
              ) : null}
            </div>
          </section>

          <section className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-4 md:p-6 space-y-4">
            <h2 className={PAGE_SECTION_TITLE_CLASS}>機能公開設定</h2>
            <p className={PAGE_SECTION_DESCRIPTION_CLASS}>MENU/リンクの表示可否をロール別に制御できます。</p>
            {isLoadingFlags && <p className="text-sm text-gray-500 dark:text-gray-400">機能設定を読み込み中...</p>}
            {!isLoadingFlags && FEATURE_FLAG_OPTIONS.map((option) => {
              const state = resolveFeatureState(featureFlags, option.key, storeIdForSingleOnly || undefined);
              return (
                <div key={option.key} className="grid md:grid-cols-[1fr_auto] gap-2 border border-gray-100 dark:border-gray-700 p-3 rounded-xl">
                  <div>
                    <p className="text-sm font-semibold text-gray-800 dark:text-white">{option.label}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{option.description}</p>
                  </div>
                  <select
                    value={state}
                    onChange={(event) => void handleUpdateFeature(option.key, event.target.value as VisibilityState)}
                    disabled={updatingFeatureKey === option.key || !isSupabaseConfigured}
                    className="h-10 px-3 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg"
                  >
                    <option value="HIDDEN">非表示</option>
                    <option value="ADMIN_ONLY">内部のみ</option>
                    <option value="ENABLED">全体公開</option>
                  </select>
                  <p className="md:col-span-2 text-xs text-gray-500 dark:text-gray-400">現在: {getFeatureStateLabel(state)}</p>
                </div>
              );
            })}
          </section>

          {isAdmin && isEditingAllowed ? (
            <section className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-4 md:p-6 space-y-4">
              <h2 className={PAGE_SECTION_TITLE_CLASS}>サイドバーメニュー順序 / 表示名</h2>
              <p className={PAGE_SECTION_DESCRIPTION_CLASS}>ドラッグ＆ドロップで順序を変更し、名称を編集できます。</p>
              <div className="space-y-2">
                {sidebarMenuOrder.map((viewId) => (
                  <div
                    key={viewId}
                    draggable
                    onDragStart={() => setDraggingMenuId(viewId)}
                    onDragEnd={() => setDraggingMenuId(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (!draggingMenuId) return;
                      handleSidebarMove(draggingMenuId, viewId);
                    }}
                    className={`flex items-center justify-between p-3 rounded-xl border ${
                      draggingMenuId === viewId
                        ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20'
                        : 'border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/60'
                    }`}
                  >
                    <span className="text-gray-400 text-sm">⋮⋮</span>
                    <input
                      type="text"
                      value={sidebarMenuLabels[viewId]}
                      onChange={(event) => {
                        setSidebarMenuLabelsState((prev) => ({
                          ...prev,
                          [viewId]: normalizeNavLabel(event.target.value),
                        }));
                      }}
                      className="w-full max-w-xs p-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg"
                    />
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleSaveSidebarOrder}
                  className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg"
                >
                  順序を保存
                </button>
                <button
                  type="button"
                  onClick={handleSaveSidebarLabels}
                  className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg"
                >
                  表示名を保存
                </button>
                <button
                  type="button"
                  onClick={handleResetSidebarOrder}
                  className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg"
                >
                  順序を初期化
                </button>
                <button
                  type="button"
                  onClick={handleResetSidebarLabels}
                  className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg"
                >
                  表示名を初期化
                </button>
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
};
