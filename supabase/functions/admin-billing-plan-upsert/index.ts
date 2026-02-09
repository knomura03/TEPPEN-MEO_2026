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

  const { data: actorMemberships, error: actorMembershipError } = await supabaseAdmin
    .from('memberships')
    .select('role')
    .eq('user_id', actorUserId);
  if (actorMembershipError || !actorMemberships || actorMemberships.length === 0) {
    return jsonResponse(403, { error: 'Not allowed' });
  }

  const isPrivileged = actorMemberships.some((row: { role: string }) => {
    const role = String(row.role || '').toUpperCase();
    return role === 'ADMIN' || role === 'MANAGER';
  });
  if (!isPrivileged) {
    return jsonResponse(403, { error: 'Only ADMIN/MANAGER can manage billing plans' });
  }

  let payload: {
    code?: string;
    name?: string;
    amountMonthly?: number;
    currency?: string;
    isActive?: boolean;
    description?: string | null;
  };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const code = normalizePlanCode(payload.code || '');
  const name = (payload.name || '').trim();
  const amountMonthly = Number(payload.amountMonthly);
  const currency = (payload.currency || 'JPY').trim() || 'JPY';
  const isActive = payload.isActive === undefined ? true : Boolean(payload.isActive);
  const description = payload.description ? String(payload.description).trim() : null;

  if (!code || !name || !Number.isFinite(amountMonthly) || amountMonthly < 0) {
    return jsonResponse(400, { error: 'Missing or invalid fields' });
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('billing_plans')
    .select('id, code')
    .eq('code', code)
    .maybeSingle();
  if (existingError) {
    return jsonResponse(400, { error: existingError.message });
  }

  let planId: string;
  if (existing?.id) {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('billing_plans')
      .update({
        name,
        amount_monthly: amountMonthly,
        currency,
        is_active: isActive,
        description,
        updated_by: actorUserId,
      })
      .eq('code', code)
      .select('id, code')
      .maybeSingle();
    if (updateError || !updated?.id) {
      return jsonResponse(400, { error: updateError?.message || 'Failed to update billing plan' });
    }
    planId = updated.id;
  } else {
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('billing_plans')
      .insert({
        code,
        name,
        amount_monthly: amountMonthly,
        currency,
        is_active: isActive,
        description,
        created_by: actorUserId,
        updated_by: actorUserId,
      })
      .select('id, code')
      .maybeSingle();
    if (insertError || !inserted?.id) {
      return jsonResponse(400, { error: insertError?.message || 'Failed to insert billing plan' });
    }
    planId = inserted.id;
  }

  await supabaseAdmin.from('audit_logs').insert({
    actor_user_id: actorUserId,
    action: 'BILLING_PLAN_UPSERT',
    target_type: 'billing_plan',
    target_id: code,
    payload: {
      code,
      name,
      amount_monthly: amountMonthly,
      currency,
      is_active: isActive,
    },
  });

  return jsonResponse(200, {
    ok: true,
    planId,
    code,
  });
});

