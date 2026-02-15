import React, { useEffect, useMemo, useState } from 'react';
import { BillingPlan, Role, User } from '../types';
import {
  Trash2,
  UserPlus,
  Download,
  Edit2,
  Mail,
  TrendingUp,
  Users as UsersIcon,
  Award,
  Clock,
  Layers,
  Upload,
  FileWarning,
  CheckCircle2,
  Link2,
} from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';
import { isSupabaseConfigured, supabase } from '../services/supabaseClient';
import { ManagedUserStoreSummary, userManagementService } from '../services/userManagementService';
import { userStoreControlsService } from '../services/userStoreControlsService';
import { storeCsvImportService, StoreCsvParseResult } from '../services/storeCsvImportService';
import { storeLifecycleService } from '../services/storeLifecycleService';
import { billingService } from '../services/billingService';
import { getErrorMessage } from '../services/errorMessage';
import { useStore } from '../contexts/StoreContext';
import { groupService, AccessibleGroup } from '../services/groupService';
import { storesService } from '../services/storesService';
import { ModalPortal } from './ModalPortal';
import { PAGE_CARD_CLASS, PAGE_CONTAINER_CLASS, PAGE_HEADER_DESCRIPTION_CLASS, PAGE_HEADER_TITLE_CLASS, PAGE_WARNING_CLASS } from './ui/pageLayout';
import { getFunctionErrorMessage, invokeFunctionByHttp } from '../services/functionHttpClient';
import { formatViewLabel } from './ui/formatters';

interface UserManagementProps {
  currentUser: User;
}

type ControlDraft = {
  maxStoresInput: string;
  allowCsv: boolean;
  isSaving: boolean;
};

type UserSortKey =
  | 'REGISTERED_AT'
  | 'USER_INFO'
  | 'PLAN'
  | 'ROLE'
  | 'STORE_COUNT'
  | 'STORE_LIMIT';

const fallbackSummary: ManagedUserStoreSummary[] = [];

export const UserManagement: React.FC<UserManagementProps> = ({ currentUser }) => {
  const { addNotification } = useNotification();
  const { stores, activeStoreId, reloadStores } = useStore();
  const isInternal = currentUser.role === Role.ADMIN || currentUser.role === Role.SUPERVISOR;

  const [userRows, setUserRows] = useState<ManagedUserStoreSummary[]>(fallbackSummary);
  const [isLoading, setIsLoading] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [controlDrafts, setControlDrafts] = useState<Record<string, ControlDraft>>({});
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | 'ALL'>('ALL');
  const [planFilter, setPlanFilter] = useState<string>('ALL');
  const [sortKey, setSortKey] = useState<UserSortKey>('REGISTERED_AT');
  const [sortDirection, setSortDirection] = useState<'ASC' | 'DESC'>('DESC');

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>(Role.USER);
  const [inviteGroupMode, setInviteGroupMode] = useState<'EXISTING' | 'NEW'>('EXISTING');
  const [inviteGroupId, setInviteGroupId] = useState<string>('');
  const [inviteNewGroupName, setInviteNewGroupName] = useState<string>('');
  const [inviteStoreMode, setInviteStoreMode] = useState<'EXISTING' | 'NEW'>('EXISTING');
  const [inviteStoreId, setInviteStoreId] = useState<string>('');
  const [inviteNewStoreName, setInviteNewStoreName] = useState<string>('');
  const [invitePlanCode, setInvitePlanCode] = useState<string>('');
  const [invitePassword, setInvitePassword] = useState<string>('');
  const [isInviting, setIsInviting] = useState(false);
  const [isGeneratingInviteLink, setIsGeneratingInviteLink] = useState(false);
  const [invitePlanCatalog, setInvitePlanCatalog] = useState<BillingPlan[]>([]);
  const [isLoadingInvitePlans, setIsLoadingInvitePlans] = useState<boolean>(false);
  const [inviteGroups, setInviteGroups] = useState<AccessibleGroup[]>([]);
  const [isLoadingInviteGroups, setIsLoadingInviteGroups] = useState(false);
  const [planDrafts, setPlanDrafts] = useState<Record<string, string>>({});
  const [savingPlanUserId, setSavingPlanUserId] = useState<string | null>(null);

  const [isAttachExistingOpen, setIsAttachExistingOpen] = useState(false);
  const [attachRole, setAttachRole] = useState<Role>(Role.USER);
  const [attachGroupId, setAttachGroupId] = useState<string>('');
  const [attachStoreId, setAttachStoreId] = useState<string>('');
  const [attachSearchTerm, setAttachSearchTerm] = useState('');
  const [attachCandidates, setAttachCandidates] = useState<Array<{ userId: string; name: string; email: string }>>([]);
  const [selectedAttachUserId, setSelectedAttachUserId] = useState('');
  const [isSearchingExisting, setIsSearchingExisting] = useState(false);
  const [isAttachingExisting, setIsAttachingExisting] = useState(false);

  const [editingUserSummary, setEditingUserSummary] = useState<ManagedUserStoreSummary | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<Role>(Role.USER);
  const [editStoreIds, setEditStoreIds] = useState<string[]>([]);
  const [isSavingEditUser, setIsSavingEditUser] = useState(false);

  const [selectedCsvUserId, setSelectedCsvUserId] = useState<string>('');
  const [csvFileName, setCsvFileName] = useState('');
  const [csvParseResult, setCsvParseResult] = useState<StoreCsvParseResult>({ rows: [], errors: [] });
  const [csvExecutionErrors, setCsvExecutionErrors] = useState<StoreCsvParseResult['errors']>([]);
  const [isExecutingCsv, setIsExecutingCsv] = useState(false);

  const activeOrgId = useMemo(() => {
    if (!activeStoreId) return null;
    const store = stores.find((s) => s.id === activeStoreId);
    return store?.orgId || null;
  }, [activeStoreId, stores]);

  const storeNameById = useMemo(() => {
    const map = new Map<string, string>();
    stores.forEach((store) => map.set(store.id, store.name));
    return map;
  }, [stores]);

  const storesByOrgId = useMemo(() => {
    const map = new Map<string, typeof stores>();
    stores.forEach((store) => {
      const current = map.get(store.orgId) || [];
      current.push(store);
      map.set(store.orgId, current);
    });
    return map;
  }, [stores]);

  const inviteStoreCandidates = useMemo(() => {
    if (!inviteGroupId) return [];
    return storesByOrgId.get(inviteGroupId) || [];
  }, [inviteGroupId, storesByOrgId]);

  const attachStoreCandidates = useMemo(() => {
    if (!attachGroupId) return [];
    return storesByOrgId.get(attachGroupId) || [];
  }, [attachGroupId, storesByOrgId]);

  const userOnlyRows = useMemo(
    () => userRows.filter((row) => row.user.role === Role.USER),
    [userRows]
  );

  const selectedCsvTarget = useMemo(
    () => userOnlyRows.find((row) => row.user.id === selectedCsvUserId) || null,
    [selectedCsvUserId, userOnlyRows]
  );
  const availablePlanCodes = useMemo(() => {
    const unique = new Set<string>();
    userRows.forEach((row) => {
      const code = String(row.user.plan || 'FREE').trim().toUpperCase();
      if (!code) return;
      unique.add(code);
    });
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [userRows]);
  const selectablePlanCodeSet = useMemo(
    () => new Set(invitePlanCatalog.map((plan) => plan.code.trim().toUpperCase())),
    [invitePlanCatalog]
  );

  const filteredUserRows = useMemo(() => {
    const normalizedSearch = userSearchTerm.trim().toLowerCase();
    const roleRank: Record<Role, number> = {
      [Role.ADMIN]: 4,
      [Role.SUPERVISOR]: 3,
      [Role.MANAGER]: 2,
      [Role.USER]: 1,
    };

    const compareByDirection = (left: number, right: number) => (
      sortDirection === 'ASC' ? left - right : right - left
    );

    const toTextCompare = (left: string, right: string) => {
      const compared = left.localeCompare(right, 'ja');
      return sortDirection === 'ASC' ? compared : compared * -1;
    };

    return userRows
      .filter((row) => {
        if (roleFilter !== 'ALL' && row.user.role !== roleFilter) {
          return false;
        }
        if (planFilter !== 'ALL' && (row.user.plan || 'FREE').toUpperCase() !== planFilter) {
          return false;
        }
        if (!normalizedSearch) {
          return true;
        }
        const name = row.user.name.toLowerCase();
        const email = row.user.email.toLowerCase();
        const username = row.user.username.toLowerCase();
        return name.includes(normalizedSearch) || email.includes(normalizedSearch) || username.includes(normalizedSearch);
      })
      .sort((a, b) => {
        if (sortKey === 'REGISTERED_AT') {
          return compareByDirection(a.user.lastLoginAt.getTime(), b.user.lastLoginAt.getTime());
        }
        if (sortKey === 'USER_INFO') {
          const byName = toTextCompare(a.user.name, b.user.name);
          if (byName !== 0) return byName;
          return toTextCompare(a.user.email, b.user.email);
        }
        if (sortKey === 'PLAN') {
          return toTextCompare(a.user.plan || 'FREE', b.user.plan || 'FREE');
        }
        if (sortKey === 'ROLE') {
          return compareByDirection(roleRank[a.user.role], roleRank[b.user.role]);
        }
        if (sortKey === 'STORE_COUNT') {
          return compareByDirection(a.currentStoreCount, b.currentStoreCount);
        }
        return compareByDirection(a.effectiveStoreLimit, b.effectiveStoreLimit);
      });
  }, [planFilter, roleFilter, sortDirection, sortKey, userRows, userSearchTerm]);

  const syncControlDrafts = (rows: ManagedUserStoreSummary[]) => {
    const next: Record<string, ControlDraft> = {};
    rows.forEach((row) => {
      if (row.user.role !== Role.USER) return;
      next[row.user.id] = {
        maxStoresInput: row.maxStoresOverride ? String(row.maxStoresOverride) : '',
        allowCsv: row.allowCsvStoreBulkCreate,
        isSaving: false,
      };
    });
    setControlDrafts(next);
  };

  const syncPlanDrafts = (rows: ManagedUserStoreSummary[]) => {
    const next: Record<string, string> = {};
    rows.forEach((row) => {
      next[row.user.id] = String(row.user.plan || '').trim().toUpperCase();
    });
    setPlanDrafts(next);
  };

  const loadUsers = async (orgId: string | null) => {
    if (!isSupabaseConfigured) {
      setUserRows(fallbackSummary);
      syncControlDrafts(fallbackSummary);
      syncPlanDrafts(fallbackSummary);
      return;
    }
    if (!orgId) {
      setUserRows([]);
      syncControlDrafts([]);
      syncPlanDrafts([]);
      return;
    }
    setIsLoading(true);
    try {
      const data = await userManagementService.listUsersByOrgWithStoreStats(orgId);
      setUserRows(data);
      syncControlDrafts(data);
      syncPlanDrafts(data);
    } catch (error) {
      console.error('[UserManagement] Failed to load users:', error);
      addNotification('読み込みエラー', 'ユーザー一覧の取得に失敗しました。', 'ERROR');
      setUserRows([]);
      syncControlDrafts([]);
      syncPlanDrafts([]);
    } finally {
      setIsLoading(false);
    }
  };

  const loadInvitePlanCatalog = async () => {
    if (!isInternal || !isSupabaseConfigured) {
      setInvitePlanCatalog([]);
      return;
    }
    setIsLoadingInvitePlans(true);
    try {
      const plans = await billingService.listBillingPlans({ includeInactive: false });
      const activePlans = plans.filter((plan) => plan.isActive);
      setInvitePlanCatalog(activePlans);
    } catch (error) {
      const message = getErrorMessage(error) || '契約プラン一覧の取得に失敗しました。';
      addNotification('プラン取得エラー', message, 'ERROR');
      setInvitePlanCatalog([]);
    } finally {
      setIsLoadingInvitePlans(false);
    }
  };

  const loadInviteGroups = async () => {
    if (!isSupabaseConfigured) {
      setInviteGroups([]);
      return;
    }
    setIsLoadingInviteGroups(true);
    try {
      const groups = await groupService.listAccessibleGroups(currentUser.id);
      setInviteGroups(groups);
      if (groups.length > 0) {
        setInviteGroupId((prev) => {
          if (prev && groups.some((group) => group.id === prev)) return prev;
          if (activeOrgId && groups.some((group) => group.id === activeOrgId)) return activeOrgId;
          return groups[0].id;
        });
      }
    } catch (error) {
      setInviteGroups([]);
      addNotification('グループ取得エラー', getErrorMessage(error) || 'グループ一覧の取得に失敗しました。', 'ERROR');
    } finally {
      setIsLoadingInviteGroups(false);
    }
  };

  useEffect(() => {
    if (!inviteGroupId && activeOrgId) {
      setInviteGroupId(activeOrgId);
    }
    if (!inviteStoreId && activeStoreId) {
      setInviteStoreId(activeStoreId);
    }
    if (!attachGroupId && activeOrgId) {
      setAttachGroupId(activeOrgId);
    }
    if (!attachStoreId && activeStoreId) {
      setAttachStoreId(activeStoreId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId, activeStoreId]);

  useEffect(() => {
    const loadData = async () => {
      await loadUsers(activeOrgId);
    };
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId, activeStoreId]);

  useEffect(() => {
    if (!isInternal || !activeOrgId) {
      setInvitePlanCatalog([]);
      return;
    }
    void loadInvitePlanCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInternal, activeOrgId]);

  useEffect(() => {
    if (!isInviteOpen && !isAttachExistingOpen) return;
    void loadInviteGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInviteOpen, isAttachExistingOpen, currentUser.id]);

  useEffect(() => {
    if (inviteGroupMode !== 'EXISTING') return;
    const groupStores = storesByOrgId.get(inviteGroupId) || [];
    setInviteStoreId((prev) => {
      if (prev && groupStores.some((store) => store.id === prev)) return prev;
      if (groupStores.length === 0) return '';
      return groupStores[0].id;
    });
  }, [inviteGroupId, inviteGroupMode, storesByOrgId]);

  useEffect(() => {
    const groupStores = storesByOrgId.get(attachGroupId) || [];
    setAttachStoreId((prev) => {
      if (prev && groupStores.some((store) => store.id === prev)) return prev;
      if (groupStores.length === 0) return '';
      return groupStores[0].id;
    });
  }, [attachGroupId, storesByOrgId]);

  useEffect(() => {
    if (editRole !== Role.USER) {
      setEditStoreIds([]);
    }
  }, [editRole]);

  const canManage = (targetUser: User) => {
    if (currentUser.role === Role.ADMIN) return true;
    if (currentUser.role === Role.SUPERVISOR) {
      return targetUser.role === Role.MANAGER || targetUser.role === Role.USER;
    }
    if (currentUser.role === Role.MANAGER) {
      return targetUser.role === Role.USER;
    }
    return false;
  };

  const closeEditUserModal = () => {
    setEditingUserSummary(null);
    setEditName('');
    setEditRole(Role.USER);
    setEditStoreIds([]);
  };

  const toggleEditStoreId = (storeId: string) => {
    setEditStoreIds((prev) => (
      prev.includes(storeId) ? prev.filter((id) => id !== storeId) : [...prev, storeId]
    ));
  };

  const openEditUserModal = (summary: ManagedUserStoreSummary) => {
    setEditingUserSummary(summary);
    setEditName(summary.user.name);
    setEditRole(summary.user.role);
    setEditStoreIds(summary.user.role === Role.USER ? summary.userStoreIds : []);
  };

  const handleSaveUserEdit = async () => {
    if (!editingUserSummary) return;
    if (!activeOrgId) {
      addNotification('店舗未選択', '店舗が選択されていません。', 'WARNING');
      return;
    }
    if (!isSupabaseConfigured) {
      addNotification('準備中', 'Supabase未設定のためユーザー編集は利用できません。', 'INFO');
      return;
    }

    const trimmedName = editName.trim();
    if (!trimmedName) {
      addNotification('入力エラー', '表示名を入力してください。', 'WARNING');
      return;
    }

    setIsSavingEditUser(true);
    try {
      await userManagementService.updateManagedUser({
        orgId: activeOrgId,
        targetUserId: editingUserSummary.user.id,
        patch: {
          name: trimmedName,
          role: editRole,
          storeIds: editRole === Role.USER ? editStoreIds : [],
        },
      });
      addNotification('ユーザー更新', 'ユーザー情報を更新しました。', 'SUCCESS');
      closeEditUserModal();
      await loadUsers(activeOrgId);
    } catch (error) {
      const message = getErrorMessage(error) || 'ユーザー編集に失敗しました。';
      addNotification('更新エラー', message, 'ERROR');
    } finally {
      setIsSavingEditUser(false);
    }
  };

  const handleRemoveFromOrg = (userId: string) => {
    if (!window.confirm('本当にこのユーザーを削除しますか？このグループへの所属が解除されます。')) {
      return;
    }

    if (!isSupabaseConfigured) {
      const next = userRows.filter((row) => row.user.id !== userId);
      setUserRows(next);
      syncControlDrafts(next);
      addNotification('ユーザー削除完了', 'ユーザーの所属を解除しました。', 'SUCCESS');
      return;
    }

    if (!activeOrgId) {
      addNotification('店舗未選択', '店舗が選択されていません。', 'WARNING');
      return;
    }

    setDeletingUserId(userId);
    userManagementService
      .removeUserFromOrg(activeOrgId, userId)
      .then(async () => {
        addNotification('ユーザー削除完了', 'ユーザーの所属を解除しました。', 'SUCCESS');
        await loadUsers(activeOrgId);
      })
      .catch((error) => {
        console.error('[UserManagement] Failed to delete user:', error);
        addNotification('削除エラー', 'ユーザーの削除に失敗しました。', 'ERROR');
      })
      .finally(() => {
        setDeletingUserId(null);
      });
  };

  const handleFullDelete = async (summary: ManagedUserStoreSummary) => {
    if (currentUser.role !== Role.ADMIN) {
      addNotification('権限エラー', '完全削除はADMINのみ実行できます。', 'ERROR');
      return;
    }
    if (!activeOrgId) {
      addNotification('店舗未選択', '店舗が選択されていません。', 'WARNING');
      return;
    }
    if (!isSupabaseConfigured) {
      addNotification('準備中', 'Supabase未設定のため完全削除は利用できません。', 'INFO');
      return;
    }
    if (!window.confirm(`「${summary.user.name}」を完全削除しますか？この操作は取り消せません。`)) {
      return;
    }

    setDeletingUserId(summary.user.id);
    try {
      const first = await userManagementService.deleteManagedUser({
        orgId: activeOrgId,
        targetUserId: summary.user.id,
        mode: 'FULL_DELETE',
      });

      if (first.confirmRequired) {
        if (!first.confirmToken) {
          throw new Error('confirmTokenの取得に失敗しました。');
        }
        if (!window.confirm('最終確認: 完全削除を実行します。問題なければOKを押してください。')) {
          addNotification('完全削除を中止', '最終確認でキャンセルしました。', 'INFO');
          return;
        }
        await userManagementService.deleteManagedUser({
          orgId: activeOrgId,
          targetUserId: summary.user.id,
          mode: 'FULL_DELETE',
          confirmToken: first.confirmToken,
        });
      }

      addNotification('完全削除完了', 'Authユーザーを完全削除しました。', 'SUCCESS');
      await loadUsers(activeOrgId);
    } catch (error) {
      const message = getErrorMessage(error) || '完全削除に失敗しました。';
      addNotification('完全削除エラー', message, 'ERROR');
    } finally {
      setDeletingUserId(null);
    }
  };

  const resolveInviteGroupAndStore = async (): Promise<{ orgId: string; storeId: string }> => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase未設定のため実行できません。');
    }

    if (inviteGroupMode === 'NEW') {
      if (!(currentUser.role === Role.ADMIN || currentUser.role === Role.SUPERVISOR)) {
        throw new Error('グループ新規作成はADMIN/SUPERVISORのみ実行できます。');
      }
      const groupName = inviteNewGroupName.trim();
      const initialStoreName = inviteNewStoreName.trim();
      if (!groupName || !initialStoreName) {
        throw new Error('新規グループ作成時はグループ名と初期店舗名が必須です。');
      }
      const selectedGroup = inviteGroups.find((group) => group.id === inviteGroupId);
      const managementUnitId = currentUser.role === Role.ADMIN
        ? (selectedGroup?.managementUnitId || undefined)
        : undefined;
      const created = await groupService.createGroup({
        groupName,
        initialStoreName,
        managementUnitId,
      });
      await reloadStores();
      setInviteGroupMode('EXISTING');
      setInviteStoreMode('EXISTING');
      setInviteGroupId(created.orgId);
      setInviteStoreId(created.storeId);
      return created;
    }

    const orgId = inviteGroupId || activeOrgId || '';
    if (!orgId) {
      throw new Error('グループを選択してください。');
    }

    if (inviteStoreMode === 'NEW') {
      const storeName = inviteNewStoreName.trim();
      if (!storeName) {
        throw new Error('新規店舗名を入力してください。');
      }
      const createdStore = await storesService.createStore({
        name: storeName,
        orgId,
      });
      await reloadStores();
      setInviteStoreMode('EXISTING');
      setInviteStoreId(createdStore.id);
      return { orgId, storeId: createdStore.id };
    }

    if (!inviteStoreId) {
      throw new Error('店舗を選択してください。');
    }
    const selectedStore = stores.find((store) => store.id === inviteStoreId);
    if (!selectedStore || selectedStore.orgId !== orgId) {
      throw new Error('選択した店舗がグループに属していません。');
    }
    return { orgId, storeId: inviteStoreId };
  };

  const handleInvite = async () => {
    if (!inviteName.trim() || !inviteEmail.trim()) {
      addNotification('入力エラー', '名前とメールアドレスを入力してください。', 'WARNING');
      return;
    }

    if (!isSupabaseConfigured || !supabase) {
      addNotification('準備中', 'Supabase未設定のため招待できません。', 'INFO');
      return;
    }

    setIsInviting(true);
    try {
      const { orgId, storeId } = await resolveInviteGroupAndStore();
      const canSetPlan = isInternal && Boolean(storeId) && (inviteRole === Role.MANAGER || inviteRole === Role.USER);
      const normalizedPlanCode = canSetPlan && invitePlanCode.trim().length > 0 ? invitePlanCode.trim().toUpperCase() : null;
      const normalizedPassword = invitePassword.trim();
      const result = await invokeFunctionByHttp('admin-create-user', {
        name: inviteName.trim(),
        email: inviteEmail.trim(),
        role: inviteRole,
        orgId,
        storeId,
        planCode: normalizedPlanCode,
        password: normalizedPassword.length > 0 ? normalizedPassword : undefined,
        redirectTo: `${window.location.origin}/invite`,
      });
      if (!result.ok) {
        throw new Error(getFunctionErrorMessage(result, 'ユーザー招待に失敗しました。'));
      }
      const body = result.body && typeof result.body === 'object' ? (result.body as Record<string, unknown>) : null;
      if (body?.error) {
        throw new Error(String(body.error));
      }
      const successMessage = normalizedPassword.length > 0 ? 'ユーザーを作成しました。' : '招待メールを送信しました。';

      addNotification(
        '招待完了',
        successMessage,
        'SUCCESS'
      );
      setInviteName('');
      setInviteEmail('');
      setInviteRole(Role.USER);
      setInviteGroupMode('EXISTING');
      setInviteStoreMode('EXISTING');
      setInviteGroupId(activeOrgId || '');
      setInviteStoreId(activeStoreId || '');
      setInviteNewGroupName('');
      setInviteNewStoreName('');
      setInvitePlanCode('');
      setInvitePassword('');
      setIsInviteOpen(false);
      await Promise.all([loadUsers(orgId), loadInviteGroups()]);
    } catch (err) {
      console.error('[UserManagement] Failed to invite user:', err);
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: string }).message || '')
          : '招待に失敗しました。';
      addNotification('招待エラー', message || '招待に失敗しました。', 'ERROR');
    } finally {
      setIsInviting(false);
    }
  };

  const handleCopyInviteLink = async (linkType: 'INVITE' | 'RECOVERY' = 'INVITE') => {
    if (!inviteName.trim() || !inviteEmail.trim()) {
      addNotification('入力エラー', '名前とメールアドレスを入力してください。', 'WARNING');
      return;
    }
    if (!isSupabaseConfigured) {
      addNotification('準備中', 'Supabase未設定のため招待リンクを生成できません。', 'INFO');
      return;
    }

    setIsGeneratingInviteLink(true);
    try {
      const { orgId, storeId } = await resolveInviteGroupAndStore();
      const canSetPlan = isInternal && Boolean(storeId) && (inviteRole === Role.MANAGER || inviteRole === Role.USER);
      const result = await userManagementService.generateAuthLink({
        orgId,
        email: inviteEmail.trim(),
        name: inviteName.trim(),
        role: inviteRole,
        storeId,
        planCode: canSetPlan && invitePlanCode.trim().length > 0 ? invitePlanCode.trim().toUpperCase() : undefined,
        linkType,
        redirectTo: `${window.location.origin}/invite`,
      });

      await navigator.clipboard.writeText(result.actionLink);
      const title = linkType === 'RECOVERY' ? 'パスワード再設定URLをコピー' : '招待URLをコピー';
      const message = 'URLをクリップボードにコピーしました。';
      addNotification(title, message, 'SUCCESS');

      await loadUsers(orgId);
    } catch (error) {
      const message = getErrorMessage(error) || '招待リンクの生成に失敗しました。';
      addNotification('招待リンク生成エラー', message, 'ERROR');
    } finally {
      setIsGeneratingInviteLink(false);
    }
  };

  const handleCopyRecoveryLinkForUser = async (summary: ManagedUserStoreSummary) => {
    if (!activeOrgId) {
      addNotification('店舗未選択', '店舗を選択してください。', 'WARNING');
      return;
    }
    if (!summary.user.email) {
      addNotification('入力エラー', '対象ユーザーのメールアドレスが未設定です。', 'WARNING');
      return;
    }
    if (!isSupabaseConfigured) {
      addNotification('準備中', 'Supabase未設定のため再設定URLを生成できません。', 'INFO');
      return;
    }

    setIsGeneratingInviteLink(true);
    try {
      const result = await userManagementService.generateAuthLink({
        orgId: activeOrgId,
        email: summary.user.email,
        name: summary.user.name || 'ユーザー',
        role: summary.user.role,
        linkType: 'RECOVERY',
        redirectTo: `${window.location.origin}/invite`,
      });
      await navigator.clipboard.writeText(result.actionLink);
      addNotification('再設定URLをコピー', 'パスワード再設定URLをコピーしました。', 'SUCCESS');
    } catch (error) {
      const message = getErrorMessage(error) || '再設定URLの生成に失敗しました。';
      addNotification('再設定URL生成エラー', message, 'ERROR');
    } finally {
      setIsGeneratingInviteLink(false);
    }
  };

  const openAttachExistingModal = () => {
    setAttachRole(Role.USER);
    setAttachGroupId(activeOrgId || inviteGroupId || '');
    setAttachStoreId(activeStoreId || '');
    setAttachSearchTerm('');
    setAttachCandidates([]);
    setSelectedAttachUserId('');
    setIsAttachExistingOpen(true);
  };

  const openInviteModal = () => {
    setInviteName('');
    setInviteEmail('');
    setInviteRole(Role.USER);
    setInviteGroupMode('EXISTING');
    setInviteStoreMode('EXISTING');
    setInviteGroupId(activeOrgId || '');
    setInviteStoreId(activeStoreId || '');
    setInviteNewGroupName('');
    setInviteNewStoreName('');
    setInvitePlanCode('');
    setInvitePassword('');
    setIsInviteOpen(true);
  };

  const searchExistingUsers = async () => {
    if (!attachGroupId) {
      addNotification('入力エラー', '追加先グループを選択してください。', 'WARNING');
      return;
    }
    const query = attachSearchTerm.trim();
    if (!query) {
      addNotification('入力エラー', '検索キーワードを入力してください。', 'WARNING');
      return;
    }
    setIsSearchingExisting(true);
    try {
      const result = await invokeFunctionByHttp('admin-user-attach-existing', {
        orgId: attachGroupId,
        query,
      });
      if (!result.ok) {
        throw new Error(getFunctionErrorMessage(result, '既存ユーザー検索に失敗しました。'));
      }
      const body = result.body && typeof result.body === 'object' ? (result.body as Record<string, unknown>) : null;
      const candidatesRaw = Array.isArray(body?.candidates) ? body?.candidates : [];
      const candidates = candidatesRaw
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const typed = item as Record<string, unknown>;
          const userId = String(typed.userId || '');
          const email = String(typed.email || '');
          const name = String(typed.name || '');
          if (!userId || !email) return null;
          return { userId, email, name: name || email.split('@')[0] || userId.slice(0, 8) };
        })
        .filter((item): item is { userId: string; email: string; name: string } => Boolean(item));
      setAttachCandidates(candidates);
      setSelectedAttachUserId('');
      if (candidates.length === 0) {
        addNotification('検索結果', '条件に一致する既存ユーザーが見つかりませんでした。', 'INFO');
      }
    } catch (error) {
      addNotification('既存ユーザー検索エラー', getErrorMessage(error) || '既存ユーザーの検索に失敗しました。', 'ERROR');
      setAttachCandidates([]);
    } finally {
      setIsSearchingExisting(false);
    }
  };

  const handleAttachExistingUser = async () => {
    if (!attachGroupId || !attachStoreId || !selectedAttachUserId) {
      addNotification('入力エラー', '追加先グループ・店舗・ユーザーを選択してください。', 'WARNING');
      return;
    }
    if (!window.confirm('選択した既存ユーザーを追加します。よろしいですか？')) {
      return;
    }
    setIsAttachingExisting(true);
    try {
      await userManagementService.attachExistingUserToStoreOrGroup({
        orgId: attachGroupId,
        storeId: attachStoreId,
        targetUserId: selectedAttachUserId,
        role: attachRole,
      });
      addNotification('追加完了', '既存ユーザーをグループ/店舗へ追加しました。', 'SUCCESS');
      setIsAttachExistingOpen(false);
      if (attachGroupId === activeOrgId) {
        await loadUsers(activeOrgId);
      }
    } catch (error) {
      addNotification('追加エラー', getErrorMessage(error) || '既存ユーザーの追加に失敗しました。', 'ERROR');
    } finally {
      setIsAttachingExisting(false);
    }
  };

  const setControlDraft = (userId: string, patch: Partial<ControlDraft>) => {
    setControlDrafts((prev) => {
      const current = prev[userId] || {
        maxStoresInput: '',
        allowCsv: false,
        isSaving: false,
      };
      return {
        ...prev,
        [userId]: {
          ...current,
          ...patch,
        },
      };
    });
  };

  const setPlanDraft = (userId: string, planCode: string) => {
    setPlanDrafts((prev) => ({
      ...prev,
      [userId]: planCode.trim().toUpperCase(),
    }));
  };

  const handleSaveUserPlan = async (summary: ManagedUserStoreSummary) => {
    if (!isInternal) {
      addNotification('権限エラー', '契約プランの変更は内部ユーザーのみ実行できます。', 'ERROR');
      return;
    }
    if (!activeOrgId) {
      addNotification('店舗未選択', '店舗が選択されていません。', 'WARNING');
      return;
    }
    if (!canManage(summary.user) || summary.user.id === currentUser.id) {
      addNotification('権限エラー', 'このユーザーの契約プランを変更する権限がありません。', 'ERROR');
      return;
    }
    if (!isSupabaseConfigured) {
      addNotification('準備中', 'Supabase未設定のため契約プランを変更できません。', 'INFO');
      return;
    }
    const targetStoreIds = Array.from(new Set(summary.userStoreIds));
    if (targetStoreIds.length === 0) {
      addNotification('店舗未割り当て', 'このユーザーは店舗未割り当てのため、契約プランを変更できません。', 'WARNING');
      return;
    }

    const rawPlanCode = String(planDrafts[summary.user.id] || '').trim().toUpperCase();
    if (!rawPlanCode) {
      addNotification('入力エラー', '変更先の契約プランを選択してください。', 'WARNING');
      return;
    }

    setSavingPlanUserId(summary.user.id);
    try {
      for (const storeId of targetStoreIds) {
        await billingService.setStorePlan({
          storeId,
          planCode: rawPlanCode,
        });
      }
      addNotification(
        '契約プラン更新',
        `${summary.user.name} の対象店舗 ${targetStoreIds.length} 件を ${rawPlanCode} に更新しました。`,
        'SUCCESS'
      );
      await loadUsers(activeOrgId);
    } catch (error) {
      const message = getErrorMessage(error) || '契約プランの更新に失敗しました。';
      addNotification('契約プラン更新エラー', message, 'ERROR');
    } finally {
      setSavingPlanUserId(null);
    }
  };

  const handleSaveUserControl = async (summary: ManagedUserStoreSummary) => {
    if (summary.user.role !== Role.USER) return;
    if (!activeOrgId) {
      addNotification('店舗未選択', '店舗が選択されていません。', 'WARNING');
      return;
    }
    if (!isSupabaseConfigured) {
      addNotification('準備中', 'Supabase未設定のため保存できません。', 'INFO');
      return;
    }

    const draft = controlDrafts[summary.user.id] || {
      maxStoresInput: summary.maxStoresOverride ? String(summary.maxStoresOverride) : '',
      allowCsv: summary.allowCsvStoreBulkCreate,
      isSaving: false,
    };

    const maxStoresRaw = draft.maxStoresInput.trim();
    const maxStores = maxStoresRaw.length === 0 ? null : Number(maxStoresRaw);

    if (maxStoresRaw.length > 0 && (!Number.isInteger(maxStores) || Number(maxStores) < 1)) {
      addNotification('入力エラー', '上限店舗数は1以上の整数で入力してください。', 'WARNING');
      return;
    }

    setControlDraft(summary.user.id, { isSaving: true });
    try {
      await userStoreControlsService.upsertUserControl({
        orgId: activeOrgId,
        userId: summary.user.id,
        maxStores,
        allowCsvStoreBulkCreate: draft.allowCsv,
        updatedBy: currentUser.id,
      });
      addNotification('保存完了', `${summary.user.name} の店舗制御を更新しました。`, 'SUCCESS');
      await loadUsers(activeOrgId);
    } catch (error) {
      const message = error instanceof Error ? error.message : '店舗制御設定の保存に失敗しました。';
      addNotification('保存エラー', message, 'ERROR');
      setControlDraft(summary.user.id, { isSaving: false });
    }
  };

  const handleDownloadCsvTemplate = () => {
    const csv = storeCsvImportService.buildTemplateCsv();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'store_bulk_template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCsvFileSelected = async (file: File | null) => {
    if (!file) {
      setCsvFileName('');
      setCsvParseResult({ rows: [], errors: [] });
      setCsvExecutionErrors([]);
      return;
    }

    try {
      const text = await file.text();
      const parsed = storeCsvImportService.parseAndValidateCsv(text);
      setCsvFileName(file.name);
      setCsvParseResult(parsed);
      setCsvExecutionErrors([]);

      if (parsed.errors.length > 0) {
        addNotification('CSV検証エラー', `検証エラーが ${parsed.errors.length} 件あります。`, 'WARNING');
      } else {
        addNotification('CSV検証完了', `有効データ ${parsed.rows.length} 行を検出しました。`, 'SUCCESS');
      }
    } catch (error) {
      console.error('[UserManagement] Failed to parse CSV:', error);
      addNotification('CSV解析エラー', 'CSVの解析に失敗しました。', 'ERROR');
      setCsvFileName(file.name);
      setCsvParseResult({ rows: [], errors: [] });
    }
  };

  const handleExecuteCsvImport = async () => {
    if (!activeOrgId) {
      addNotification('店舗未選択', '店舗が選択されていません。', 'WARNING');
      return;
    }
    if (!selectedCsvTarget) {
      addNotification('対象未選択', 'CSV投入先のUSERを選択してください。', 'WARNING');
      return;
    }
    if (csvParseResult.errors.length > 0) {
      addNotification('検証エラーあり', 'CSV検証エラーを解消してから実行してください。', 'WARNING');
      return;
    }
    if (csvParseResult.rows.length === 0) {
      addNotification('データなし', 'CSVに有効なデータ行がありません。', 'WARNING');
      return;
    }

    setIsExecutingCsv(true);
    try {
      const result = await storeLifecycleService.createStoresByCsvForUser({
        orgId: activeOrgId,
        userId: selectedCsvTarget.user.id,
        rows: csvParseResult.rows,
      });

      if (!result.ok) {
        setCsvExecutionErrors(result.errors);
        addNotification('CSV実行エラー', result.errors[0]?.message || 'CSV一括作成に失敗しました。', 'ERROR');
        return;
      }

      setCsvExecutionErrors([]);
      addNotification('CSV実行完了', `${result.createdCount} 店舗を作成しました。`, 'SUCCESS');
      await Promise.all([loadUsers(activeOrgId), reloadStores()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'CSV一括作成に失敗しました。';
      addNotification('CSV実行エラー', message, 'ERROR');
    } finally {
      setIsExecutingCsv(false);
    }
  };

  const handleExport = () => {
    const headers = ['ID', 'Username', 'Name', 'Email', 'Role', 'Plan', 'Registered At'];
    const csvContent = [
      headers.join(','),
      ...userRows.map((row) => {
        const user = row.user;
        return [
          user.id,
          user.username,
          user.name,
          user.email,
          user.role,
          user.plan,
          user.lastLoginAt.toISOString(),
        ].join(',');
      }),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'users_export.csv';
    link.click();
    URL.revokeObjectURL(url);

    addNotification('エクスポート完了', 'ユーザーリストをCSVとしてダウンロードしました。', 'SUCCESS');
  };

  const roleLabel = (role: Role) => {
    switch (role) {
      case Role.ADMIN:
        return '内部 (Admin)';
      case Role.SUPERVISOR:
        return '代理店 (Supervisor)';
      case Role.MANAGER:
        return '店舗責任者 (Manager)';
      case Role.USER:
        return '一般ユーザー (User)';
      default:
        return role;
    }
  };

  const roleColor = (role: Role) => {
    switch (role) {
      case Role.ADMIN:
        return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800';
      case Role.SUPERVISOR:
        return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800';
      case Role.MANAGER:
        return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800';
      case Role.USER:
        return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const editableRolesForActor = useMemo<Role[]>(() => {
    if (currentUser.role === Role.ADMIN) {
      return [Role.ADMIN, Role.SUPERVISOR, Role.MANAGER, Role.USER];
    }
    if (currentUser.role === Role.SUPERVISOR) {
      return [Role.MANAGER, Role.USER];
    }
    if (currentUser.role === Role.MANAGER) {
      return [Role.USER];
    }
    return [];
  }, [currentUser.role]);

  const totalUsers = userRows.length;
  const activeUsers = userRows.filter(
    (row) => new Date().getTime() - row.user.lastLoginAt.getTime() < 7 * 24 * 60 * 60 * 1000
  ).length;
  const newThisMonth = userRows.filter(
    (row) => row.user.lastLoginAt.getMonth() === new Date().getMonth() && row.user.lastLoginAt.getFullYear() === new Date().getFullYear()
  ).length;

  const StatCard = ({ title, value, icon: Icon, color }: any) => (
    <div className={`${PAGE_CARD_CLASS} p-6 flex items-center gap-4`}>
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
    <div className={PAGE_CONTAINER_CLASS}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className={PAGE_HEADER_TITLE_CLASS}>{formatViewLabel('USER_MANAGEMENT')}</h1>
          <p className={PAGE_HEADER_DESCRIPTION_CLASS}>
            {isInternal
              ? '内部ユーザーとして、顧客グループのユーザーと契約プランを管理します。'
              : '自グループの顧客ユーザーを管理します。'}
          </p>
        </div>
        <div id="user-management-actions" className="flex gap-3">
          <button
            onClick={handleExport}
            className="flex items-center space-x-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-white px-4 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-600 transition-all"
          >
            <Download size={18} />
            <span>CSVエクスポート</span>
          </button>
          <button
            onClick={openAttachExistingModal}
            className="flex items-center space-x-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-white px-4 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-600 transition-all"
          >
            <Layers size={18} />
            <span>既存ユーザーを追加</span>
          </button>
          <button
            onClick={openInviteModal}
            className="flex items-center space-x-2 bg-primary-600 text-white px-4 py-2 rounded-xl hover:bg-primary-700 shadow-md shadow-primary-200 dark:shadow-none transition-all"
          >
            <UserPlus size={18} />
            <span>新規ユーザー作成</span>
          </button>
        </div>
      </div>

      {!activeOrgId && (
        <div className={PAGE_WARNING_CLASS}>
          店舗が選択されていません。右上の店舗セレクタから選択してください。
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard title="総ユーザー数" value={totalUsers} icon={UsersIcon} color="bg-blue-500" />
        <StatCard title="直近7日でログイン" value={activeUsers} icon={TrendingUp} color="bg-green-500" />
        <StatCard title="今月の新規ユーザー" value={newThisMonth} icon={Award} color="bg-purple-500" />
      </div>

      <div className={`${PAGE_CARD_CLASS} p-6`}>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
              ユーザー検索（名前 / メール）
            </label>
            <input
              id="user-filter-search"
              data-testid="user-filter-search"
              type="text"
              value={userSearchTerm}
              onChange={(e) => setUserSearchTerm(e.target.value)}
              placeholder="例: 山田 / example@company.com"
              className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">権限ロール</label>
            <select
              id="user-filter-role"
              data-testid="user-filter-role"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as Role | 'ALL')}
              className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
            >
              <option value="ALL">すべて</option>
              <option value={Role.ADMIN}>{roleLabel(Role.ADMIN)}</option>
              <option value={Role.SUPERVISOR}>{roleLabel(Role.SUPERVISOR)}</option>
              <option value={Role.MANAGER}>{roleLabel(Role.MANAGER)}</option>
              <option value={Role.USER}>{roleLabel(Role.USER)}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">契約プラン</label>
            <select
              id="user-filter-plan"
              data-testid="user-filter-plan"
              value={planFilter}
              onChange={(e) => setPlanFilter(e.target.value)}
              className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
            >
              <option value="ALL">すべて</option>
              {availablePlanCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">並び替え項目</label>
            <select
              id="user-sort-key"
              data-testid="user-sort-key"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as UserSortKey)}
              className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
            >
              <option value="REGISTERED_AT">登録日</option>
              <option value="USER_INFO">ユーザー情報</option>
              <option value="PLAN">契約プラン</option>
              <option value="ROLE">権限ロール</option>
              <option value="STORE_COUNT">店舗数</option>
              <option value="STORE_LIMIT">上限店舗数</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">並び順</label>
            <select
              id="user-sort-direction"
              data-testid="user-sort-direction"
              value={sortDirection}
              onChange={(e) => setSortDirection(e.target.value as 'ASC' | 'DESC')}
              className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
            >
              <option value="DESC">降順</option>
              <option value="ASC">昇順</option>
            </select>
          </div>
        </div>
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          表示: {filteredUserRows.length} / {userRows.length}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[1120px]">
            <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">ユーザー情報</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">契約プラン</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">権限ロール</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">登録日</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">店舗数 / 上限</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">CSV一括店舗作成</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-right">アクション</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-6 py-6 text-sm text-gray-500 dark:text-gray-400">
                    読み込み中...
                  </td>
                </tr>
              )}
              {!isLoading && filteredUserRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-6 text-sm text-gray-500 dark:text-gray-400">
                    条件に一致するユーザーがいません。
                  </td>
                </tr>
              )}

              {filteredUserRows.map((summary) => {
                const user = summary.user;
                const draft =
                  controlDrafts[user.id] ||
                  ({
                    maxStoresInput: summary.maxStoresOverride ? String(summary.maxStoresOverride) : '',
                    allowCsv: summary.allowCsvStoreBulkCreate,
                    isSaving: false,
                  } satisfies ControlDraft);

                const canEditStoreControl = isInternal && user.id !== currentUser.id && user.role === Role.USER;
                const rawPlanCode = String(user.plan || '').trim().toUpperCase();
                const draftPlanCode = String(planDrafts[user.id] || rawPlanCode).trim().toUpperCase();
                const selectedPlanCode = selectablePlanCodeSet.has(draftPlanCode) ? draftPlanCode : '';
                const canAssignPlan = isInternal && user.id !== currentUser.id && canManage(user) && summary.userStoreIds.length > 0;
                const isSavingPlan = savingPlanUserId === user.id;
                const hasPlanSelection = selectedPlanCode.length > 0;
                const hasPlanChanged = hasPlanSelection && selectedPlanCode !== rawPlanCode;

                return (
                  <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors align-top">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10">
                          <img
                            className="h-10 w-10 rounded-full bg-gray-200 dark:bg-gray-600 object-cover border border-gray-200 dark:border-gray-600"
                            src={user.avatarUrl}
                            alt=""
                          />
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
                      <div className="flex flex-col gap-2">
                        <span className="text-sm font-bold text-gray-800 dark:text-white">{rawPlanCode || 'UNASSIGNED'}</span>
                        <span className="text-xs text-gray-400">
                          対象店舗: {summary.userStoreIds.length}件
                        </span>
                        {canAssignPlan ? (
                          <div className="flex items-center gap-2">
                            <select
                              data-testid={`user-plan-select-${user.id}`}
                              value={selectedPlanCode}
                              onChange={(e) => setPlanDraft(user.id, e.target.value)}
                              disabled={isLoadingInvitePlans || isSavingPlan}
                              className="w-36 p-1.5 text-xs bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg"
                            >
                              <option value="">プランを選択</option>
                              {invitePlanCatalog.map((plan) => (
                                <option key={plan.id} value={plan.code.toUpperCase()}>
                                  {plan.code.toUpperCase()}
                                </option>
                              ))}
                            </select>
                            <button
                              data-testid={`user-plan-save-${user.id}`}
                              onClick={() => void handleSaveUserPlan(summary)}
                              disabled={isSavingPlan || isLoadingInvitePlans || !hasPlanSelection || !hasPlanChanged}
                              className="px-2.5 py-1.5 text-xs font-bold text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {isSavingPlan ? '変更中...' : '変更'}
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {isInternal && user.id !== currentUser.id && canManage(user)
                              ? '店舗未割り当てのため変更不可'
                              : '請求管理: 別システム'}
                          </span>
                        )}
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

                    <td className="px-6 py-4 whitespace-nowrap">
                      {user.role === Role.USER ? (
                        <div className="space-y-2">
                          <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                            {summary.currentStoreCount} / {summary.effectiveStoreLimit}
                          </div>
                          {canEditStoreControl ? (
                            <input
                              data-testid={`user-max-stores-${user.id}`}
                              type="number"
                              min={1}
                              value={draft.maxStoresInput}
                              onChange={(e) => setControlDraft(user.id, { maxStoresInput: e.target.value })}
                              className="w-24 p-1.5 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg"
                              placeholder="既定値"
                            />
                          ) : (
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {summary.maxStoresOverride ? `個別上限: ${summary.maxStoresOverride}` : '既定値'}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap">
                      {user.role === Role.USER ? (
                        canEditStoreControl ? (
                          <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                            <input
                              data-testid={`user-allow-csv-${user.id}`}
                              type="checkbox"
                              checked={draft.allowCsv}
                              onChange={(e) => setControlDraft(user.id, { allowCsv: e.target.checked })}
                              className="h-4 w-4"
                            />
                            {draft.allowCsv ? 'ON' : 'OFF'}
                          </label>
                        ) : (
                          <span className={`text-xs font-semibold ${summary.allowCsvStoreBulkCreate ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}`}>
                            {summary.allowCsvStoreBulkCreate ? 'ON' : 'OFF'}
                          </span>
                        )
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      {user.id !== currentUser.id && canManage(user) ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            data-testid={`user-edit-${user.id}`}
                            onClick={() => openEditUserModal(summary)}
                            disabled={deletingUserId === user.id}
                            className="px-3 py-2 text-xs font-bold text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg hover:bg-primary-100 dark:hover:bg-primary-900/30 disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            編集
                          </button>
                          {canEditStoreControl && (
                            <button
                              data-testid={`user-control-save-${user.id}`}
                              onClick={() => void handleSaveUserControl(summary)}
                              disabled={draft.isSaving}
                              className="px-3 py-2 text-xs font-bold text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {draft.isSaving ? '保存中...' : '制御保存'}
                            </button>
                          )}
                          <button
                            data-testid={`user-remove-${user.id}`}
                            onClick={() => handleRemoveFromOrg(user.id)}
                            disabled={deletingUserId === user.id}
                            className="p-2 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 bg-red-50 dark:bg-red-900/20 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            title="グループから外す"
                          >
                            <Trash2 size={16} />
                          </button>
                          {currentUser.role === Role.ADMIN && (
                            <button
                              data-testid={`user-full-delete-${user.id}`}
                              onClick={() => void handleFullDelete(summary)}
                              disabled={deletingUserId === user.id}
                              className="px-3 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              完全削除
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="text-gray-300 dark:text-gray-600 text-xs italic">
                          {user.id === currentUser.id ? 'あなた' : '操作権限なし'}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {isInternal && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Upload size={18} />
                CSV一括店舗作成（USER向け）
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                USERごとのON/OFFと上限を適用し、1件でも不正があれば全体失敗で取り込みます。
              </p>
            </div>
            <button
              data-testid="store-csv-template-download"
              onClick={handleDownloadCsvTemplate}
              className="px-3 py-2 text-sm font-bold rounded-xl border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-100 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600"
            >
              テンプレートDL
            </button>
          </div>

          <div className="p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">対象USER</label>
                <select
                  data-testid="store-csv-user-select"
                  value={selectedCsvUserId}
                  onChange={(e) => {
                    setSelectedCsvUserId(e.target.value);
                    setCsvExecutionErrors([]);
                  }}
                  className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                >
                  <option value="">選択してください</option>
                  {userOnlyRows.map((row) => (
                    <option key={row.user.id} value={row.user.id}>
                      {row.user.name}（現在 {row.currentStoreCount} / 上限 {row.effectiveStoreLimit}）
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CSVアップロード</label>
                <input
                  data-testid="store-csv-file-input"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => void handleCsvFileSelected(e.target.files?.[0] || null)}
                  className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                />
                {csvFileName && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">選択中: {csvFileName}</p>}
              </div>
            </div>

            {selectedCsvTarget && (
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/20 p-3 text-sm text-gray-700 dark:text-gray-200">
                <p>
                  対象ユーザー: <span className="font-bold">{selectedCsvTarget.user.name}</span>
                </p>
                <p>
                  CSV一括許可: <span className="font-bold">{selectedCsvTarget.allowCsvStoreBulkCreate ? 'ON' : 'OFF'}</span>
                </p>
              </div>
            )}

            {csvParseResult.errors.length > 0 && (
              <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
                <div className="flex items-center gap-2 text-red-700 dark:text-red-300 font-bold text-sm mb-2">
                  <FileWarning size={16} />
                  CSV検証エラー（先頭20件）
                </div>
                <ul className="space-y-1 text-xs text-red-700 dark:text-red-200">
                  {csvParseResult.errors.slice(0, 20).map((error, index) => (
                    <li key={`${error.line}-${error.column}-${index}`}>
                      line {error.line} / {error.column} / {error.code}: {error.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {csvExecutionErrors.length > 0 && (
              <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
                <div className="flex items-center gap-2 text-red-700 dark:text-red-300 font-bold text-sm mb-2">
                  <FileWarning size={16} />
                  CSV実行エラー（先頭20件）
                </div>
                <ul className="space-y-1 text-xs text-red-700 dark:text-red-200">
                  {csvExecutionErrors.slice(0, 20).map((error, index) => (
                    <li key={`${error.line}-${error.column}-${index}`}>
                      line {error.line} / {error.column} / {error.code}: {error.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {csvParseResult.errors.length === 0 && csvParseResult.rows.length > 0 && (
              <div className="rounded-xl border border-green-200 dark:border-green-700 bg-green-50 dark:bg-green-900/20 p-4 text-sm text-green-700 dark:text-green-300 flex items-center gap-2">
                <CheckCircle2 size={16} />
                CSV検証OK: {csvParseResult.rows.length} 行
              </div>
            )}

            <div className="flex justify-end">
              <button
                data-testid="store-csv-execute"
                onClick={() => void handleExecuteCsvImport()}
                disabled={
                  isExecutingCsv ||
                  !selectedCsvTarget ||
                  !selectedCsvTarget.allowCsvStoreBulkCreate ||
                  csvParseResult.rows.length === 0 ||
                  csvParseResult.errors.length > 0
                }
                className="px-4 py-2 text-sm font-bold text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isExecutingCsv ? 'CSV実行中...' : 'CSV一括作成を実行'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isInviteOpen && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-xl p-6">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">新規ユーザー作成（招待）</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">名前</label>
                  <input
                    data-testid="invite-name-input"
                    type="text"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">メールアドレス</label>
                  <input
                    data-testid="invite-email-input"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                  />
                </div>
                {isInternal && (
                  <details className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/20 p-3">
                    <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300">
                      詳細（監査用）
                    </summary>
                    <div className="mt-3">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        監査用パスワード（任意）
                      </label>
                      <input
                        data-testid="invite-password-input"
                        type="password"
                        value={invitePassword}
                        onChange={(e) => setInvitePassword(e.target.value)}
                        placeholder="入力時はメール招待せず即時作成"
                        className="w-full p-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl"
                      />
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        監査自動化用の任意項目です。空欄の場合は招待メールを送信します。
                      </p>
                    </div>
                  </details>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">権限ロール</label>
                    <select
                      data-testid="invite-role-select"
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as Role)}
                      className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                    >
                      {currentUser.role === Role.ADMIN && (
                        <>
                          <option value={Role.ADMIN}>ADMIN（内部）</option>
                          <option value={Role.SUPERVISOR}>SUPERVISOR（代理店）</option>
                          <option value={Role.MANAGER}>MANAGER（顧客リーダー）</option>
                          <option value={Role.USER}>USER（一般ユーザー）</option>
                        </>
                      )}
                      {currentUser.role === Role.SUPERVISOR && (
                        <>
                          <option value={Role.MANAGER}>MANAGER（顧客リーダー）</option>
                          <option value={Role.USER}>USER（一般ユーザー）</option>
                        </>
                      )}
                      {currentUser.role === Role.MANAGER && (
                        <option value={Role.USER}>USER（一般ユーザー）</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">グループ（必須）</label>
                    {(currentUser.role === Role.ADMIN || currentUser.role === Role.SUPERVISOR) && (
                      <div className="mb-2 flex gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => setInviteGroupMode('EXISTING')}
                          className={`px-3 py-1 rounded-full border ${
                            inviteGroupMode === 'EXISTING'
                              ? 'border-primary-500 bg-primary-50 text-primary-700'
                              : 'border-gray-300 text-gray-600'
                          }`}
                        >
                          既存グループを選ぶ
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setInviteGroupMode('NEW');
                            setInviteStoreMode('NEW');
                          }}
                          className={`px-3 py-1 rounded-full border ${
                            inviteGroupMode === 'NEW'
                              ? 'border-primary-500 bg-primary-50 text-primary-700'
                              : 'border-gray-300 text-gray-600'
                          }`}
                        >
                          新規グループを作成
                        </button>
                      </div>
                    )}
                    {inviteGroupMode === 'NEW' ? (
                      <input
                        value={inviteNewGroupName}
                        onChange={(event) => setInviteNewGroupName(event.target.value)}
                        placeholder="新規グループ名"
                        className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                      />
                    ) : (
                      <select
                        value={inviteGroupId}
                        onChange={(event) => setInviteGroupId(event.target.value)}
                        disabled={isLoadingInviteGroups}
                        className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                      >
                        <option value="">選択してください</option>
                        {inviteGroups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">店舗（必須）</label>
                  {inviteGroupMode === 'EXISTING' && (
                    <div className="mb-2 flex gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => setInviteStoreMode('EXISTING')}
                        className={`px-3 py-1 rounded-full border ${
                          inviteStoreMode === 'EXISTING'
                            ? 'border-primary-500 bg-primary-50 text-primary-700'
                            : 'border-gray-300 text-gray-600'
                        }`}
                      >
                        既存店舗を選ぶ
                      </button>
                      <button
                        type="button"
                        onClick={() => setInviteStoreMode('NEW')}
                        className={`px-3 py-1 rounded-full border ${
                          inviteStoreMode === 'NEW'
                            ? 'border-primary-500 bg-primary-50 text-primary-700'
                            : 'border-gray-300 text-gray-600'
                        }`}
                      >
                        新規店舗を作成
                      </button>
                    </div>
                  )}

                  {(inviteGroupMode === 'NEW' || inviteStoreMode === 'NEW') ? (
                    <input
                      value={inviteNewStoreName}
                      onChange={(event) => setInviteNewStoreName(event.target.value)}
                      placeholder={inviteGroupMode === 'NEW' ? '初期店舗名' : '新規店舗名'}
                      className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                    />
                  ) : (
                    <select
                      value={inviteStoreId}
                      onChange={(event) => setInviteStoreId(event.target.value)}
                      disabled={!inviteGroupId}
                      className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                    >
                      <option value="">選択してください</option>
                      {inviteStoreCandidates.map((store) => (
                        <option key={store.id} value={store.id}>
                          {store.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {isInternal && (
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/20 p-3">
                    <div className="text-xs text-gray-600 dark:text-gray-300 mb-2">
                      ここで選んだプランは、作成/選択した店舗に即時反映されます（任意）。
                    </div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      契約プラン（任意）
                    </label>
                    <select
                      value={invitePlanCode}
                      onChange={(e) => setInvitePlanCode(e.target.value)}
                      disabled={isLoadingInvitePlans || !(inviteRole === Role.MANAGER || inviteRole === Role.USER)}
                      className="w-full p-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl"
                    >
                      <option value="">指定しない（既存の店舗プランを維持）</option>
                      {invitePlanCatalog.map((plan) => (
                        <option key={plan.id} value={plan.code}>
                          {plan.code}（{plan.name}）
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  新規ユーザー作成では、グループと店舗の作成または割当が必須です。
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
                  data-testid="invite-copy-link-button"
                  onClick={() => void handleCopyInviteLink('INVITE')}
                  disabled={isGeneratingInviteLink || isInviting}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Link2 size={16} />
                  {isGeneratingInviteLink ? '生成中...' : '招待URLをコピー'}
                </button>
                <button
                  onClick={() => void handleInvite()}
                  disabled={isInviting}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isInviting ? '送信中...' : '招待を送信'}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {isAttachExistingOpen && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-xl p-6 space-y-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">既存ユーザーを追加</h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">追加ロール</label>
                  <select
                    value={attachRole}
                    onChange={(event) => setAttachRole(event.target.value as Role)}
                    className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                  >
                    {currentUser.role === Role.ADMIN && (
                      <>
                        <option value={Role.SUPERVISOR}>SUPERVISOR</option>
                        <option value={Role.MANAGER}>MANAGER</option>
                        <option value={Role.USER}>USER</option>
                      </>
                    )}
                    {currentUser.role === Role.SUPERVISOR && (
                      <>
                        <option value={Role.MANAGER}>MANAGER</option>
                        <option value={Role.USER}>USER</option>
                      </>
                    )}
                    {currentUser.role === Role.MANAGER && (
                      <option value={Role.USER}>USER</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">追加先グループ</label>
                  <select
                    value={attachGroupId}
                    onChange={(event) => setAttachGroupId(event.target.value)}
                    className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                  >
                    <option value="">選択してください</option>
                    {inviteGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">追加先店舗</label>
                  <select
                    value={attachStoreId}
                    onChange={(event) => setAttachStoreId(event.target.value)}
                    className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                    disabled={!attachGroupId}
                  >
                    <option value="">選択してください</option>
                    {attachStoreCandidates.map((store) => (
                      <option key={store.id} value={store.id}>
                        {store.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">既存ユーザー検索（メール / 名前）</label>
                <div className="flex gap-2">
                  <input
                    value={attachSearchTerm}
                    onChange={(event) => setAttachSearchTerm(event.target.value)}
                    placeholder="例: sample@example.com"
                    className="flex-1 p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                  />
                  <button
                    type="button"
                    onClick={() => void searchExistingUsers()}
                    disabled={isSearchingExisting}
                    className="px-4 py-2 text-sm font-semibold rounded-xl border border-primary-200 bg-primary-50 text-primary-700 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isSearchingExisting ? '検索中...' : '検索'}
                  </button>
                </div>
              </div>

              <div className="max-h-64 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                {attachCandidates.length === 0 ? (
                  <div className="p-4 text-sm text-gray-500 dark:text-gray-400">検索結果がありません。</div>
                ) : (
                  attachCandidates.map((candidate) => (
                    <label key={candidate.userId} className="flex items-start gap-3 p-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40">
                      <input
                        type="radio"
                        name="attach-existing-user"
                        checked={selectedAttachUserId === candidate.userId}
                        onChange={() => setSelectedAttachUserId(candidate.userId)}
                        className="mt-1"
                      />
                      <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">{candidate.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{candidate.email}</p>
                      </div>
                    </label>
                  ))
                )}
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setIsAttachExistingOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg"
                >
                  キャンセル
                </button>
                <button
                  onClick={() => void handleAttachExistingUser()}
                  disabled={isAttachingExisting || !selectedAttachUserId || !attachGroupId || !attachStoreId}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isAttachingExisting ? '追加中...' : '既存ユーザーを追加'}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {editingUserSummary && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-xl p-6">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">ユーザー編集</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">表示名</label>
                  <input
                    data-testid="user-edit-name-input"
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">権限ロール</label>
                  <select
                    data-testid="user-edit-role-select"
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as Role)}
                    className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                  >
                    {Array.from(new Set([...editableRolesForActor, editingUserSummary.user.role])).map((role) => (
                      <option key={role} value={role}>
                        {roleLabel(role)}
                      </option>
                    ))}
                  </select>
                </div>
                {editRole === Role.USER && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      利用可能な店舗（複数選択）
                    </label>
                    <div className="max-h-52 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                      {stores.length === 0 ? (
                        <div className="p-3 text-sm text-gray-500 dark:text-gray-400">選択可能な店舗がありません。</div>
                      ) : (
                        stores.map((store) => (
                          <label
                            key={store.id}
                            className="flex items-center justify-between p-3 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer"
                          >
                            <span>{store.name}</span>
                            <input
                              data-testid={`user-edit-store-${store.id}`}
                              type="checkbox"
                              checked={editStoreIds.includes(store.id)}
                              onChange={() => toggleEditStoreId(store.id)}
                              className="h-4 w-4"
                            />
                          </label>
                        ))
                      )}
                    </div>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      未選択でも保存できます（所属は残り、店舗アクセスは0件になります）。
                    </p>
                  </div>
                )}
              </div>
              <div className="mt-6 flex flex-wrap justify-between gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopyRecoveryLinkForUser(editingUserSummary)}
                  disabled={isGeneratingInviteLink}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Link2 size={16} />
                  {isGeneratingInviteLink ? '生成中...' : '再設定URLをコピー'}
                </button>
                <div className="flex gap-2">
                <button
                  onClick={closeEditUserModal}
                  disabled={isSavingEditUser}
                  className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg disabled:opacity-60"
                >
                  キャンセル
                </button>
                <button
                  data-testid="user-edit-save-button"
                  onClick={() => void handleSaveUserEdit()}
                  disabled={isSavingEditUser}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSavingEditUser ? '保存中...' : '保存'}
                </button>
                </div>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};
