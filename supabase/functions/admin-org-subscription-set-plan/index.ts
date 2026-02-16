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

const normalizePlanCode = (raw: string): string => {
  const code = raw.trim().toUpperCase();
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

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let payload: { orgId?: string; planCode?: string; effectiveAt?: string | null };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const orgId = (payload.orgId || '').trim();
  const planCode = normalizePlanCode(payload.planCode || '');
  const effectiveAtRaw = typeof payload.effectiveAt === 'string' ? payload.effectiveAt.trim() : '';
  if (!orgId || !planCode) {
    return jsonResponse(400, { error: 'Missing required fields' });
  }
  let effectiveAt: Date | null = null;
  if (effectiveAtRaw.length > 0) {
    const parsed = new Date(effectiveAtRaw);
    if (Number.isNaN(parsed.getTime())) {
      return jsonResponse(400, { error: 'effectiveAt is invalid date time' });
    }
    effectiveAt = parsed;
  }

  const { data: actorMemberships, error: actorMembershipError } = await supabaseAdmin
    .from('memberships')
    .select('role')
    .eq('user_id', actorUserId)
    .eq('org_id', orgId);
  if (actorMembershipError || !actorMemberships || actorMemberships.length === 0) {
    return jsonResponse(403, { error: 'Not allowed' });
  }

  const actorRoles = actorMemberships.map((row: { role: string }) => String(row.role || '').toUpperCase());
  const isAdmin = actorRoles.includes('ADMIN');
  const isSupervisor = actorRoles.includes('SUPERVISOR');
  if (!(isAdmin || isSupervisor)) {
    return jsonResponse(403, { error: 'Only ADMIN/SUPERVISOR can change org subscription plan' });
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

  const { data: existingSubscription, error: subscriptionError } = await supabaseAdmin
    .from('org_subscriptions')
    .select('id, org_id')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (subscriptionError) {
    return jsonResponse(400, { error: subscriptionError.message });
  }

  let subscriptionId: string;
  const now = new Date();
  const scheduleOnly = Boolean(effectiveAt && effectiveAt.getTime() > now.getTime());

  if (scheduleOnly && effectiveAt) {
    const { error: scheduleError } = await supabaseAdmin
      .from('org_subscription_plan_schedules')
      .insert({
        org_id: orgId,
        billing_plan_id: planRow.id,
        status: 'SCHEDULED',
        effective_at: effectiveAt.toISOString(),
        created_by: actorUserId,
        updated_by: actorUserId,
      });
    if (scheduleError) {
      return jsonResponse(400, { error: scheduleError.message });
    }

    await supabaseAdmin.from('audit_logs').insert({
      org_id: orgId,
      actor_user_id: actorUserId,
      action: 'ORG_SUBSCRIPTION_SET_PLAN_SCHEDULED',
      target_type: 'org_subscription_plan_schedule',
      target_id: planCode,
      payload: {
        org_id: orgId,
        plan_code: planCode,
        effective_at: effectiveAt.toISOString(),
      },
    });

    return jsonResponse(200, {
      ok: true,
      orgId,
      planCode,
      scheduled: true,
      effectiveAt: effectiveAt.toISOString(),
    });
  }

  if (existingSubscription?.id) {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('org_subscriptions')
      .update({
        billing_plan_id: planRow.id,
        status: 'ACTIVE',
      })
      .eq('id', existingSubscription.id)
      .select('id')
      .maybeSingle();
    if (updateError || !updated?.id) {
      return jsonResponse(400, { error: updateError?.message || 'Failed to update org subscription' });
    }
    subscriptionId = updated.id;
  } else {
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('org_subscriptions')
      .insert({
        org_id: orgId,
        billing_plan_id: planRow.id,
        status: 'ACTIVE',
      })
      .select('id')
      .maybeSingle();
    if (insertError || !inserted?.id) {
      return jsonResponse(400, { error: insertError?.message || 'Failed to insert org subscription' });
    }
    subscriptionId = inserted.id;
  }

  await supabaseAdmin.from('audit_logs').insert({
    org_id: orgId,
    actor_user_id: actorUserId,
    action: 'ORG_SUBSCRIPTION_SET_PLAN',
    target_type: 'org_subscription',
    target_id: subscriptionId,
    payload: {
      org_id: orgId,
      plan_code: planCode,
      effective_at: effectiveAt ? effectiveAt.toISOString() : null,
    },
  });

  return jsonResponse(200, {
    ok: true,
    orgId,
    subscriptionId,
    planCode,
  });
});
