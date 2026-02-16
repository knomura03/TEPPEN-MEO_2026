import { BillingPlan, OrgPlanSchedule, OrgSubscription, StorePlanSchedule, StoreSubscription } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import { migrationRequiredMessage } from './migrationRequiredMessage';
import { getFunctionErrorMessage, invokeFunctionByHttp } from './functionHttpClient';

type DbBillingPlanRow = {
  id: string;
  code: string;
  name: string;
  amount_monthly: number;
  currency: string;
  is_active: boolean;
  description: string | null;
  feature_rules?: Record<string, unknown> | null;
  sns_connection_limit?: number | null;
  created_at: string;
  updated_at: string;
};

type DbOrgPlanScheduleRow = {
  id: string;
  org_id: string;
  billing_plan_id: string;
  status: 'SCHEDULED' | 'APPLIED' | 'CANCELED';
  effective_at: string;
  applied_at: string | null;
  canceled_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  billing_plan?: DbBillingPlanRow | DbBillingPlanRow[] | null;
};

type DbStorePlanScheduleRow = {
  id: string;
  store_id: string;
  billing_plan_id: string;
  status: 'SCHEDULED' | 'APPLIED' | 'CANCELED';
  effective_at: string;
  applied_at: string | null;
  canceled_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  billing_plan?: DbBillingPlanRow | DbBillingPlanRow[] | null;
};

type DbOrgSubscriptionRow = {
  id: string;
  org_id: string;
  billing_plan_id: string | null;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
  // PostgREST embed may come back as an object or a single-item array depending on relationship inference.
  billing_plan?: DbBillingPlanRow | DbBillingPlanRow[] | null;
};

type DbStoreSubscriptionRow = {
  id: string;
  store_id: string;
  billing_plan_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  billing_plan?: DbBillingPlanRow | DbBillingPlanRow[] | null;
};

export type BillingPlanDeleteResult = {
  code: string;
  deleted: boolean;
  blockedUserCount: number;
  blockedStoreCount: number;
  message?: string;
};

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、契約プラン機能を利用できません。');
  }
  return supabase;
};

const isMissingRelationError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const maybeCode = 'code' in error ? String((error as { code?: string }).code || '') : '';
  const maybeMessage = 'message' in error ? String((error as { message?: string }).message || '') : '';
  return maybeCode === '42P01' || maybeMessage.includes('does not exist');
};

const mapBillingPlan = (row: DbBillingPlanRow): BillingPlan => ({
  id: row.id,
  code: row.code,
  name: row.name,
  amountMonthly: Number(row.amount_monthly || 0),
  currency: row.currency || 'JPY',
  isActive: Boolean(row.is_active),
  description: row.description || undefined,
  featureRules:
    row.feature_rules && typeof row.feature_rules === 'object'
      ? Object.entries(row.feature_rules).reduce<Record<string, boolean>>((acc, [key, value]) => {
          acc[key] = Boolean(value);
          return acc;
        }, {})
      : {},
  snsConnectionLimit: Math.max(0, Number(row.sns_connection_limit ?? 3)),
  createdAt: row.created_at ? new Date(row.created_at) : new Date(),
  updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
});

const mapOrgPlanSchedule = (row: DbOrgPlanScheduleRow): OrgPlanSchedule => ({
  id: row.id,
  orgId: row.org_id,
  billingPlanId: row.billing_plan_id,
  billingPlan: (() => {
    const embedded = resolveEmbeddedBillingPlan(row.billing_plan as DbOrgSubscriptionRow['billing_plan']);
    return embedded ? mapBillingPlan(embedded) : null;
  })(),
  status: row.status,
  effectiveAt: row.effective_at ? new Date(row.effective_at) : new Date(),
  appliedAt: row.applied_at ? new Date(row.applied_at) : undefined,
  canceledAt: row.canceled_at ? new Date(row.canceled_at) : undefined,
  note: row.note || undefined,
  createdAt: row.created_at ? new Date(row.created_at) : new Date(),
  updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
});

const mapStorePlanSchedule = (row: DbStorePlanScheduleRow): StorePlanSchedule => ({
  id: row.id,
  storeId: row.store_id,
  billingPlanId: row.billing_plan_id,
  billingPlan: (() => {
    const embedded = resolveEmbeddedBillingPlan(row.billing_plan as DbOrgSubscriptionRow['billing_plan']);
    return embedded ? mapBillingPlan(embedded) : null;
  })(),
  status: row.status,
  effectiveAt: row.effective_at ? new Date(row.effective_at) : new Date(),
  appliedAt: row.applied_at ? new Date(row.applied_at) : undefined,
  canceledAt: row.canceled_at ? new Date(row.canceled_at) : undefined,
  note: row.note || undefined,
  createdAt: row.created_at ? new Date(row.created_at) : new Date(),
  updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
});

const resolveEmbeddedBillingPlan = (value: DbOrgSubscriptionRow['billing_plan']): DbBillingPlanRow | null => {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] || null;
  return value;
};

const mapOrgSubscription = (row: DbOrgSubscriptionRow): OrgSubscription => ({
  id: row.id,
  orgId: row.org_id,
  billingPlanId: row.billing_plan_id,
  billingPlan: (() => {
    const embedded = resolveEmbeddedBillingPlan(row.billing_plan);
    return embedded ? mapBillingPlan(embedded) : null;
  })(),
  status: row.status,
  currentPeriodStart: row.current_period_start ? new Date(row.current_period_start) : undefined,
  currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end) : undefined,
  cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
  createdAt: row.created_at ? new Date(row.created_at) : new Date(),
  updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
});

const mapStoreSubscription = (row: DbStoreSubscriptionRow): StoreSubscription => ({
  id: row.id,
  storeId: row.store_id,
  billingPlanId: row.billing_plan_id,
  billingPlan: (() => {
    const embedded = resolveEmbeddedBillingPlan(row.billing_plan as DbOrgSubscriptionRow['billing_plan']);
    return embedded ? mapBillingPlan(embedded) : null;
  })(),
  status: row.status,
  createdAt: row.created_at ? new Date(row.created_at) : new Date(),
  updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
});

export const billingService = {
  async listBillingPlans(params?: { includeInactive?: boolean }): Promise<BillingPlan[]> {
    const client = requireSupabase();
    const includeInactive = params?.includeInactive ?? true;
    const query = client
      .from('billing_plans')
      .select('id, code, name, amount_monthly, currency, is_active, description, feature_rules, sns_connection_limit, created_at, updated_at')
      .order('amount_monthly', { ascending: true })
      .order('code', { ascending: true });
    if (!includeInactive) {
      query.eq('is_active', true);
    }
    const { data, error } = await query;
    if (error) {
      if (isMissingRelationError(error)) {
        throw new Error(migrationRequiredMessage('契約プラン'));
      }
      throw error;
    }
    return ((data || []) as DbBillingPlanRow[]).map(mapBillingPlan);
  },

  async getOrgSubscription(orgId: string): Promise<OrgSubscription | null> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('org_subscriptions')
      .select(
        'id, org_id, billing_plan_id, status, current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at, billing_plan:billing_plans (id, code, name, amount_monthly, currency, is_active, description, feature_rules, sns_connection_limit, created_at, updated_at)'
      )
      .eq('org_id', orgId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (isMissingRelationError(error)) return null;
      throw error;
    }
    if (!data) return null;
    const mapped = mapOrgSubscription(data as DbOrgSubscriptionRow);

    const { data: dueSchedule, error: scheduleError } = await client
      .from('org_subscription_plan_schedules')
      .select('id, org_id, billing_plan_id, status, effective_at, applied_at, canceled_at, note, created_at, updated_at, billing_plan:billing_plans (id, code, name, amount_monthly, currency, is_active, description, feature_rules, sns_connection_limit, created_at, updated_at)')
      .eq('org_id', orgId)
      .eq('status', 'SCHEDULED')
      .lte('effective_at', new Date().toISOString())
      .order('effective_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (scheduleError && !isMissingRelationError(scheduleError)) {
      throw scheduleError;
    }
    if (dueSchedule) {
      const schedule = mapOrgPlanSchedule(dueSchedule as DbOrgPlanScheduleRow);
      if (schedule.billingPlan) {
        mapped.billingPlanId = schedule.billingPlan.id;
        mapped.billingPlan = schedule.billingPlan;
        mapped.status = 'ACTIVE';
      }
    }
    return mapped;
  },

  async setOrgPlan(params: { orgId: string; planCode: string; effectiveAt?: Date }): Promise<void> {
    const invoke = await invokeFunctionByHttp('admin-org-subscription-set-plan', {
      orgId: params.orgId,
      planCode: params.planCode,
      effectiveAt: params.effectiveAt ? params.effectiveAt.toISOString() : null,
    });
    if (!invoke.ok) {
      throw new Error(getFunctionErrorMessage(invoke, 'プラン変更に失敗しました。'));
    }
  },

  async getStoreSubscription(storeId: string): Promise<StoreSubscription | null> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('store_subscriptions')
      .select(
        'id, store_id, billing_plan_id, status, created_at, updated_at, billing_plan:billing_plans (id, code, name, amount_monthly, currency, is_active, description, feature_rules, sns_connection_limit, created_at, updated_at)'
      )
      .eq('store_id', storeId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (isMissingRelationError(error)) return null;
      throw error;
    }
    if (!data) return null;
    const mapped = mapStoreSubscription(data as DbStoreSubscriptionRow);

    const { data: dueSchedule, error: scheduleError } = await client
      .from('store_subscription_plan_schedules')
      .select('id, store_id, billing_plan_id, status, effective_at, applied_at, canceled_at, note, created_at, updated_at, billing_plan:billing_plans (id, code, name, amount_monthly, currency, is_active, description, feature_rules, sns_connection_limit, created_at, updated_at)')
      .eq('store_id', storeId)
      .eq('status', 'SCHEDULED')
      .lte('effective_at', new Date().toISOString())
      .order('effective_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (scheduleError && !isMissingRelationError(scheduleError)) {
      throw scheduleError;
    }
    if (dueSchedule) {
      const schedule = mapStorePlanSchedule(dueSchedule as DbStorePlanScheduleRow);
      if (schedule.billingPlan) {
        mapped.billingPlanId = schedule.billingPlan.id;
        mapped.billingPlan = schedule.billingPlan;
        mapped.status = 'ACTIVE';
      }
    }
    return mapped;
  },

  async setStorePlan(params: { storeId: string; planCode: string; effectiveAt?: Date }): Promise<void> {
    const invoke = await invokeFunctionByHttp('admin-store-subscription-set-plan', {
      storeId: params.storeId,
      planCode: params.planCode,
      effectiveAt: params.effectiveAt ? params.effectiveAt.toISOString() : null,
    });
    if (!invoke.ok) {
      throw new Error(getFunctionErrorMessage(invoke, '店舗プランの更新に失敗しました。'));
    }
  },

  async listStorePlanSchedules(storeId: string): Promise<StorePlanSchedule[]> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('store_subscription_plan_schedules')
      .select('id, store_id, billing_plan_id, status, effective_at, applied_at, canceled_at, note, created_at, updated_at, billing_plan:billing_plans (id, code, name, amount_monthly, currency, is_active, description, feature_rules, sns_connection_limit, created_at, updated_at)')
      .eq('store_id', storeId)
      .order('effective_at', { ascending: true });
    if (error) {
      if (isMissingRelationError(error)) return [];
      throw error;
    }
    return ((data || []) as DbStorePlanScheduleRow[]).map(mapStorePlanSchedule);
  },

  async upsertBillingPlan(params: {
    code: string;
    name: string;
    amountMonthly: number;
    currency?: string;
    isActive?: boolean;
    description?: string;
    featureRules?: Record<string, boolean>;
    snsConnectionLimit?: number;
  }): Promise<void> {
    const client = requireSupabase();
    const invoke = await invokeFunctionByHttp('admin-billing-plan-upsert', {
      code: params.code,
      name: params.name,
      amountMonthly: params.amountMonthly,
      currency: params.currency || 'JPY',
      isActive: params.isActive ?? true,
      description: params.description || null,
      featureRules: params.featureRules || {},
      snsConnectionLimit: Number.isFinite(params.snsConnectionLimit) ? Math.max(0, Number(params.snsConnectionLimit)) : 3,
    });
    if (!invoke.ok) {
      throw new Error(getFunctionErrorMessage(invoke, 'プラン保存に失敗しました。'));
    }
  },

  async listOrgPlanSchedules(orgId: string): Promise<OrgPlanSchedule[]> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('org_subscription_plan_schedules')
      .select('id, org_id, billing_plan_id, status, effective_at, applied_at, canceled_at, note, created_at, updated_at, billing_plan:billing_plans (id, code, name, amount_monthly, currency, is_active, description, feature_rules, sns_connection_limit, created_at, updated_at)')
      .eq('org_id', orgId)
      .order('effective_at', { ascending: true });
    if (error) {
      if (isMissingRelationError(error)) return [];
      throw error;
    }
    return ((data || []) as DbOrgPlanScheduleRow[]).map(mapOrgPlanSchedule);
  },

  async deleteBillingPlans(planCodes: string[]): Promise<BillingPlanDeleteResult[]> {
    const uniqueCodes = Array.from(new Set(planCodes.map((code) => code.trim().toUpperCase()).filter((code) => code.length > 0)));
    if (uniqueCodes.length === 0) return [];

    const invoke = await invokeFunctionByHttp('admin-billing-plan-delete', {
      planCodes: uniqueCodes,
    });
    if (!invoke.ok) {
      throw new Error(getFunctionErrorMessage(invoke, 'プラン削除に失敗しました。'));
    }

    const body = invoke.body && typeof invoke.body === 'object' ? (invoke.body as Record<string, unknown>) : {};
    const rawResults = Array.isArray(body.results) ? body.results : [];
    return rawResults.map((row) => {
      const typed = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
      return {
        code: String(typed.code || '').trim().toUpperCase(),
        deleted: Boolean(typed.deleted),
        blockedUserCount: Number(typed.blockedUserCount || 0),
        blockedStoreCount: Number(typed.blockedStoreCount || 0),
        message: typeof typed.message === 'string' ? typed.message : undefined,
      } satisfies BillingPlanDeleteResult;
    }).filter((item) => item.code.length > 0);
  },
};
