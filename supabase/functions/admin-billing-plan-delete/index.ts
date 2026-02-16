import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const jsonResponse = (status: number, body: Record<string, unknown>) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
};

const extractBearerToken = (headerValue: string | null): string => {
  if (!headerValue) return '';
  const matched = headerValue.match(/Bearer\s+([^,\s]+)/i);
  if (matched?.[1]) {
    return matched[1].trim();
  }
  return headerValue.trim();
};

const resolveAuthenticatedUserId = async (
  req: Request,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<{ userId: string | null; error: string | null }> => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || authHeader.trim().length === 0) {
    return { userId: null, error: 'Missing auth token' };
  }
  const token = extractBearerToken(authHeader);
  if (!token) {
    return { userId: null, error: 'Missing auth token' };
  }

  const authClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data?.user?.id) {
    return { userId: null, error: error?.message || 'Invalid auth token' };
  }
  return { userId: data.user.id, error: null };
};

const normalizePlanCodes = (input: unknown): string[] => {
  if (!Array.isArray(input)) return [];
  const unique = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const normalized = raw.trim().toUpperCase();
    if (!normalized) continue;
    if (!/^[A-Z0-9_]+$/.test(normalized)) continue;
    unique.add(normalized);
  }
  return Array.from(unique);
};

type BillingPlanRow = {
  id: string;
  code: string;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { error: 'Missing Supabase env vars' });
  }

  const authResult = await resolveAuthenticatedUserId(req, supabaseUrl, serviceRoleKey);
  if (!authResult.userId) {
    return jsonResponse(401, { error: authResult.error || 'Invalid auth token' });
  }
  const actorUserId = authResult.userId;

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: actorMemberships, error: actorMembershipError } = await supabaseAdmin
    .from('memberships')
    .select('role')
    .eq('user_id', actorUserId);
  if (actorMembershipError || !actorMemberships || actorMemberships.length === 0) {
    return jsonResponse(403, { error: 'Not allowed' });
  }

  const isPrivileged = actorMemberships.some((row: { role: string }) => {
    const role = String(row.role || '').toUpperCase();
    return role === 'ADMIN' || role === 'SUPERVISOR';
  });
  if (!isPrivileged) {
    return jsonResponse(403, { error: 'Only ADMIN/SUPERVISOR can delete billing plans' });
  }

  let payload: { planCodes?: unknown };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const planCodes = normalizePlanCodes(payload.planCodes);
  if (planCodes.length === 0) {
    return jsonResponse(400, { error: 'planCodes is required' });
  }

  const { data: plans, error: plansError } = await supabaseAdmin
    .from('billing_plans')
    .select('id, code')
    .in('code', planCodes);
  if (plansError) {
    return jsonResponse(400, { error: plansError.message });
  }

  const planMap = new Map<string, BillingPlanRow>();
  (plans || []).forEach((row) => {
    const typed = row as BillingPlanRow;
    planMap.set(String(typed.code || '').toUpperCase(), typed);
  });

  const results: Array<{ code: string; deleted: boolean; blockedUserCount: number; blockedStoreCount: number; message?: string }> = [];

  for (const code of planCodes) {
    const plan = planMap.get(code);
    if (!plan?.id) {
      results.push({
        code,
        deleted: false,
        blockedUserCount: 0,
        blockedStoreCount: 0,
        message: 'このプランは見つかりませんでした。',
      });
      continue;
    }

    const { data: subscriptions, error: subscriptionError } = await supabaseAdmin
      .from('org_subscriptions')
      .select('org_id')
      .eq('billing_plan_id', plan.id);
    if (subscriptionError) {
      results.push({
        code,
        deleted: false,
        blockedUserCount: 0,
        blockedStoreCount: 0,
        message: `組織契約の確認に失敗しました。(${subscriptionError.message})`,
      });
      continue;
    }

    const orgIds = Array.from(
      new Set(
        (subscriptions || [])
          .map((row) => String((row as { org_id?: string }).org_id || ''))
          .filter((orgId) => orgId.length > 0)
      )
    );

    const { data: schedules, error: scheduleError } = await supabaseAdmin
      .from('org_subscription_plan_schedules')
      .select('org_id')
      .eq('billing_plan_id', plan.id)
      .in('status', ['SCHEDULED', 'APPLIED']);
    if (scheduleError && !String(scheduleError.message || '').includes('does not exist')) {
      results.push({
        code,
        deleted: false,
        blockedUserCount: 0,
        blockedStoreCount: 0,
        message: `予約切替の確認に失敗しました。(${scheduleError.message})`,
      });
      continue;
    }
    (schedules || []).forEach((row) => {
      const orgId = String((row as { org_id?: string }).org_id || '');
      if (orgId.length > 0 && !orgIds.includes(orgId)) {
        orgIds.push(orgId);
      }
    });

    const { data: storeSubscriptions, error: storeSubscriptionError } = await supabaseAdmin
      .from('store_subscriptions')
      .select('store_id')
      .eq('billing_plan_id', plan.id);
    if (storeSubscriptionError && !String(storeSubscriptionError.message || '').includes('does not exist')) {
      results.push({
        code,
        deleted: false,
        blockedUserCount: 0,
        blockedStoreCount: 0,
        message: `店舗契約の確認に失敗しました。(${storeSubscriptionError.message})`,
      });
      continue;
    }

    const storeIds = Array.from(
      new Set(
        (storeSubscriptions || [])
          .map((row) => String((row as { store_id?: string }).store_id || ''))
          .filter((storeId) => storeId.length > 0)
      )
    );

    const { data: storeSchedules, error: storeScheduleError } = await supabaseAdmin
      .from('store_subscription_plan_schedules')
      .select('store_id')
      .eq('billing_plan_id', plan.id)
      .in('status', ['SCHEDULED', 'APPLIED']);
    if (storeScheduleError && !String(storeScheduleError.message || '').includes('does not exist')) {
      results.push({
        code,
        deleted: false,
        blockedUserCount: 0,
        blockedStoreCount: 0,
        message: `店舗プラン予約の確認に失敗しました。(${storeScheduleError.message})`,
      });
      continue;
    }
    (storeSchedules || []).forEach((row) => {
      const storeId = String((row as { store_id?: string }).store_id || '');
      if (storeId.length > 0 && !storeIds.includes(storeId)) {
        storeIds.push(storeId);
      }
    });

    let blockedUserCount = 0;
    if (orgIds.length > 0) {
      const { count, error: membershipCountError } = await supabaseAdmin
        .from('memberships')
        .select('user_id', { count: 'exact', head: true })
        .in('org_id', orgIds);
      if (membershipCountError) {
        results.push({
          code,
          deleted: false,
          blockedUserCount: 0,
          blockedStoreCount: 0,
          message: `利用ユーザー数の確認に失敗しました。(${membershipCountError.message})`,
        });
        continue;
      }
      blockedUserCount = count || 0;
    }
    const blockedStoreCount = storeIds.length;

    if (blockedUserCount > 0 || blockedStoreCount > 0) {
      const parts = [];
      if (blockedStoreCount > 0) parts.push(`利用店舗 ${blockedStoreCount}件`);
      if (blockedUserCount > 0) parts.push(`利用ユーザー ${blockedUserCount}人`);
      results.push({
        code,
        deleted: false,
        blockedUserCount,
        blockedStoreCount,
        message: `このプランは ${parts.join(' / ')} のため削除できません。`,
      });
      continue;
    }

    const { error: deleteError } = await supabaseAdmin
      .from('billing_plans')
      .delete()
      .eq('id', plan.id);
    if (deleteError) {
      results.push({
        code,
        deleted: false,
        blockedUserCount: 0,
        blockedStoreCount: 0,
        message: `削除に失敗しました。(${deleteError.message})`,
      });
      continue;
    }

    await supabaseAdmin.from('audit_logs').insert({
      actor_user_id: actorUserId,
      action: 'BILLING_PLAN_DELETE',
      target_type: 'billing_plan',
      target_id: code,
      payload: { code },
    });

    results.push({
      code,
      deleted: true,
      blockedUserCount: 0,
      blockedStoreCount: 0,
    });
  }

  return jsonResponse(200, {
    ok: true,
    results,
  });
});
