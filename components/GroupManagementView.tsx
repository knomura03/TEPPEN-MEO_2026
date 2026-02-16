import React, { useEffect, useMemo, useState } from 'react';
import { Role, User } from '../types';
import { useNotification } from '../contexts/NotificationContext';
import { useStore } from '../contexts/StoreContext';
import { groupService, AccessibleGroup } from '../services/groupService';
import { getErrorMessage } from '../services/errorMessage';
import { isSupabaseConfigured } from '../services/supabaseClient';
import {
  PAGE_CONTAINER_CLASS,
  PAGE_HEADER_DESCRIPTION_CLASS,
  PAGE_HEADER_TITLE_CLASS,
  PAGE_SECTION_DESCRIPTION_CLASS,
  PAGE_SECTION_TITLE_CLASS,
  PAGE_WARNING_CLASS,
} from './ui/pageLayout';
import { formatRoleLabel, formatViewLabel } from './ui/formatters';

interface GroupManagementViewProps {
  currentUser: User;
}

export const GroupManagementView: React.FC<GroupManagementViewProps> = ({ currentUser }) => {
  const { addNotification } = useNotification();
  const { activeStoreId, stores, setActiveStoreId, reloadStores } = useStore();
  const canCreateGroup = currentUser.role === Role.ADMIN || currentUser.role === Role.SUPERVISOR;
  const canRenameGroup = currentUser.role === Role.ADMIN || currentUser.role === Role.SUPERVISOR || currentUser.role === Role.MANAGER;
  const canManageGroup = canCreateGroup || canRenameGroup;

  const [groups, setGroups] = useState<AccessibleGroup[]>([]);
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [isSavingGroup, setIsSavingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupInitialStoreName, setNewGroupInitialStoreName] = useState('');
  const [renameGroupName, setRenameGroupName] = useState('');

  const activeOrgId = useMemo(() => {
    if (!activeStoreId) return null;
    const store = stores.find((item) => item.id === activeStoreId);
    return store?.orgId || null;
  }, [activeStoreId, stores]);

  const activeGroup = useMemo(
    () => groups.find((group) => group.id === activeOrgId) || null,
    [groups, activeOrgId]
  );

  const loadGroups = async () => {
    if (!canManageGroup || !isSupabaseConfigured) {
      setGroups([]);
      return;
    }
    setIsLoadingGroups(true);
    try {
      const rows = await groupService.listAccessibleGroups(currentUser.id);
      setGroups(rows);
      setRenameGroupName((prev) => {
        if (prev.trim().length > 0) return prev;
        return rows.find((item) => item.id === activeOrgId)?.name || '';
      });
    } catch (error) {
      console.error('[GroupManagementView] Failed to load groups:', error);
      addNotification('取得エラー', `グループ一覧の取得に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
      setGroups([]);
    } finally {
      setIsLoadingGroups(false);
    }
  };

  useEffect(() => {
    void loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageGroup, currentUser.id, activeOrgId]);

  useEffect(() => {
    if (activeGroup?.name) {
      setRenameGroupName(activeGroup.name);
    }
  }, [activeGroup?.id, activeGroup?.name]);

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreateGroup) {
      addNotification('権限エラー', 'グループ作成権限がありません。', 'ERROR');
      return;
    }
    if (!isSupabaseConfigured) {
      addNotification('未設定', 'Supabase未設定のためグループ作成できません。', 'WARNING');
      return;
    }
    const groupName = newGroupName.trim();
    const initialStoreName = newGroupInitialStoreName.trim();
    if (!groupName || !initialStoreName) {
      addNotification('入力エラー', 'グループ名と初期店舗名を入力してください。', 'WARNING');
      return;
    }

    setIsSavingGroup(true);
    try {
      const result = await groupService.createGroup({ groupName, initialStoreName });
      await Promise.all([reloadStores(), loadGroups()]);
      setActiveStoreId(result.storeId);
      setNewGroupName('');
      setNewGroupInitialStoreName('');
      setRenameGroupName(groupName);
      addNotification('作成完了', `グループ「${groupName}」を作成しました。`, 'SUCCESS');
    } catch (error) {
      addNotification('作成エラー', getErrorMessage(error) || 'グループ作成に失敗しました。', 'ERROR');
    } finally {
      setIsSavingGroup(false);
    }
  };

  const handleRenameGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canRenameGroup) {
      addNotification('権限エラー', 'グループ名変更権限がありません。', 'ERROR');
      return;
    }
    if (!isSupabaseConfigured) {
      addNotification('未設定', 'Supabase未設定のためグループ名変更できません。', 'WARNING');
      return;
    }
    if (!activeOrgId) {
      addNotification('グループ未選択', '店舗を選択してからグループ名を変更してください。', 'WARNING');
      return;
    }
    const groupName = renameGroupName.trim();
    if (!groupName) {
      addNotification('入力エラー', 'グループ名を入力してください。', 'WARNING');
      return;
    }

    setIsSavingGroup(true);
    try {
      await groupService.renameGroup({ orgId: activeOrgId, groupName });
      await loadGroups();
      addNotification('更新完了', 'グループ名を更新しました。', 'SUCCESS');
    } catch (error) {
      addNotification('更新エラー', getErrorMessage(error) || 'グループ名の更新に失敗しました。', 'ERROR');
    } finally {
      setIsSavingGroup(false);
    }
  };

  if (!canManageGroup) {
    return (
      <div className={PAGE_CONTAINER_CLASS}>
        <section>
          <h1 className={PAGE_HEADER_TITLE_CLASS}>{formatViewLabel('GROUP_MANAGEMENT')}</h1>
          <p className={PAGE_HEADER_DESCRIPTION_CLASS}>グループの作成・名称変更を管理します。</p>
        </section>
        <div className={PAGE_WARNING_CLASS}>この画面にアクセスする権限がありません。</div>
      </div>
    );
  }

  return (
    <div id="group-management-main" className={PAGE_CONTAINER_CLASS}>
      <section>
        <h1 className={PAGE_HEADER_TITLE_CLASS}>{formatViewLabel('GROUP_MANAGEMENT')}</h1>
        <p className={PAGE_HEADER_DESCRIPTION_CLASS}>グループ（会社・チェーン）の名称変更と新規作成を管理します。</p>
      </section>

      {!isSupabaseConfigured && (
        <div className={PAGE_WARNING_CLASS}>Supabase未設定のためグループ管理機能は利用できません。</div>
      )}

      <div id="group-list-panel" className="rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <h2 className={PAGE_SECTION_TITLE_CLASS}>所属グループ一覧</h2>
        <p className={PAGE_SECTION_DESCRIPTION_CLASS}>現在ログインしているユーザーがアクセスできるグループを表示します。</p>
        {isLoadingGroups ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">読み込み中...</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">所属グループはありません。</p>
        ) : (
          <div className="space-y-2">
            {groups.map((group) => (
              <div
                key={group.id}
                className={`rounded-xl border px-3 py-2 text-sm ${
                  group.id === activeOrgId
                    ? 'border-primary-300 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-gray-200 dark:border-gray-700'
                }`}
              >
                <div className="font-semibold text-gray-900 dark:text-gray-100">{group.name}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">権限: {formatRoleLabel(group.role as Role)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <form id="group-rename-form" onSubmit={handleRenameGroup} className="rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
        <h2 className={PAGE_SECTION_TITLE_CLASS}>現在のグループ名を変更</h2>
        <input
          value={renameGroupName}
          onChange={(event) => setRenameGroupName(event.target.value)}
          placeholder={activeGroup?.name || 'グループ名'}
          className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
          disabled={!activeOrgId || isSavingGroup || !isSupabaseConfigured}
        />
        <button
          type="submit"
          disabled={!activeOrgId || isSavingGroup || !isSupabaseConfigured}
          className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSavingGroup ? '更新中...' : 'グループ名を更新'}
        </button>
      </form>

      {canCreateGroup && (
        <form id="group-create-form" onSubmit={handleCreateGroup} className="rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
          <h2 className={PAGE_SECTION_TITLE_CLASS}>グループを新規作成</h2>
          <input
            value={newGroupName}
            onChange={(event) => setNewGroupName(event.target.value)}
            placeholder="グループ名（例: 関東エリア）"
            className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
            disabled={isSavingGroup || !isSupabaseConfigured}
          />
          <input
            value={newGroupInitialStoreName}
            onChange={(event) => setNewGroupInitialStoreName(event.target.value)}
            placeholder="初期店舗名（例: 新宿本店）"
            className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
            disabled={isSavingGroup || !isSupabaseConfigured}
          />
          <button
            type="submit"
            disabled={isSavingGroup || !isSupabaseConfigured}
            className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSavingGroup ? '作成中...' : 'グループを作成'}
          </button>
        </form>
      )}
    </div>
  );
};
