import React, { useEffect, useMemo, useState } from 'react';
import { BillingPlan, Role, User } from '../types';
import { useStore } from '../contexts/StoreContext';
import { useNotification } from '../contexts/NotificationContext';
import { billingService } from '../services/billingService';
import { getErrorMessage } from '../services/errorMessage';
import { isSupabaseConfigured, supabase } from '../services/supabaseClient';
import { PAGE_CARD_PADDED_CLASS, PAGE_CONTAINER_CLASS, PAGE_HEADER_DESCRIPTION_CLASS, PAGE_HEADER_TITLE_CLASS, PAGE_WARNING_CLASS } from './ui/pageLayout';

type BillingViewProps = {
  currentUser: User;
};

type AuditLogRow = {
  id: string;
  org_id: string | null;
  actor_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  payload: unknown;
  created_at: string;
};

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

  const activeOrgId = useMemo(() => {
    if (!activeStoreId) return null;
    const store = stores.find((s) => s.id === activeStoreId);
    return store?.orgId || null;
  }, [activeStoreId, stores]);

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
  const [isSavingPlan, setIsSavingPlan] = useState(false);

  const [orgPlanCodeDraft, setOrgPlanCodeDraft] = useState<string>('');
  const [isAssigningOrgPlan, setIsAssigningOrgPlan] = useState(false);

  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [isLoadingAuditLogs, setIsLoadingAuditLogs] = useState(false);

  const loadSubscription = async () => {
    if (!activeOrgId) {
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
      const subscription = await billingService.getOrgSubscription(activeOrgId);
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
      setOrgPlanCodeDraft((prev) => prev || nextDraft);
    } catch (error) {
      const message = getErrorMessage(error) || 'プラン一覧の取得に失敗しました。';
      addNotification('プラン取得エラー', message, 'ERROR');
      setBillingPlans([]);
    } finally {
      setIsLoadingPlans(false);
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
        .select('id, org_id, actor_user_id, action, target_type, target_id, payload, created_at')
        .eq('action', 'BILLING_PLAN_UPSERT')
        .is('org_id', null)
        .order('created_at', { ascending: false })
        .limit(15);

      if (planLogsResult.error) throw planLogsResult.error;
      const planLogs = (planLogsResult.data || []) as AuditLogRow[];

      let orgLogs: AuditLogRow[] = [];
      if (activeOrgId) {
        const orgLogsResult = await supabase
          .from('audit_logs')
          .select('id, org_id, actor_user_id, action, target_type, target_id, payload, created_at')
          .eq('action', 'ORG_SUBSCRIPTION_SET_PLAN')
          .eq('org_id', activeOrgId)
          .order('created_at', { ascending: false })
          .limit(15);
        if (orgLogsResult.error) throw orgLogsResult.error;
        orgLogs = (orgLogsResult.data || []) as AuditLogRow[];
      }

      const merged = [...planLogs, ...orgLogs].sort((a, b) => {
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
  }, [activeOrgId]);

  useEffect(() => {
    if (!isInternal) return;
    void loadBillingPlans();
    void loadAuditLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInternal, activeOrgId]);

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
  };

  const resetPlanForm = () => {
    setPlanFormCode('');
    setPlanFormName('');
    setPlanFormAmountMonthly('0');
    setPlanFormCurrency('JPY');
    setPlanFormIsActive(true);
    setPlanFormDescription('');
  };

  const handleSavePlan = async () => {
    const code = normalizePlanCode(planFormCode);
    const name = planFormName.trim();
    const amountMonthly = Number(planFormAmountMonthly);
    const currency = planFormCurrency.trim() || 'JPY';
    const description = planFormDescription.trim();

    if (!code || !name || !Number.isFinite(amountMonthly) || amountMonthly < 0) {
      addNotification('入力エラー', 'code / name / amountMonthly を確認してください。', 'WARNING');
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

  const handleAssignOrgPlan = async () => {
    if (!activeOrgId) {
      addNotification('店舗未選択', '右上の店舗セレクタから店舗を選択してください。', 'WARNING');
      return;
    }
    const planCode = normalizePlanCode(orgPlanCodeDraft);
    if (!planCode) {
      addNotification('入力エラー', '割り当てるプランを選択してください。', 'WARNING');
      return;
    }

    setIsAssigningOrgPlan(true);
    try {
      await billingService.setOrgPlan({ orgId: activeOrgId, planCode });
      addNotification('更新完了', `このORGの契約プランを「${planCode}」へ変更しました。`, 'SUCCESS');
      await loadSubscription();
      await loadAuditLogs();
    } catch (error) {
      const message = getErrorMessage(error) || 'プラン割当の更新に失敗しました。';
      addNotification('更新エラー', message, 'ERROR');
    } finally {
      setIsAssigningOrgPlan(false);
    }
  };

  return (
    <div className={PAGE_CONTAINER_CLASS} data-testid="billing-view-root">
      <section className={PAGE_CARD_PADDED_CLASS}>
        <h1 className={PAGE_HEADER_TITLE_CLASS}>契約プラン</h1>
        <p className={PAGE_HEADER_DESCRIPTION_CLASS}>
          現在の契約プランを確認できます（請求は当面、別システムで管理）。
        </p>
      </section>

      {!activeOrgId && (
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
              プラン作成/更新、ORGへの割当、直近の操作履歴を確認できます。
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div id="billing-plan-list" className="border border-gray-100 dark:border-gray-700 rounded-2xl p-4">
              <h5 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3">プラン一覧</h5>
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
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => handlePickPlanForEdit(plan)}
                    className="w-full text-left rounded-xl border border-gray-100 dark:border-gray-700 p-3 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
                          {plan.code}
                          {!plan.isActive && (
                            <span className="ml-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                              停止中
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {plan.name} / {formatAmount(plan.amountMonthly, plan.currency)} / 月
                        </div>
                      </div>
                      <div className="text-xs text-gray-400 whitespace-nowrap">
                        編集
                      </div>
                    </div>
                  </button>
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
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={planFormIsActive}
                      onChange={(e) => setPlanFormIsActive(e.target.checked)}
                      className="h-4 w-4"
                    />
                    有効（inactiveはORG割当不可）
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

          <div id="billing-org-assignment" className="border border-gray-100 dark:border-gray-700 rounded-2xl p-4">
            <h5 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3">ORGへのプラン割当</h5>
            <div className="flex flex-col md:flex-row md:items-center gap-3">
              <select
                value={orgPlanCodeDraft}
                onChange={(e) => setOrgPlanCodeDraft(e.target.value)}
                className="w-full md:w-auto p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
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
              <button
                type="button"
                onClick={() => void handleAssignOrgPlan()}
                disabled={isAssigningOrgPlan || !activeOrgId}
                className="px-4 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-xl disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isAssigningOrgPlan ? '更新中...' : 'このORGに割当'}
              </button>
              {activeOrgId && (
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {subscriptionPlanCode
                    ? `現在: ${subscriptionPlanCode}（未設定の招待は不要）`
                    : 'プラン未設定: 最初の顧客ユーザー招待時にplanCodeが必須です'}
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
                      org_id: {log.org_id || '-'}
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
