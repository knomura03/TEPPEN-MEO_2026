import React, { useEffect, useMemo, useState } from 'react';
import { BillingPlan, Role, StorePlanSchedule, User } from '../types';
import { useStore } from '../contexts/StoreContext';
import { useNotification } from '../contexts/NotificationContext';
import { billingService } from '../services/billingService';
import { getErrorMessage } from '../services/errorMessage';
import { isSupabaseConfigured, supabase } from '../services/supabaseClient';
import { PAGE_CARD_PADDED_CLASS, PAGE_CONTAINER_CLASS, PAGE_HEADER_DESCRIPTION_CLASS, PAGE_HEADER_TITLE_CLASS, PAGE_WARNING_CLASS } from './ui/pageLayout';
import { formatViewLabel } from './ui/formatters';

type BillingViewProps = {
  currentUser: User;
};

type AuditLogRow = {
  id: string;
  org_id: string | null;
  store_id: string | null;
  actor_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  payload: unknown;
  created_at: string;
};

const PLAN_FEATURE_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'dashboard', label: 'ダッシュボード' },
  { key: 'create_post', label: '新規投稿' },
  { key: 'post_templates', label: '投稿テンプレート' },
  { key: 'brand_kit', label: 'ブランドキット' },
  { key: 'post_list', label: '投稿一覧' },
  { key: 'calendar', label: 'カレンダー' },
  { key: 'inbox', label: '受信箱' },
  { key: 'survey', label: 'アンケート' },
  { key: 'rank_tracker', label: '検索順位チェック' },
  { key: 'advice', label: '集客アドバイス' },
  { key: 'user_management', label: 'ユーザー管理' },
  { key: 'billing', label: '契約プラン' },
];

const formatAmount = (amount: number, currency: string): string => {
  const value = Number.isFinite(amount) ? amount : 0;
  const code = (currency || 'JPY').toUpperCase();
  if (code === 'JPY') return `¥${Math.round(value).toLocaleString()}`;
  return `${value.toLocaleString()} ${code}`;
};

const normalizePlanCode = (raw: string): string => raw.trim().toUpperCase();

const getSubscriptionStatusLabel = (status: string): string => {
  if (status === 'ACTIVE') return '有効';
  if (status === 'UNSET') return '未設定';
  if (status === 'MOCK') return '検証';
  if (status === 'TRIALING') return '試用中';
  if (status === 'CANCELED') return '停止';
  if (status === 'PAST_DUE') return '要確認';
  return status || '未設定';
};

const BillingView: React.FC<BillingViewProps> = ({ currentUser }) => {
  const { stores, activeStoreId } = useStore();
  const { addNotification } = useNotification();
  const isInternal = currentUser.role === Role.ADMIN || currentUser.role === Role.SUPERVISOR;
  const activeStore = useMemo(() => stores.find((s) => s.id === activeStoreId) || null, [activeStoreId, stores]);

  const [subscriptionPlanCode, setSubscriptionPlanCode] = useState<string>('');
  const [subscriptionPlanName, setSubscriptionPlanName] = useState<string>('');
  const [subscriptionAmountMonthly, setSubscriptionAmountMonthly] = useState<number>(0);
  const [subscriptionCurrency, setSubscriptionCurrency] = useState<string>('JPY');
  const [subscriptionStatus, setSubscriptionStatus] = useState<string>('UNSET');
  const [isSubscriptionMissing, setIsSubscriptionMissing] = useState<boolean>(false);
  const [isLoadingSubscription, setIsLoadingSubscription] = useState<boolean>(false);

  const [billingPlans, setBillingPlans] = useState<BillingPlan[]>([]);
  const [isLoadingPlans, setIsLoadingPlans] = useState(false);

  const [planFormCode, setPlanFormCode] = useState('');
  const [planFormName, setPlanFormName] = useState('');
  const [planFormAmountMonthly, setPlanFormAmountMonthly] = useState<string>('0');
  const [planFormCurrency, setPlanFormCurrency] = useState<string>('JPY');
  const [planFormIsActive, setPlanFormIsActive] = useState<boolean>(true);
  const [planFormDescription, setPlanFormDescription] = useState<string>('');
  const [planFormSnsConnectionLimit, setPlanFormSnsConnectionLimit] = useState<string>('3');
  const [planFormFeatureRules, setPlanFormFeatureRules] = useState<Record<string, boolean>>(
    PLAN_FEATURE_OPTIONS.reduce<Record<string, boolean>>((acc, item) => {
      acc[item.key] = true;
      return acc;
    }, {})
  );
  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const [selectedPlanCodes, setSelectedPlanCodes] = useState<string[]>([]);
  const [isDeletingPlans, setIsDeletingPlans] = useState(false);

  const [storePlanCodeDraft, setStorePlanCodeDraft] = useState<string>('');
  const [storePlanEffectiveAtInput, setStorePlanEffectiveAtInput] = useState<string>('');
  const [isAssigningStorePlan, setIsAssigningStorePlan] = useState(false);
  const [planSchedules, setPlanSchedules] = useState<StorePlanSchedule[]>([]);
  const [isLoadingSchedules, setIsLoadingSchedules] = useState(false);

  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [isLoadingAuditLogs, setIsLoadingAuditLogs] = useState(false);

  const loadSubscription = async () => {
    if (!activeStoreId) {
      setSubscriptionPlanCode('');
      setSubscriptionPlanName('');
      setSubscriptionAmountMonthly(0);
      setSubscriptionCurrency('JPY');
      setSubscriptionStatus('UNSET');
      setIsSubscriptionMissing(true);
      return;
    }

    if (!isSupabaseConfigured) {
      setSubscriptionPlanCode('FREE');
      setSubscriptionPlanName('FREE');
      setSubscriptionAmountMonthly(0);
      setSubscriptionCurrency('JPY');
      setSubscriptionStatus('MOCK');
      setIsSubscriptionMissing(false);
      return;
    }

    setIsLoadingSubscription(true);
    try {
      const subscription = await billingService.getStoreSubscription(activeStoreId);
      const code = subscription?.billingPlan?.code ? String(subscription.billingPlan.code) : '';
      const name = subscription?.billingPlan?.name ? String(subscription.billingPlan.name) : '';
      const currency = subscription?.billingPlan?.currency ? String(subscription.billingPlan.currency) : 'JPY';
      const amount = subscription?.billingPlan?.amountMonthly ?? 0;
      const status = subscription?.status ? String(subscription.status) : '';

      setSubscriptionPlanCode(code);
      setSubscriptionPlanName(name || code);
      setSubscriptionAmountMonthly(Number(amount) || 0);
      setSubscriptionCurrency(currency);
      setSubscriptionStatus(code ? (status || 'ACTIVE') : 'UNSET');
      setIsSubscriptionMissing(!code);
    } catch (error) {
      const message = getErrorMessage(error) || '課金情報の取得に失敗しました。';
      addNotification('課金情報取得エラー', message, 'ERROR');
      setSubscriptionPlanCode('');
      setSubscriptionPlanName('');
      setSubscriptionAmountMonthly(0);
      setSubscriptionCurrency('JPY');
      setSubscriptionStatus('UNSET');
      setIsSubscriptionMissing(true);
    } finally {
      setIsLoadingSubscription(false);
    }
  };

  const loadBillingPlans = async () => {
    if (!isInternal) return;
    if (!isSupabaseConfigured) {
      setBillingPlans([]);
      return;
    }
    setIsLoadingPlans(true);
    try {
      const plans = await billingService.listBillingPlans({ includeInactive: true });
      setBillingPlans(plans);
      const activePlan = plans.find((p) => p.isActive);
      const nextDraft = subscriptionPlanCode || activePlan?.code || '';
      setStorePlanCodeDraft((prev) => prev || nextDraft);
    } catch (error) {
      const message = getErrorMessage(error) || 'プラン一覧の取得に失敗しました。';
      addNotification('プラン取得エラー', message, 'ERROR');
      setBillingPlans([]);
    } finally {
      setIsLoadingPlans(false);
    }
  };

  const loadPlanSchedules = async () => {
    if (!isInternal || !activeStoreId || !isSupabaseConfigured) {
      setPlanSchedules([]);
      return;
    }
    setIsLoadingSchedules(true);
    try {
      const rows = await billingService.listStorePlanSchedules(activeStoreId);
      setPlanSchedules(rows);
    } catch (error) {
      const message = getErrorMessage(error) || '予約切替の取得に失敗しました。';
      addNotification('予約取得エラー', message, 'ERROR');
      setPlanSchedules([]);
    } finally {
      setIsLoadingSchedules(false);
    }
  };

  const loadAuditLogs = async () => {
    if (!isInternal) return;
    if (!isSupabaseConfigured || !supabase) {
      setAuditLogs([]);
      return;
    }

    setIsLoadingAuditLogs(true);
    try {
      const planLogsResult = await supabase
        .from('audit_logs')
        .select('id, org_id, store_id, actor_user_id, action, target_type, target_id, payload, created_at')
        .eq('action', 'BILLING_PLAN_UPSERT')
        .is('org_id', null)
        .order('created_at', { ascending: false })
        .limit(15);

      if (planLogsResult.error) throw planLogsResult.error;
      const planLogs = (planLogsResult.data || []) as AuditLogRow[];

      let storeLogs: AuditLogRow[] = [];
      if (activeStoreId) {
        const storeLogsResult = await supabase
          .from('audit_logs')
          .select('id, org_id, store_id, actor_user_id, action, target_type, target_id, payload, created_at')
          .in('action', ['STORE_SUBSCRIPTION_SET_PLAN', 'STORE_SUBSCRIPTION_SET_PLAN_SCHEDULED'])
          .eq('store_id', activeStoreId)
          .order('created_at', { ascending: false })
          .limit(15);
        if (storeLogsResult.error) throw storeLogsResult.error;
        storeLogs = (storeLogsResult.data || []) as AuditLogRow[];
      }

      const merged = [...planLogs, ...storeLogs].sort((a, b) => {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      setAuditLogs(merged.slice(0, 20));
    } catch (error) {
      const message = getErrorMessage(error) || '監査ログの取得に失敗しました。';
      addNotification('監査ログ取得エラー', message, 'ERROR');
      setAuditLogs([]);
    } finally {
      setIsLoadingAuditLogs(false);
    }
  };

  useEffect(() => {
    void loadSubscription();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStoreId]);

  useEffect(() => {
    if (!isInternal) return;
    void loadBillingPlans();
    void loadPlanSchedules();
    void loadAuditLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInternal, activeStoreId]);

  useEffect(() => {
    const availableCodes = new Set(billingPlans.map((plan) => plan.code.toUpperCase()));
    setSelectedPlanCodes((prev) => prev.filter((code) => availableCodes.has(code.toUpperCase())));
  }, [billingPlans]);

  const statusBadgeClass = useMemo(() => {
    if (subscriptionStatus === 'UNSET') {
      return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300';
    }
    if (subscriptionStatus === 'ACTIVE' || subscriptionStatus === 'MOCK') {
      return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300';
    }
    return 'bg-gray-100 text-gray-700 dark:bg-gray-700/40 dark:text-gray-200';
  }, [subscriptionStatus]);

  const handlePickPlanForEdit = (plan: BillingPlan) => {
    setPlanFormCode(plan.code);
    setPlanFormName(plan.name);
    setPlanFormAmountMonthly(String(plan.amountMonthly));
    setPlanFormCurrency(plan.currency);
    setPlanFormIsActive(plan.isActive);
    setPlanFormDescription(plan.description || '');
    setPlanFormSnsConnectionLimit(String(plan.snsConnectionLimit ?? 3));
    setPlanFormFeatureRules(
      PLAN_FEATURE_OPTIONS.reduce<Record<string, boolean>>((acc, item) => {
        acc[item.key] = plan.featureRules?.[item.key] !== false;
        return acc;
      }, {})
    );
  };

  const resetPlanForm = () => {
    setPlanFormCode('');
    setPlanFormName('');
    setPlanFormAmountMonthly('0');
    setPlanFormCurrency('JPY');
    setPlanFormIsActive(true);
    setPlanFormDescription('');
    setPlanFormSnsConnectionLimit('3');
    setPlanFormFeatureRules(
      PLAN_FEATURE_OPTIONS.reduce<Record<string, boolean>>((acc, item) => {
        acc[item.key] = true;
        return acc;
      }, {})
    );
  };

  const handleSavePlan = async () => {
    const code = normalizePlanCode(planFormCode);
    const name = planFormName.trim();
    const amountMonthly = Number(planFormAmountMonthly);
    const snsConnectionLimit = Number(planFormSnsConnectionLimit);
    const currency = planFormCurrency.trim() || 'JPY';
    const description = planFormDescription.trim();

    if (!code || !name || !Number.isFinite(amountMonthly) || amountMonthly < 0 || !Number.isFinite(snsConnectionLimit) || snsConnectionLimit < 0) {
      addNotification('入力エラー', 'code / name / amountMonthly / SNS連携上限 を確認してください。', 'WARNING');
      return;
    }

    setIsSavingPlan(true);
    try {
      await billingService.upsertBillingPlan({
        code,
        name,
        amountMonthly,
        currency,
        isActive: planFormIsActive,
        description: description || undefined,
        snsConnectionLimit,
        featureRules: planFormFeatureRules,
      });
      addNotification('保存完了', `プラン「${code}」を保存しました。`, 'SUCCESS');
      await loadBillingPlans();
      await loadAuditLogs();
    } catch (error) {
      const message = getErrorMessage(error) || 'プラン保存に失敗しました。';
      addNotification('保存エラー', message, 'ERROR');
    } finally {
      setIsSavingPlan(false);
    }
  };

  const handleAssignStorePlan = async () => {
    if (!activeStoreId) {
      addNotification('店舗未選択', '右上の店舗セレクタから店舗を選択してください。', 'WARNING');
      return;
    }
    const planCode = normalizePlanCode(storePlanCodeDraft);
    if (!planCode) {
      addNotification('入力エラー', '割り当てるプランを選択してください。', 'WARNING');
      return;
    }

    const effectiveAt = storePlanEffectiveAtInput ? new Date(storePlanEffectiveAtInput) : null;
    if (effectiveAt && Number.isNaN(effectiveAt.getTime())) {
      addNotification('入力エラー', '切替日時の形式が不正です。', 'WARNING');
      return;
    }

    setIsAssigningStorePlan(true);
    try {
      await billingService.setStorePlan({
        storeId: activeStoreId,
        planCode,
        effectiveAt: effectiveAt || undefined,
      });
      if (effectiveAt && effectiveAt.getTime() > Date.now()) {
        addNotification('予約切替を登録', `${effectiveAt.toLocaleString()} から「${planCode}」へ切替予定にしました。`, 'SUCCESS');
      } else {
        addNotification('更新完了', `この店舗の契約プランを「${planCode}」へ変更しました。`, 'SUCCESS');
      }
      setStorePlanEffectiveAtInput('');
      await Promise.all([loadSubscription(), loadPlanSchedules(), loadAuditLogs()]);
    } catch (error) {
      const message = getErrorMessage(error) || 'プラン割当の更新に失敗しました。';
      addNotification('更新エラー', message, 'ERROR');
    } finally {
      setIsAssigningStorePlan(false);
    }
  };

  const togglePlanSelection = (planCode: string) => {
    const normalized = normalizePlanCode(planCode);
    setSelectedPlanCodes((prev) => (
      prev.includes(normalized)
        ? prev.filter((code) => code !== normalized)
        : [...prev, normalized]
    ));
  };

  const toggleSelectAllPlans = () => {
    if (billingPlans.length === 0) {
      setSelectedPlanCodes([]);
      return;
    }
    const allCodes = billingPlans.map((plan) => normalizePlanCode(plan.code));
    setSelectedPlanCodes((prev) => (
      prev.length === allCodes.length ? [] : allCodes
    ));
  };

  const handleBulkDeletePlans = async () => {
    if (selectedPlanCodes.length === 0) {
      addNotification('選択エラー', '削除する契約プランを選択してください。', 'WARNING');
      return;
    }
    if (!window.confirm(`選択した ${selectedPlanCodes.length} 件の契約プランを削除しますか？`)) {
      return;
    }

    setIsDeletingPlans(true);
    try {
      const results = await billingService.deleteBillingPlans(selectedPlanCodes);
      const deleted = results.filter((result) => result.deleted);
      const blocked = results.filter((result) => !result.deleted && (result.blockedUserCount > 0 || result.blockedStoreCount > 0));
      const failed = results.filter((result) => !result.deleted && result.blockedUserCount <= 0 && result.blockedStoreCount <= 0);

      if (deleted.length > 0) {
        addNotification('削除完了', `${deleted.length} 件の契約プランを削除しました。`, 'SUCCESS');
      }
      if (blocked.length > 0) {
        const detail = blocked
          .map((result) => `${result.code}: 利用店舗 ${result.blockedStoreCount} 件 / 利用ユーザー ${result.blockedUserCount} 人`)
          .join(' / ');
        addNotification('削除不可', `利用中の店舗またはユーザーがいるため削除できないプランがあります。${detail}`, 'WARNING');
      }
      if (failed.length > 0) {
        const detail = failed
          .map((result) => `${result.code}: ${result.message || '削除に失敗しました。'}`)
          .join(' / ');
        addNotification('削除エラー', detail, 'ERROR');
      }

      setSelectedPlanCodes([]);
      await Promise.all([loadBillingPlans(), loadSubscription(), loadAuditLogs()]);
    } catch (error) {
      const message = getErrorMessage(error) || '契約プランの一括削除に失敗しました。';
      addNotification('削除エラー', message, 'ERROR');
    } finally {
      setIsDeletingPlans(false);
    }
  };

  return (
    <div className={PAGE_CONTAINER_CLASS} data-testid="billing-view-root">
      <section className={PAGE_CARD_PADDED_CLASS}>
        <h1 className={PAGE_HEADER_TITLE_CLASS}>{formatViewLabel('BILLING')}</h1>
        <p className={PAGE_HEADER_DESCRIPTION_CLASS}>
          現在の契約プランを確認できます（請求は当面、別システムで管理）。
        </p>
      </section>

      {!activeStoreId && (
        <div className={PAGE_WARNING_CLASS}>
          店舗が選択されていません。右上の店舗セレクタから選択してください。
        </div>
      )}

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <article
          id="billing-current-plan"
          data-testid="billing-plan-current"
          className={`lg:col-span-2 ${PAGE_CARD_PADDED_CLASS}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-widest text-primary-600 dark:text-primary-400 font-bold">
                現在の契約プラン
              </p>
              <h4 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
                {isLoadingSubscription ? '読み込み中...' : subscriptionPlanCode || '未設定'}
              </h4>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                {isSubscriptionMissing
                  ? '契約プランが未設定です（内部ユーザーのみ割当可能）。'
                  : `${subscriptionPlanName || subscriptionPlanCode} / ${formatAmount(subscriptionAmountMonthly, subscriptionCurrency)} / 月`}
              </p>
            </div>
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${statusBadgeClass}`}
            >
              {getSubscriptionStatusLabel(subscriptionStatus)}
            </span>
          </div>
        </article>

        <article id="billing-payment-note" className={PAGE_CARD_PADDED_CLASS}>
          <p className="text-sm text-gray-500 dark:text-gray-400">請求</p>
          <p className="text-xl font-bold text-gray-900 dark:text-gray-100 mt-2">別システム管理</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            請求・入金管理は当面、システム外で行います。
          </p>
          <button
            type="button"
            data-testid="invoice-download"
            disabled
            className="mt-5 w-full rounded-xl bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-300 font-semibold py-2.5 cursor-not-allowed"
            title="将来対応"
          >
            請求書ダウンロード（将来対応）
          </button>
        </article>
      </section>

      {isInternal && (
        <section id="billing-admin-section" className={`${PAGE_CARD_PADDED_CLASS} space-y-5`}>
          <div>
            <h4 className="text-lg font-bold text-gray-900 dark:text-gray-100">内部: 契約プラン管理</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              プラン作成/更新、店舗への割当、直近の操作履歴を確認できます。
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div id="billing-plan-list" className="border border-gray-100 dark:border-gray-700 rounded-2xl p-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h5 className="text-sm font-bold text-gray-900 dark:text-gray-100">プラン一覧</h5>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleSelectAllPlans}
                    className="px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg"
                  >
                    {selectedPlanCodes.length === billingPlans.length && billingPlans.length > 0 ? '選択解除' : 'すべて選択'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleBulkDeletePlans()}
                    disabled={selectedPlanCodes.length === 0 || isDeletingPlans}
                    className="px-2.5 py-1.5 text-xs font-medium text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isDeletingPlans ? '削除中...' : `選択削除 (${selectedPlanCodes.length})`}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                {isLoadingPlans && (
                  <div className="text-sm text-gray-500 dark:text-gray-400">読み込み中...</div>
                )}
                {!isLoadingPlans && billingPlans.length === 0 && (
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    プランがありません（Phase4 migration未適用の可能性）。
                  </div>
                )}
                {billingPlans.map((plan) => (
                  <div
                    key={plan.id}
                    className="w-full text-left rounded-xl border border-gray-100 dark:border-gray-700 p-3 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex items-start gap-3 w-full">
                        <input
                          type="checkbox"
                          checked={selectedPlanCodes.includes(normalizePlanCode(plan.code))}
                          onChange={() => togglePlanSelection(plan.code)}
                          className="mt-1 h-4 w-4"
                        />
                        <button type="button" onClick={() => handlePickPlanForEdit(plan)} className="text-left min-w-0 w-full">
                          <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
                            {plan.code}
                            {!plan.isActive && (
                              <span className="ml-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                                停止中
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {plan.name} / {formatAmount(plan.amountMonthly, plan.currency)} / 月 / SNS上限: {plan.snsConnectionLimit}
                          </div>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div id="billing-plan-form" className="border border-gray-100 dark:border-gray-700 rounded-2xl p-4">
              <h5 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3">プラン作成/更新</h5>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                    プランコード
                  </label>
                  <input
                    value={planFormCode}
                    onChange={(e) => setPlanFormCode(e.target.value)}
                    className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                    placeholder="例: FREE"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                    プラン名
                  </label>
                  <input
                    value={planFormName}
                    onChange={(e) => setPlanFormName(e.target.value)}
                    className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                    placeholder="例: Free"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                    月額
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={planFormAmountMonthly}
                    onChange={(e) => setPlanFormAmountMonthly(e.target.value)}
                    className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                    通貨
                  </label>
                  <select
                    value={planFormCurrency}
                    onChange={(e) => setPlanFormCurrency(e.target.value)}
                    className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                  >
                    <option value="JPY">JPY</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                    SNS連携可能本数（1店舗あたり）
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={planFormSnsConnectionLimit}
                    onChange={(e) => setPlanFormSnsConnectionLimit(e.target.value)}
                    className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                  />
                </div>
                <div className="col-span-2">
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={planFormIsActive}
                      onChange={(e) => setPlanFormIsActive(e.target.checked)}
                      className="h-4 w-4"
                    />
                    有効（inactiveは店舗割当不可）
                  </label>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                    説明（任意）
                  </label>
                  <input
                    value={planFormDescription}
                    onChange={(e) => setPlanFormDescription(e.target.value)}
                    className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                    placeholder="説明（任意）"
                  />
                </div>
                <div className="col-span-2">
                  <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">
                    機能ON/OFF（全体公開機能のみ）
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {PLAN_FEATURE_OPTIONS.map((feature) => (
                      <label
                        key={feature.key}
                        className="inline-flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-2"
                      >
                        <input
                          type="checkbox"
                          checked={planFormFeatureRules[feature.key] !== false}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setPlanFormFeatureRules((prev) => ({
                              ...prev,
                              [feature.key]: checked,
                            }));
                          }}
                          className="h-4 w-4"
                        />
                        {feature.label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  type="button"
                  onClick={resetPlanForm}
                  className="px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  クリア
                </button>
                <button
                  type="button"
                  onClick={() => void handleSavePlan()}
                  disabled={isSavingPlan}
                  className="px-4 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-xl disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSavingPlan ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>

          <div id="billing-store-assignment" className="border border-gray-100 dark:border-gray-700 rounded-2xl p-4">
            <h5 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3">店舗へのプラン割当</h5>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">割当プラン</label>
                <select
                  value={storePlanCodeDraft}
                  onChange={(e) => setStorePlanCodeDraft(e.target.value)}
                  className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                  disabled={billingPlans.length === 0}
                >
                  <option value="">選択してください</option>
                  {billingPlans
                    .filter((p) => p.isActive)
                    .map((plan) => (
                      <option key={plan.id} value={plan.code}>
                        {plan.code} ({formatAmount(plan.amountMonthly, plan.currency)}/月)
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                  反映日時（空欄なら即時）
                </label>
                <input
                  type="datetime-local"
                  value={storePlanEffectiveAtInput}
                  onChange={(e) => setStorePlanEffectiveAtInput(e.target.value)}
                  className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                />
              </div>
            </div>
            <div className="flex flex-col md:flex-row md:items-center gap-3 mt-3">
              <button
                type="button"
                onClick={() => void handleAssignStorePlan()}
                disabled={isAssigningStorePlan || !activeStoreId}
                className="px-4 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-xl disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isAssigningStorePlan ? '更新中...' : (storePlanEffectiveAtInput ? '予約切替を登録' : 'この店舗に割当')}
              </button>
              {activeStoreId && (
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {activeStore ? `対象店舗: ${activeStore.name}` : ''}
                </div>
              )}
            </div>
            <div className="mt-4 border-t border-gray-100 dark:border-gray-700 pt-3">
              <h6 className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">予約切替一覧</h6>
              {isLoadingSchedules ? (
                <p className="text-xs text-gray-500 dark:text-gray-400">読み込み中...</p>
              ) : planSchedules.length === 0 ? (
                <p className="text-xs text-gray-500 dark:text-gray-400">予約切替はありません。</p>
              ) : (
                <div className="space-y-2">
                  {planSchedules
                    .filter((schedule) => schedule.status === 'SCHEDULED')
                    .map((schedule) => (
                      <div
                        key={schedule.id}
                        className="text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 flex flex-col md:flex-row md:items-center md:justify-between gap-1"
                      >
                        <span className="font-semibold text-gray-800 dark:text-gray-100">
                          {schedule.billingPlan?.code || schedule.billingPlanId}
                        </span>
                        <span className="text-gray-500 dark:text-gray-400">
                          {schedule.effectiveAt.toLocaleString()} から有効
                        </span>
                      </div>
                    ))}
                  {planSchedules.filter((schedule) => schedule.status === 'SCHEDULED').length === 0 && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">予約中の切替はありません。</p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div id="billing-audit-logs" className="border border-gray-100 dark:border-gray-700 rounded-2xl p-4">
            <h5 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3">直近の操作履歴</h5>
            {isLoadingAuditLogs ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">読み込み中...</div>
            ) : auditLogs.length === 0 ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">履歴がありません。</div>
            ) : (
              <div className="space-y-2">
                {auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-xl border border-gray-100 dark:border-gray-700 p-3 text-sm text-gray-700 dark:text-gray-200"
                  >
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                      <div className="font-semibold">
                        {log.action}
                        {log.target_id ? ` / ${log.target_id}` : ''}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {new Date(log.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      group_id: {log.org_id || '-'} / store_id: {log.store_id || '-'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      <section className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-6">
        <h4 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">PWA</h4>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          ホーム画面に追加すると、アプリのようにすぐ起動できます。
        </p>
        <button
          type="button"
          data-testid="pwa-install-button"
          className="rounded-xl bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 px-4 py-2.5 text-sm font-semibold"
        >
          ホーム画面に追加
        </button>
      </section>
    </div>
  );
};

export { BillingView };
