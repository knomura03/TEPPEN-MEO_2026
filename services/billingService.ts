import { BillingPlan, OrgSubscription } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';

type DbBillingPlanRow = {
  id: string;
  code: string;
  name: string;
  amount_monthly: number;
  currency: string;
  is_active: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
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

type FunctionInvokeResult = {
  ok: boolean;
  status: number;
  body: unknown;
  text: string;
};

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、課金プラン機能を利用できません。');
  }
  return supabase;
};

const isMissingRelationError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const maybeCode = 'code' in error ? String((error as { code?: string }).code || '') : '';
  const maybeMessage = 'message' in error ? String((error as { message?: string }).message || '') : '';
  return maybeCode === '42P01' || maybeMessage.includes('does not exist');
};

const requireFunctionRequestContext = async (client: ReturnType<typeof requireSupabase>) => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase環境変数が不足しています。VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を確認してください。');
  }

  const { data, error } = await client.auth.getSession();
  if (error) {
    throw new Error(`ログインセッションの取得に失敗しました。（${error.message}）`);
  }
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new Error('ログインセッションが無効です。いったんログアウトして再ログインしてください。');
  }

  return { supabaseUrl, anonKey, accessToken };
};

const invokeFunctionByHttp = async (
  client: ReturnType<typeof requireSupabase>,
  functionName: string,
  payload: Record<string, unknown>
): Promise<FunctionInvokeResult> => {
  const { supabaseUrl, anonKey, accessToken } = await requireFunctionRequestContext(client);
  const requestUrl = `${supabaseUrl}/functions/v1/${functionName}?client=direct-http-v3`;
  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body, text };
};

const mapBillingPlan = (row: DbBillingPlanRow): BillingPlan => ({
  id: row.id,
  code: row.code,
  name: row.name,
  amountMonthly: Number(row.amount_monthly || 0),
  currency: row.currency || 'JPY',
  isActive: Boolean(row.is_active),
  description: row.description || undefined,
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

export const billingService = {
  async listBillingPlans(params?: { includeInactive?: boolean }): Promise<BillingPlan[]> {
    const client = requireSupabase();
    const includeInactive = params?.includeInactive ?? true;
    const query = client
      .from('billing_plans')
      .select('id, code, name, amount_monthly, currency, is_active, description, created_at, updated_at')
      .order('amount_monthly', { ascending: true })
      .order('code', { ascending: true });
    if (!includeInactive) {
      query.eq('is_active', true);
    }
    const { data, error } = await query;
    if (error) {
      if (isMissingRelationError(error)) {
        throw new Error('課金プラン基盤（Phase4 migration）が未適用です。先に `202602060020_p4_billing_pwa_foundation.sql` を適用してください。');
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
        'id, org_id, billing_plan_id, status, current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at, billing_plan:billing_plans (id, code, name, amount_monthly, currency, is_active, description, created_at, updated_at)'
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
    return mapOrgSubscription(data as DbOrgSubscriptionRow);
  },

  async setOrgPlan(params: { orgId: string; planCode: string }): Promise<void> {
    const client = requireSupabase();
    const invoke = await invokeFunctionByHttp(client, 'admin-org-subscription-set-plan', {
      orgId: params.orgId,
      planCode: params.planCode,
    });
    if (!invoke.ok) {
      const message =
        (invoke.body && typeof invoke.body === 'object' && (invoke.body as any).error) ||
        invoke.text ||
        `status=${invoke.status}`;
      throw new Error(`プラン変更に失敗しました。（${String(message)} / status=${invoke.status}）`);
    }
  },

  async upsertBillingPlan(params: {
    code: string;
    name: string;
    amountMonthly: number;
    currency?: string;
    isActive?: boolean;
    description?: string;
  }): Promise<void> {
    const client = requireSupabase();
    const invoke = await invokeFunctionByHttp(client, 'admin-billing-plan-upsert', {
      code: params.code,
      name: params.name,
      amountMonthly: params.amountMonthly,
      currency: params.currency || 'JPY',
      isActive: params.isActive ?? true,
      description: params.description || null,
    });
    if (!invoke.ok) {
      const message =
        (invoke.body && typeof invoke.body === 'object' && (invoke.body as any).error) ||
        invoke.text ||
        `status=${invoke.status}`;
      throw new Error(`プラン保存に失敗しました。（${String(message)} / status=${invoke.status}）`);
    }
  },
};
