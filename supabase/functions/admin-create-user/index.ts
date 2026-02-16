import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveAuthenticatedUserId } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXISTING_EMAIL_ERROR = 'すでに存在しているユーザーのため招待できません。別のメールアドレスを指定してください。';

type AppRole = 'ADMIN' | 'SUPERVISOR' | 'MANAGER' | 'USER';

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });

const normalizeRole = (raw: unknown): AppRole | null => {
  const role = String(raw || '').trim().toUpperCase();
  if (role === 'ADMIN' || role === 'SUPERVISOR' || role === 'MANAGER' || role === 'USER') return role;
  return null;
};

const canCreateRole = (actorRole: AppRole, targetRole: AppRole): boolean => {
  if (actorRole === 'ADMIN') return true;
  if (actorRole === 'SUPERVISOR') return targetRole === 'MANAGER' || targetRole === 'USER';
  if (actorRole === 'MANAGER') return targetRole === 'USER';
  return false;
};

const normalizeRedirectTo = (value: string | null | undefined): string | null => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

const resolveInviteRedirectTo = (req: Request, payloadValue: string | undefined): string | undefined => {
  const allowlistRaw =
    Deno.env.get('INVITE_REDIRECT_ALLOWLIST') ||
    Deno.env.get('APP_INVITE_REDIRECT_ALLOWLIST') ||
    '';
  const allowlist = allowlistRaw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const isAllowed = (urlValue: string) => {
    if (allowlist.length === 0) return true;
    return allowlist.some((prefix) => urlValue.startsWith(prefix));
  };

  const fromPayload = normalizeRedirectTo(payloadValue);
  if (fromPayload && isAllowed(fromPayload)) return fromPayload;

  const fromEnv =
    normalizeRedirectTo(Deno.env.get('INVITE_REDIRECT_URL')) ||
    normalizeRedirectTo(Deno.env.get('APP_INVITE_REDIRECT_URL'));
  if (fromEnv && isAllowed(fromEnv)) return fromEnv;

  const requestOrigin = normalizeRedirectTo(req.headers.get('origin'));
  if (requestOrigin && isAllowed(requestOrigin)) {
    const base = requestOrigin.endsWith('/') ? requestOrigin.slice(0, -1) : requestOrigin;
    return `${base}/invite`;
  }

  return undefined;
};

const findUserIdByEmail = async (
  supabaseAdmin: ReturnType<typeof createClient>,
  email: string
): Promise<string | null> => {
  const normalized = email.trim().toLowerCase();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users) return null;
    const found = data.users.find((u: { email?: string | null }) => (u.email || '').toLowerCase() === normalized);
    if (found?.id) return found.id;
    if (data.users.length < 1000) break;
  }
  return null;
};

const resolveActorRoleForOrg = async (
  supabaseAdmin: ReturnType<typeof createClient>,
  actorUserId: string,
  targetOrgId: string
): Promise<{ actorRole: AppRole | null; targetOrgManagementUnitId: string | null }> => {
  const { data: actorMembershipRows, error: actorMembershipError } = await supabaseAdmin
    .from('memberships')
    .select('org_id, role')
    .eq('user_id', actorUserId);
  if (actorMembershipError) {
    throw new Error(actorMembershipError.message);
  }

  const memberships = (actorMembershipRows || []) as Array<{ org_id: string; role: string }>;
  const actorRoles = memberships
    .map((row) => normalizeRole(row.role))
    .filter((role): role is AppRole => Boolean(role));
  const isAdmin = actorRoles.includes('ADMIN');
  const isSupervisor = actorRoles.includes('SUPERVISOR');
  const isManagerInTargetOrg = memberships.some(
    (row) => row.org_id === targetOrgId && normalizeRole(row.role) === 'MANAGER'
  );

  const { data: targetOrgRow, error: targetOrgError } = await supabaseAdmin
    .from('organizations')
    .select('id, management_unit_id')
    .eq('id', targetOrgId)
    .maybeSingle();
  if (targetOrgError || !targetOrgRow) {
    throw new Error(targetOrgError?.message || 'group not found');
  }
  const targetOrgManagementUnitId = String(targetOrgRow.management_unit_id || '');

  if (isAdmin) {
    return {
      actorRole: 'ADMIN',
      targetOrgManagementUnitId: targetOrgManagementUnitId || null,
    };
  }

  if (isSupervisor) {
    const { data: actorUnitRow, error: actorUnitError } = await supabaseAdmin
      .from('management_unit_supervisors')
      .select('management_unit_id')
      .eq('supervisor_user_id', actorUserId)
      .maybeSingle();
    if (actorUnitError) {
      throw new Error(actorUnitError.message);
    }
    const actorUnitId = String(actorUnitRow?.management_unit_id || '');
    if (actorUnitId && actorUnitId === targetOrgManagementUnitId) {
      return {
        actorRole: 'SUPERVISOR',
        targetOrgManagementUnitId: targetOrgManagementUnitId || null,
      };
    }
  }

  if (isManagerInTargetOrg) {
    return {
      actorRole: 'MANAGER',
      targetOrgManagementUnitId: targetOrgManagementUnitId || null,
    };
  }

  return {
    actorRole: null,
    targetOrgManagementUnitId: targetOrgManagementUnitId || null,
  };
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

  let payload: {
    email?: string;
    name?: string;
    role?: string;
    storeId?: string;
    orgId?: string;
    planCode?: string;
    redirectTo?: string;
    password?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const email = payload.email?.trim().toLowerCase();
  const name = payload.name?.trim();
  const role = normalizeRole(payload.role);
  const storeId = payload.storeId?.trim();
  const orgId = payload.orgId?.trim();
  const planCode = payload.planCode?.trim().toUpperCase();
  const password = payload.password?.trim();
  const inviteRedirectTo = resolveInviteRedirectTo(req, payload.redirectTo);

  if (!email || !name || !role) {
    return jsonResponse(400, { error: 'Missing required fields' });
  }
  if (!orgId || !storeId) {
    return jsonResponse(400, { error: 'group and store are required' });
  }

  const { data: storeRow, error: storeError } = await supabaseAdmin
    .from('stores')
    .select('id, org_id')
    .eq('id', storeId)
    .maybeSingle();
  if (storeError || !storeRow) {
    return jsonResponse(400, { error: 'Store not found' });
  }
  if (storeRow.org_id !== orgId) {
    return jsonResponse(400, { error: 'storeId is not part of orgId' });
  }

  let actorContext: { actorRole: AppRole | null; targetOrgManagementUnitId: string | null };
  try {
    actorContext = await resolveActorRoleForOrg(supabaseAdmin, actorUserId, orgId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to resolve actor role';
    return jsonResponse(400, { error: message });
  }

  const actorRole = actorContext.actorRole;
  if (!actorRole || !canCreateRole(actorRole, role)) {
    return jsonResponse(403, { error: 'Not allowed' });
  }

  const existingUserId = await findUserIdByEmail(supabaseAdmin, email);
  if (existingUserId) {
    return jsonResponse(400, { error: EXISTING_EMAIL_ERROR });
  }

  let newUserId = '';
  if (password && password.length > 0) {
    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (createError || !created?.user?.id) {
      return jsonResponse(400, { error: createError?.message || 'Failed to create user' });
    }
    newUserId = created.user.id;
  } else {
    const inviteOptions: { data: { name: string }; redirectTo?: string } = { data: { name } };
    if (inviteRedirectTo) {
      inviteOptions.redirectTo = inviteRedirectTo;
    }
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, inviteOptions);
    if (inviteError || !inviteData?.user?.id) {
      return jsonResponse(400, { error: inviteError?.message || 'Failed to invite user' });
    }
    newUserId = inviteData.user.id;
  }

  if (!newUserId) {
    return jsonResponse(400, { error: 'Failed to resolve new user id' });
  }

  const profilePayload: Record<string, unknown> = {
    id: newUserId,
    name,
    email,
    invited_at: new Date().toISOString(),
    password_set_at: password && password.length > 0 ? new Date().toISOString() : null,
  };

  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .upsert(profilePayload, { onConflict: 'id' });
  if (profileError) {
    return jsonResponse(400, { error: profileError.message });
  }

  const membershipStoreId = role === 'USER' ? storeId : null;
  const { error: membershipInsertError } = await supabaseAdmin.from('memberships').insert({
    user_id: newUserId,
    org_id: orgId,
    store_id: membershipStoreId,
    role,
  });
  if (membershipInsertError) {
    return jsonResponse(400, { error: membershipInsertError.message });
  }

  const isInternalActor = actorRole === 'ADMIN' || actorRole === 'SUPERVISOR';
  let appliedPlanCode: string | null = null;
  if (isInternalActor && planCode && planCode.length > 0) {
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

    const { data: storeSubscriptionRow, error: storeSubscriptionError } = await supabaseAdmin
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
    if (storeSubscriptionError || !storeSubscriptionRow?.id) {
      return jsonResponse(400, { error: storeSubscriptionError?.message || 'Failed to set store subscription plan' });
    }

    await supabaseAdmin.from('audit_logs').insert({
      org_id: orgId,
      store_id: storeId,
      actor_user_id: actorUserId,
      action: 'STORE_SUBSCRIPTION_SET_PLAN',
      target_type: 'store_subscription',
      target_id: storeSubscriptionRow.id,
      payload: {
        store_id: storeId,
        plan_code: planCode,
        via: 'admin-create-user',
      },
    });
    appliedPlanCode = planCode;
  }

  return jsonResponse(200, {
    ok: true,
    userId: newUserId,
    appliedPlanCode,
    targetOrgManagementUnitId: actorContext.targetOrgManagementUnitId,
  });
});
