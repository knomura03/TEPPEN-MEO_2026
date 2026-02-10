import React, { useEffect, useMemo, useState } from 'react';
import { BillingPlan, Role, StoreGroup, User, VisibilityState } from '../types';
import { MOCK_USERS } from '../constants';
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
} from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';
import { isSupabaseConfigured, supabase } from '../services/supabaseClient';
import { ManagedUserStoreSummary, userManagementService } from '../services/userManagementService';
import { userStoreControlsService } from '../services/userStoreControlsService';
import { storeCsvImportService, StoreCsvParseResult } from '../services/storeCsvImportService';
import { storeLifecycleService } from '../services/storeLifecycleService';
import { featureFlagsService } from '../services/featureFlagsService';
import { billingService } from '../services/billingService';
import { getErrorMessage } from '../services/errorMessage';
import { useStore } from '../contexts/StoreContext';
import { storeGroupsService } from '../services/storeGroupsService';
import { ModalPortal } from './ModalPortal';
import { PAGE_CARD_CLASS, PAGE_CONTAINER_CLASS, PAGE_HEADER_DESCRIPTION_CLASS, PAGE_HEADER_TITLE_CLASS, PAGE_WARNING_CLASS } from './ui/pageLayout';

interface UserManagementProps {
  currentUser: User;
}

type ControlDraft = {
  maxStoresInput: string;
  allowCsv: boolean;
  isSaving: boolean;
};

const defaultSummaryFromUser = (user: User): ManagedUserStoreSummary => ({
  user,
  currentStoreCount: user.role === Role.USER ? 1 : 0,
  effectiveStoreLimit: user.role === Role.USER ? 1 : 0,
  maxStoresOverride: undefined,
  allowCsvStoreBulkCreate: false,
});

const fallbackSummary = MOCK_USERS.map(defaultSummaryFromUser);

const BULK_FEATURE_OPTIONS: { key: string; label: string; description: string }[] = [
  { key: 'dashboard', label: 'ダッシュボード', description: 'メニュー表示: ダッシュボード' },
  { key: 'calendar', label: 'カレンダー', description: 'メニュー表示: カレンダー' },
  { key: 'survey', label: 'アンケート', description: 'メニュー表示: アンケート' },
  { key: 'create_post', label: '新規投稿', description: 'メニュー表示: 新規投稿' },
  { key: 'post_list', label: '投稿一覧', description: 'メニュー表示: 投稿一覧' },
  { key: 'inbox', label: '受信箱', description: 'メニュー表示: 受信箱' },
];

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

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>(Role.USER);
  const [inviteStoreId, setInviteStoreId] = useState<string>('');
  const [invitePlanCode, setInvitePlanCode] = useState<string>('');
  const [invitePassword, setInvitePassword] = useState<string>('');
  const [isInviting, setIsInviting] = useState(false);
  const [orgPlanCode, setOrgPlanCode] = useState<string>('');
  const [isOrgPlanMissing, setIsOrgPlanMissing] = useState<boolean>(false);
  const [invitePlanCatalog, setInvitePlanCatalog] = useState<BillingPlan[]>([]);
  const [isLoadingInvitePlans, setIsLoadingInvitePlans] = useState<boolean>(false);

  const [storeGroups, setStoreGroups] = useState<StoreGroup[]>([]);
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<StoreGroup | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [groupStoreIds, setGroupStoreIds] = useState<string[]>([]);
  const [isSavingGroup, setIsSavingGroup] = useState(false);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [bulkSettingGroupId, setBulkSettingGroupId] = useState<string>('');
  const [bulkSettingFeatureKey, setBulkSettingFeatureKey] = useState<string>('create_post');
  const [bulkSettingState, setBulkSettingState] = useState<VisibilityState>('ENABLED');
  const [isApplyingBulkSetting, setIsApplyingBulkSetting] = useState(false);

  const [selectedCsvUserId, setSelectedCsvUserId] = useState<string>('');
  const [csvFileName, setCsvFileName] = useState('');
  const [csvParseResult, setCsvParseResult] = useState<StoreCsvParseResult>({ rows: [], errors: [] });
  const [csvExecutionErrors, setCsvExecutionErrors] = useState<StoreCsvParseResult['errors']>([]);
  const [isExecutingCsv, setIsExecutingCsv] = useState(false);

  const invokeAdminFunctionByHttp = async (
    functionName: string,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> => {
    if (!supabase) throw new Error('Supabase client is not initialized.');

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (!supabaseUrl || !anonKey) {
      throw new Error('Supabase環境変数が不足しています。VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を確認してください。');
    }

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      throw new Error('ログインセッションが無効です。いったんログアウトして再ログインしてください。');
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}?client=direct-http-v3`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let body: Record<string, unknown> | null = null;
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      body = null;
    }

    if (!response.ok) {
      const message = body?.error || body?.message || text || `status=${response.status}`;
      throw new Error(`${String(message)}（status=${response.status}）`);
    }
    return body;
  };

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

  const userOnlyRows = useMemo(
    () => userRows.filter((row) => row.user.role === Role.USER),
    [userRows]
  );

  const selectedCsvTarget = useMemo(
    () => userOnlyRows.find((row) => row.user.id === selectedCsvUserId) || null,
    [selectedCsvUserId, userOnlyRows]
  );
  const selectedBulkSettingGroup = useMemo(
    () => storeGroups.find((group) => group.id === bulkSettingGroupId) || null,
    [bulkSettingGroupId, storeGroups]
  );
  const canApplyBulkSetting = isInternal;
  const filteredUserRows = useMemo(() => {
    const normalizedSearch = userSearchTerm.trim().toLowerCase();
    return userRows.filter((row) => {
      if (roleFilter !== 'ALL' && row.user.role !== roleFilter) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      const name = row.user.name.toLowerCase();
      const email = row.user.email.toLowerCase();
      return name.includes(normalizedSearch) || email.includes(normalizedSearch);
    });
  }, [roleFilter, userRows, userSearchTerm]);

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

  const loadUsers = async (orgId: string | null) => {
    if (!isSupabaseConfigured) {
      setUserRows(fallbackSummary);
      syncControlDrafts(fallbackSummary);
      return;
    }
    if (!orgId) {
      setUserRows([]);
      syncControlDrafts([]);
      return;
    }
    setIsLoading(true);
    try {
      const data = await userManagementService.listUsersByOrgWithStoreStats(orgId);
      setUserRows(data);
      syncControlDrafts(data);
    } catch (error) {
      console.error('[UserManagement] Failed to load users:', error);
      addNotification('読み込みエラー', 'ユーザー一覧の取得に失敗しました。', 'ERROR');
      setUserRows([]);
      syncControlDrafts([]);
    } finally {
      setIsLoading(false);
    }
  };

  const loadStoreGroups = async (orgId: string | null) => {
    if (!isSupabaseConfigured) {
      setStoreGroups([]);
      return;
    }
    if (!orgId) {
      setStoreGroups([]);
      return;
    }
    setIsLoadingGroups(true);
    try {
      const groups = await storeGroupsService.listByOrg(orgId);
      setStoreGroups(groups);
    } catch (error) {
      const message = error instanceof Error ? error.message : '店舗グループの取得に失敗しました。';
      addNotification('店舗グループ取得エラー', message, 'ERROR');
      setStoreGroups([]);
    } finally {
      setIsLoadingGroups(false);
    }
  };

  const loadOrgPlan = async (orgId: string | null) => {
    if (!isSupabaseConfigured) {
      setOrgPlanCode('FREE');
      setIsOrgPlanMissing(false);
      return;
    }
    if (!orgId) {
      setOrgPlanCode('');
      setIsOrgPlanMissing(false);
      return;
    }

    try {
      const subscription = await billingService.getOrgSubscription(orgId);
      const code = subscription?.billingPlan?.code ? String(subscription.billingPlan.code) : '';
      setOrgPlanCode(code);
      setIsOrgPlanMissing(!code);
      if (code) {
        setInvitePlanCode('');
      }
    } catch (error) {
      console.error('[UserManagement] Failed to load org plan:', error);
      setOrgPlanCode('');
      setIsOrgPlanMissing(true);
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

  useEffect(() => {
    if (!inviteStoreId && activeStoreId) {
      setInviteStoreId(activeStoreId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStoreId]);

  useEffect(() => {
    const loadData = async () => {
      await loadUsers(activeOrgId);
      await loadStoreGroups(activeOrgId);
      await loadOrgPlan(activeOrgId);
    };
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  useEffect(() => {
    if (!isInviteOpen) return;
    if (!isInternal) return;
    if (!activeOrgId) return;
    if (!isOrgPlanMissing) return;
    void loadInvitePlanCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInviteOpen, isInternal, activeOrgId, isOrgPlanMissing]);

  useEffect(() => {
    if (storeGroups.length === 0) {
      setBulkSettingGroupId('');
      return;
    }
    setBulkSettingGroupId((prev) => (storeGroups.some((group) => group.id === prev) ? prev : storeGroups[0].id));
  }, [storeGroups]);

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

  const handleDelete = (userId: string) => {
    if (!window.confirm('本当にこのユーザーを削除しますか？この組織への所属が解除されます。')) {
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

  const handleInvite = async () => {
    if (!inviteName.trim() || !inviteEmail.trim()) {
      addNotification('入力エラー', '名前とメールアドレスを入力してください。', 'WARNING');
      return;
    }

    if (!activeOrgId) {
      addNotification('店舗未選択', '店舗を選択してください。', 'WARNING');
      return;
    }

    if (!isSupabaseConfigured || !supabase) {
      addNotification('準備中', 'Supabase未設定のため招待できません。', 'INFO');
      return;
    }

    const needsPlanCode = isInternal && isOrgPlanMissing && (inviteRole === Role.MANAGER || inviteRole === Role.USER);
    if (needsPlanCode) {
      const code = invitePlanCode.trim().toUpperCase();
      if (!code) {
        addNotification('入力エラー', '契約プラン（planCode）を選択してください。', 'WARNING');
        return;
      }
    }

    setIsInviting(true);
    try {
      const normalizedStoreId = inviteRole === Role.USER && inviteStoreId ? inviteStoreId : null;
      const normalizedPlanCode = needsPlanCode ? invitePlanCode.trim().toUpperCase() : null;
      const normalizedPassword = invitePassword.trim();
      const data = await invokeAdminFunctionByHttp('admin-create-user', {
        name: inviteName.trim(),
        email: inviteEmail.trim(),
        role: inviteRole,
        orgId: activeOrgId,
        storeId: normalizedStoreId,
        planCode: normalizedPlanCode,
        password: normalizedPassword.length > 0 ? normalizedPassword : undefined,
      });
      if (data?.error) throw new Error(String(data.error));

      addNotification(
        '招待完了',
        normalizedPassword.length > 0 ? 'ユーザーを作成しました。' : '招待メールを送信しました。',
        'SUCCESS'
      );
      setInviteName('');
      setInviteEmail('');
      setInviteRole(Role.USER);
      setInviteStoreId(activeStoreId || '');
      setInvitePlanCode('');
      setInvitePassword('');
      setIsInviteOpen(false);
      await loadUsers(activeOrgId);
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

  const openCreateGroupModal = () => {
    setEditingGroup(null);
    setGroupName('');
    setGroupDescription('');
    setGroupStoreIds([]);
    setIsGroupModalOpen(true);
  };

  const openEditGroupModal = (group: StoreGroup) => {
    setEditingGroup(group);
    setGroupName(group.name);
    setGroupDescription(group.description || '');
    setGroupStoreIds(group.storeIds);
    setIsGroupModalOpen(true);
  };

  const closeGroupModal = () => {
    setIsGroupModalOpen(false);
    setEditingGroup(null);
    setGroupName('');
    setGroupDescription('');
    setGroupStoreIds([]);
  };

  const toggleGroupStore = (storeId: string) => {
    setGroupStoreIds((prev) => {
      if (prev.includes(storeId)) {
        return prev.filter((id) => id !== storeId);
      }
      return [...prev, storeId];
    });
  };

  const handleSaveGroup = async () => {
    if (!groupName.trim()) {
      addNotification('入力エラー', 'グループ名を入力してください。', 'WARNING');
      return;
    }
    if (!activeOrgId) {
      addNotification('店舗未選択', '店舗が選択されていません。', 'WARNING');
      return;
    }
    if (groupStoreIds.length === 0) {
      addNotification('入力エラー', 'グループに1店舗以上を選択してください。', 'WARNING');
      return;
    }
    if (!isSupabaseConfigured) {
      addNotification('準備中', 'Supabase未設定のためグループ管理は利用できません。', 'INFO');
      return;
    }

    setIsSavingGroup(true);
    try {
      if (editingGroup) {
        await storeGroupsService.update({
          id: editingGroup.id,
          name: groupName.trim(),
          description: groupDescription.trim() || undefined,
          storeIds: groupStoreIds,
        });
        addNotification('店舗グループ更新', '店舗グループを更新しました。', 'SUCCESS');
      } else {
        await storeGroupsService.create({
          orgId: activeOrgId,
          name: groupName.trim(),
          description: groupDescription.trim() || undefined,
          storeIds: groupStoreIds,
        });
        addNotification('店舗グループ作成', '店舗グループを作成しました。', 'SUCCESS');
      }
      closeGroupModal();
      await loadStoreGroups(activeOrgId);
    } catch (error) {
      const message = error instanceof Error ? error.message : '店舗グループの保存に失敗しました。';
      addNotification('店舗グループ保存エラー', message, 'ERROR');
    } finally {
      setIsSavingGroup(false);
    }
  };

  const handleDeleteGroup = async (group: StoreGroup) => {
    if (!window.confirm(`店舗グループ「${group.name}」を削除しますか？`)) return;
    if (!isSupabaseConfigured) {
      setStoreGroups((prev) => prev.filter((item) => item.id !== group.id));
      addNotification('店舗グループ削除', '店舗グループを削除しました。', 'SUCCESS');
      return;
    }
    if (!activeOrgId) {
      addNotification('店舗未選択', '店舗が選択されていません。', 'WARNING');
      return;
    }

    setDeletingGroupId(group.id);
    try {
      await storeGroupsService.remove(group.id);
      addNotification('店舗グループ削除', '店舗グループを削除しました。', 'SUCCESS');
      await loadStoreGroups(activeOrgId);
    } catch (error) {
      const message = error instanceof Error ? error.message : '店舗グループの削除に失敗しました。';
      addNotification('店舗グループ削除エラー', message, 'ERROR');
    } finally {
      setDeletingGroupId(null);
    }
  };

  const handleApplyBulkSetting = async () => {
    if (!activeOrgId) {
      addNotification('店舗未選択', '店舗が選択されていません。', 'WARNING');
      return;
    }
    if (!canApplyBulkSetting) {
      addNotification('権限エラー', '店舗グループ一括設定はADMINのみ実行できます。', 'ERROR');
      return;
    }
    if (!selectedBulkSettingGroup) {
      addNotification('グループ未選択', '対象グループを選択してください。', 'WARNING');
      return;
    }
    if (selectedBulkSettingGroup.storeIds.length === 0) {
      addNotification('対象店舗なし', '対象グループに店舗がありません。', 'WARNING');
      return;
    }
    if (!isSupabaseConfigured) {
      addNotification('準備中', 'Supabase未設定のため実行できません。', 'INFO');
      return;
    }

    setIsApplyingBulkSetting(true);
    try {
      const result = await featureFlagsService.upsertForStoreGroup({
        orgId: activeOrgId,
        storeIds: selectedBulkSettingGroup.storeIds,
        featureKey: bulkSettingFeatureKey,
        state: bulkSettingState,
        updatedBy: currentUser.id,
      });
      addNotification(
        '一括設定完了',
        `${selectedBulkSettingGroup.name} の ${result.appliedStoreCount} 店舗へ「${bulkSettingFeatureKey}=${bulkSettingState}」を反映しました。`,
        'SUCCESS'
      );
    } catch (error) {
      const message = getErrorMessage(error) || '店舗グループ一括設定に失敗しました。';
      addNotification('一括設定エラー', message, 'ERROR');
    } finally {
      setIsApplyingBulkSetting(false);
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
          <h1 className={PAGE_HEADER_TITLE_CLASS}>ユーザー・契約管理</h1>
          <p className={PAGE_HEADER_DESCRIPTION_CLASS}>
            {isInternal
              ? '内部ユーザーとして、顧客/代理店を含むユーザーと契約を管理します。'
              : '自組織の顧客ユーザーを管理します。'}
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
        <div className={PAGE_WARNING_CLASS}>
          店舗が選択されていません。右上の店舗セレクタから選択してください。
        </div>
      )}
      {isInternal && activeOrgId && isOrgPlanMissing && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-sm rounded-xl p-4">
          このORGは契約プランが未設定です。内部ユーザーが最初の顧客ユーザー（MANAGER/USER）を作成する場合、`planCode` が必須になります。
          事前に「課金・請求」画面でORGへプランを割り当てる運用がおすすめです。
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard title="総契約アカウント" value={totalUsers} icon={UsersIcon} color="bg-blue-500" />
        <StatCard title="直近7日登録" value={activeUsers} icon={TrendingUp} color="bg-green-500" />
        <StatCard title="今月の新規契約" value={newThisMonth} icon={Award} color="bg-purple-500" />
      </div>

      <div className={`${PAGE_CARD_CLASS} p-6`}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
              ユーザー検索（名前 / メール）
            </label>
            <input
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
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-gray-800 dark:text-white">{user.plan || 'FREE'}</span>
                        <span className="text-xs text-gray-400">請求管理: 別システム</span>
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

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Layers size={18} />
              店舗グループ管理
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              店舗をグルーピングして、次チケットの一括投稿/一括設定で利用します。
            </p>
          </div>
          <button
            data-testid="store-group-add"
            onClick={openCreateGroupModal}
            className="px-3 py-2 text-sm font-bold rounded-xl bg-primary-600 text-white hover:bg-primary-700"
          >
            グループ追加
          </button>
        </div>

        <div className="p-6">
          {isLoadingGroups ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">店舗グループを読み込み中...</p>
          ) : storeGroups.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">店舗グループはまだありません。</p>
          ) : (
            <div className="space-y-3">
              {storeGroups.map((group) => (
                <div
                  key={group.id}
                  className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/20 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-gray-900 dark:text-white">{group.name}</div>
                      {group.description && (
                        <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">{group.description}</div>
                      )}
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">対象店舗: {group.storeIds.length}件</div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {group.storeIds.map((storeId) => (
                          <span
                            key={storeId}
                            className="px-2 py-1 rounded-full text-[11px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200"
                          >
                            {storeNameById.get(storeId) || 'アクセス不可店舗'}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEditGroupModal(group)}
                        className="p-2 text-gray-600 hover:text-primary-600 dark:text-gray-300 dark:hover:text-primary-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
                        title="編集"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => void handleDeleteGroup(group)}
                        disabled={deletingGroupId === group.id}
                        className="p-2 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 bg-red-50 dark:bg-red-900/20 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                        title="削除"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="px-6 pb-6 border-t border-gray-100 dark:border-gray-700">
          <div className="pt-4 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">店舗グループ一括設定（機能公開）</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                対象グループの全店舗へ、同じ機能公開状態をまとめて反映します。
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">対象グループ</label>
                <select
                  data-testid="store-group-bulk-group-select"
                  value={bulkSettingGroupId}
                  onChange={(e) => setBulkSettingGroupId(e.target.value)}
                  className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm"
                >
                  {storeGroups.length === 0 && <option value="">グループがありません</option>}
                  {storeGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}（{group.storeIds.length}店舗）
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">設定対象</label>
                <select
                  data-testid="store-group-bulk-feature-select"
                  value={bulkSettingFeatureKey}
                  onChange={(e) => setBulkSettingFeatureKey(e.target.value)}
                  className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm"
                >
                  {BULK_FEATURE_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">公開状態</label>
                <select
                  data-testid="store-group-bulk-state-select"
                  value={bulkSettingState}
                  onChange={(e) => setBulkSettingState(e.target.value as VisibilityState)}
                  className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm"
                >
                  <option value="HIDDEN">非表示</option>
                  <option value="ADMIN_ONLY">内部のみ</option>
                  <option value="ENABLED">全体公開</option>
                </select>
              </div>
            </div>

            <div className="rounded-xl bg-gray-50 dark:bg-gray-900/20 border border-gray-200 dark:border-gray-700 p-3">
              <p className="text-xs text-gray-600 dark:text-gray-300">
                {BULK_FEATURE_OPTIONS.find((option) => option.key === bulkSettingFeatureKey)?.description || '機能公開設定'}
              </p>
              {!canApplyBulkSetting && (
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                  顧客MANAGERは参照のみです。実行は内部ユーザー（ADMIN/SUPERVISOR）で行ってください。
                </p>
              )}
            </div>

            <div className="flex justify-end">
              <button
                data-testid="store-group-bulk-apply"
                onClick={() => void handleApplyBulkSetting()}
                disabled={isApplyingBulkSetting || !canApplyBulkSetting || !selectedBulkSettingGroup}
                className="px-4 py-2 text-sm font-bold text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isApplyingBulkSetting ? '一括設定を適用中...' : '一括設定を適用'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {isInviteOpen && (
        <ModalPortal>
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
                    data-testid="invite-email-input"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    監査用パスワード（任意）
                  </label>
                  <input
                    data-testid="invite-password-input"
                    type="password"
                    value={invitePassword}
                    onChange={(e) => setInvitePassword(e.target.value)}
                    placeholder="入力時はメール招待せず即時作成"
                    className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    監査自動化用の任意項目です。空欄の場合は従来どおり招待メールを送信します。
                  </p>
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
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">初期店舗（任意）</label>
                    <select
                      value={inviteStoreId}
                      onChange={(e) => setInviteStoreId(e.target.value)}
                      disabled={inviteRole !== Role.USER}
                      className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                    >
                      <option value="">未選択（招待後に本人が作成）</option>
                      {stores.map((store) => (
                        <option key={store.id} value={store.id}>
                          {store.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {isInternal && activeOrgId && (
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/20 p-3">
                    {isOrgPlanMissing ? (
                      <>
                        <div className="text-xs font-bold text-amber-700 dark:text-amber-300 mb-2">
                          このORGは契約プラン未設定です（内部ユーザーが最初の顧客招待を行う場合、planCode必須）。
                        </div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          契約プラン（planCode）
                          {(inviteRole === Role.MANAGER || inviteRole === Role.USER) && <span className="text-red-500"> *</span>}
                        </label>
                        <select
                          value={invitePlanCode}
                          onChange={(e) => setInvitePlanCode(e.target.value)}
                          disabled={isLoadingInvitePlans || !(inviteRole === Role.MANAGER || inviteRole === Role.USER)}
                          className="w-full p-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl"
                        >
                          <option value="">選択してください</option>
                          {invitePlanCatalog.map((plan) => (
                            <option key={plan.id} value={plan.code}>
                              {plan.code}（{plan.name}）
                            </option>
                          ))}
                        </select>
                        {invitePlanCatalog.length === 0 && !isLoadingInvitePlans && (
                          <div className="text-xs text-amber-700 dark:text-amber-300 mt-2">
                            利用可能なプランがありません。先に「課金・請求」画面でプランを作成してください。
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-xs text-gray-600 dark:text-gray-300">
                        現在の契約プラン: <span className="font-bold">{orgPlanCode || 'FREE'}</span>
                        <span className="ml-2 text-gray-500 dark:text-gray-400">（変更は「課金・請求」画面で行います）</span>
                      </div>
                    )}
                  </div>
                )}
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  USERは初期店舗未選択でも招待できます（招待後に設定画面から店舗作成）。ADMIN/SUPERVISOR/MANAGERは全店アクセスです。
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

      {isGroupModalOpen && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div
              data-testid="store-group-modal"
              className="w-full max-w-2xl rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-xl p-6"
            >
              <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">{editingGroup ? '店舗グループ編集' : '店舗グループ作成'}</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">グループ名</label>
                  <input
                    data-testid="store-group-name"
                    type="text"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                    placeholder="例: 福岡エリア"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">説明（任意）</label>
                  <input
                    type="text"
                    value={groupDescription}
                    onChange={(e) => setGroupDescription(e.target.value)}
                    className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                    placeholder="例: 福岡県内の直営店舗"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">対象店舗</label>
                  <div className="max-h-60 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-xl divide-y divide-gray-100 dark:divide-gray-700">
                    {stores.length === 0 ? (
                      <p className="p-3 text-sm text-gray-500 dark:text-gray-400">選択可能な店舗がありません。</p>
                    ) : (
                      stores.map((store) => (
                        <label
                          key={store.id}
                          className="flex items-center justify-between gap-3 p-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30"
                        >
                          <span className="text-sm text-gray-800 dark:text-gray-100">{store.name}</span>
                          <input
                            type="checkbox"
                            checked={groupStoreIds.includes(store.id)}
                            onChange={() => toggleGroupStore(store.id)}
                            className="h-4 w-4"
                          />
                        </label>
                      ))
                    )}
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={closeGroupModal}
                  disabled={isSavingGroup}
                  className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg disabled:opacity-60"
                >
                  キャンセル
                </button>
                <button
                  data-testid="store-group-save"
                  onClick={() => void handleSaveGroup()}
                  disabled={isSavingGroup}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSavingGroup ? '保存中...' : editingGroup ? '更新' : '作成'}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};
