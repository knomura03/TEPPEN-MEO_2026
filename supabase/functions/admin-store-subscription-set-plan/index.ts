import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveAuthenticatedUserId } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });

const normalizePlanCode = (raw: unknown): string => {
  const code = String(raw || '').trim().toUpperCase();
  if (!code) return '';
  if (!/^[A-Z0-9_]+$/.test(code)) return '';
  return code;
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

  let payload: { storeId?: string; planCode?: string; effectiveAt?: string | null };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const storeId = String(payload.storeId || '').trim();
  const planCode = normalizePlanCode(payload.planCode);
  const effectiveAtRaw = typeof payload.effectiveAt === 'string' ? payload.effectiveAt.trim() : '';

  if (!storeId || !planCode) {
    return jsonResponse(400, { error: 'storeId and planCode are required' });
  }

  let effectiveAt: Date | null = null;
  if (effectiveAtRaw.length > 0) {
    const parsed = new Date(effectiveAtRaw);
    if (Number.isNaN(parsed.getTime())) {
      return jsonResponse(400, { error: 'effectiveAt is invalid date time' });
    }
    effectiveAt = parsed;
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: storeRow, error: storeError } = await supabaseAdmin
    .from('stores')
    .select('id, org_id')
    .eq('id', storeId)
    .maybeSingle();
  if (storeError || !storeRow) {
    return jsonResponse(404, { error: 'store not found' });
  }

  const { data: actorMemberships, error: actorMembershipError } = await supabaseAdmin
    .from('memberships')
    .select('role')
    .eq('user_id', actorUserId)
    .eq('org_id', storeRow.org_id);
  if (actorMembershipError || !actorMemberships || actorMemberships.length === 0) {
    return jsonResponse(403, { error: 'Not allowed' });
  }

  const actorRoles = (actorMemberships as Array<{ role: string }>).map((row) => String(row.role || '').toUpperCase());
  const isPrivileged = actorRoles.includes('ADMIN') || actorRoles.includes('SUPERVISOR');
  if (!isPrivileged) {
    return jsonResponse(403, { error: 'Only ADMIN/SUPERVISOR can change store subscription plan' });
  }

  const { data: planRow, error: planError } = await supabaseAdmin
    .from('billing_plans')
    .select('id, code, is_active')
    .eq('code', planCode)
    .maybeSingle();
  if (planError || !planRow?.id) {
    return jsonResponse(400, { error: 'billing plan not found' });
  }
  if (!planRow.is_active) {
    return jsonResponse(400, { error: 'billing plan is inactive' });
  }

  const now = new Date();
  const shouldSchedule = Boolean(effectiveAt && effectiveAt.getTime() > now.getTime());

  if (shouldSchedule && effectiveAt) {
    const { data: scheduleRow, error: scheduleError } = await supabaseAdmin
      .from('store_subscription_plan_schedules')
      .insert({
        store_id: storeId,
        billing_plan_id: planRow.id,
        status: 'SCHEDULED',
        effective_at: effectiveAt.toISOString(),
        created_by: actorUserId,
        updated_by: actorUserId,
      })
      .select('id')
      .maybeSingle();
    if (scheduleError || !scheduleRow?.id) {
      return jsonResponse(400, { error: scheduleError?.message || 'Failed to create schedule' });
    }

    await supabaseAdmin.from('audit_logs').insert({
      org_id: storeRow.org_id,
      store_id: storeId,
      actor_user_id: actorUserId,
      action: 'STORE_SUBSCRIPTION_SET_PLAN_SCHEDULED',
      target_type: 'store_subscription_plan_schedule',
      target_id: scheduleRow.id,
      payload: {
        store_id: storeId,
        plan_code: planCode,
        effective_at: effectiveAt.toISOString(),
      },
    });

    return jsonResponse(200, {
      ok: true,
      storeId,
      planCode,
      scheduled: true,
      effectiveAt: effectiveAt.toISOString(),
      scheduleId: scheduleRow.id,
    });
  }

  const { data: subscriptionRow, error: subscriptionError } = await supabaseAdmin
    .from('store_subscriptions')
    .upsert(
      {
        store_id: storeId,
        billing_plan_id: planRow.id,
        status: 'ACTIVE',
      },
      { onConflict: 'store_id' }
    )
    .select('id')
    .maybeSingle();
  if (subscriptionError || !subscriptionRow?.id) {
    return jsonResponse(400, { error: subscriptionError?.message || 'Failed to set store subscription' });
  }

  await supabaseAdmin.from('audit_logs').insert({
    org_id: storeRow.org_id,
    store_id: storeId,
    actor_user_id: actorUserId,
    action: 'STORE_SUBSCRIPTION_SET_PLAN',
    target_type: 'store_subscription',
    target_id: subscriptionRow.id,
    payload: {
      store_id: storeId,
      plan_code: planCode,
      effective_at: null,
    },
  });

  return jsonResponse(200, {
    ok: true,
    storeId,
    planCode,
    scheduled: false,
    subscriptionId: subscriptionRow.id,
  });
});
