import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveAuthenticatedUserId } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXISTING_EMAIL_ERROR = 'すでに存在しているユーザーのため招待できません。別のメールアドレスを指定してください。';

type AppRole = 'ADMIN' | 'SUPERVISOR' | 'MANAGER' | 'USER';
type AuthLinkType = 'INVITE' | 'RECOVERY';

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

const normalizeLinkType = (raw: unknown): AuthLinkType | null => {
  const linkType = String(raw || '').trim().toUpperCase();
  if (linkType === 'INVITE' || linkType === 'RECOVERY') return linkType;
  return null;
};

const canCreateRole = (actorRole: AppRole, targetRole: AppRole): boolean => {
  if (actorRole === 'ADMIN') return true;
  if (actorRole === 'SUPERVISOR') return targetRole === 'MANAGER' || targetRole === 'USER';
  if (actorRole === 'MANAGER') return targetRole === 'USER';
  return false;
};

const canManageRole = (actorRole: AppRole, targetRole: AppRole): boolean => {
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

const resolveActionLinkFromData = (data: unknown): string => {
  if (!data || typeof data !== 'object') return '';
  const typed = data as Record<string, unknown>;
  const direct = typed.action_link;
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct.trim();
  }
  const properties = typed.properties;
  if (properties && typeof properties === 'object') {
    const link = (properties as Record<string, unknown>).action_link;
    if (typeof link === 'string' && link.trim().length > 0) {
      return link.trim();
    }
  }
  return '';
};

const resolveActorRoleForOrg = async (
  supabaseAdmin: ReturnType<typeof createClient>,
  actorUserId: string,
  targetOrgId: string
): Promise<AppRole | null> => {
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

  if (isAdmin) return 'ADMIN';

  if (isSupervisor) {
    const { data: actorUnitRow, error: actorUnitError } = await supabaseAdmin
      .from('management_unit_supervisors')
      .select('management_unit_id')
      .eq('supervisor_user_id', actorUserId)
      .maybeSingle();
    if (actorUnitError) throw new Error(actorUnitError.message);

    const actorUnitId = String(actorUnitRow?.management_unit_id || '');
    const { data: targetOrgRow, error: targetOrgError } = await supabaseAdmin
      .from('organizations')
      .select('management_unit_id')
      .eq('id', targetOrgId)
      .maybeSingle();
    if (targetOrgError || !targetOrgRow) {
      throw new Error(targetOrgError?.message || 'group not found');
    }
    if (actorUnitId && actorUnitId === String(targetOrgRow.management_unit_id || '')) {
      return 'SUPERVISOR';
    }
  }

  if (isManagerInTargetOrg) return 'MANAGER';
  return null;
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

  let payload: {
    orgId?: string;
    email?: string;
    name?: string;
    role?: string;
    storeId?: string;
    planCode?: string;
    linkType?: AuthLinkType;
    redirectTo?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const orgId = String(payload.orgId || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();
  const name = String(payload.name || '').trim();
  const targetRole = normalizeRole(payload.role);
  const storeId = String(payload.storeId || '').trim();
  const planCode = String(payload.planCode || '').trim().toUpperCase();
  const linkType = normalizeLinkType(payload.linkType || 'INVITE');
  const redirectTo = resolveInviteRedirectTo(req, payload.redirectTo);

  if (!orgId || !email || !name || !linkType) {
    return jsonResponse(400, { error: 'Missing required fields' });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let actorRole: AppRole | null = null;
  try {
    actorRole = await resolveActorRoleForOrg(supabaseAdmin, actorUserId, orgId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to resolve actor role';
    return jsonResponse(400, { error: message });
  }
  if (!actorRole) {
    return jsonResponse(403, { error: 'Not allowed' });
  }
  const isInternal = actorRole === 'ADMIN' || actorRole === 'SUPERVISOR';

  if (linkType === 'INVITE') {
    if (!targetRole) {
      return jsonResponse(400, { error: 'role is required for invite link' });
    }
    if (!storeId) {
      return jsonResponse(400, { error: 'store is required for invite link' });
    }
    if (!canCreateRole(actorRole, targetRole)) {
      return jsonResponse(403, { error: 'Not allowed to create this role' });
    }

    const { data: storeRow, error: storeError } = await supabaseAdmin
      .from('stores')
      .select('id, org_id')
      .eq('id', storeId)
      .maybeSingle();
    if (storeError || !storeRow || String(storeRow.org_id) !== orgId) {
      return jsonResponse(400, { error: 'storeId is invalid for orgId' });
    }

    const existingUserId = await findUserIdByEmail(supabaseAdmin, email);
    if (existingUserId) {
      return jsonResponse(400, { error: EXISTING_EMAIL_ERROR });
    }

    const inviteResult = await supabaseAdmin.auth.admin.generateLink({
      type: 'invite',
      email,
      options: { redirectTo, data: { name } },
    });
    if (inviteResult.error) {
      return jsonResponse(400, { error: inviteResult.error.message || 'Failed to generate invite link' });
    }
    const actionLink = resolveActionLinkFromData(inviteResult.data);
    const inviteUserId =
      inviteResult.data && typeof inviteResult.data === 'object' && 'user' in inviteResult.data
        ? String((inviteResult.data as { user?: { id?: string } }).user?.id || '')
        : '';
    if (!inviteUserId) {
      return jsonResponse(400, { error: 'Failed to resolve user id from invite link' });
    }

    const profilePayload: Record<string, unknown> = {
      id: inviteUserId,
      name,
      email,
      invited_at: new Date().toISOString(),
      password_set_at: null,
    };
    const { error: profileError } = await supabaseAdmin.from('profiles').upsert(profilePayload, { onConflict: 'id' });
    if (profileError) {
      return jsonResponse(400, { error: profileError.message });
    }

    const membershipStoreId = targetRole === 'USER' ? storeId : null;
    const { error: membershipInsertError } = await supabaseAdmin.from('memberships').insert({
      user_id: inviteUserId,
      org_id: orgId,
      store_id: membershipStoreId,
      role: targetRole,
    });
    if (membershipInsertError) {
      return jsonResponse(400, { error: membershipInsertError.message });
    }

    let appliedPlanCode: string | null = null;
    if (isInternal && planCode.length > 0) {
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
      appliedPlanCode = planCode;
    }

    await supabaseAdmin.from('audit_logs').insert({
      org_id: orgId,
      store_id: storeId,
      actor_user_id: actorUserId,
      action: 'USER_INVITE_LINK_GENERATED',
      target_type: 'user',
      target_id: inviteUserId,
      payload: {
        org_id: orgId,
        store_id: storeId,
        target_user_id: inviteUserId,
        email,
        role: targetRole,
        requested_link_type: 'INVITE',
        issued_link_type: 'INVITE',
        plan_code: appliedPlanCode,
      },
    });

    return jsonResponse(200, {
      ok: true,
      orgId,
      userId: inviteUserId,
      role: targetRole,
      actionLink,
      linkType: 'INVITE',
      reusedExistingUser: false,
      appliedPlanCode,
    });
  }

  const targetUserId = await findUserIdByEmail(supabaseAdmin, email);
  if (!targetUserId) {
    return jsonResponse(404, { error: 'Target email is not registered yet' });
  }

  const { data: targetMemberships, error: targetMembershipError } = await supabaseAdmin
    .from('memberships')
    .select('role')
    .eq('user_id', targetUserId)
    .eq('org_id', orgId);
  if (targetMembershipError || !targetMemberships || targetMemberships.length === 0) {
    return jsonResponse(404, { error: 'Target user is not a member of this group' });
  }

  const targetHighestRole = (['ADMIN', 'SUPERVISOR', 'MANAGER', 'USER'] as AppRole[]).find((candidate) =>
    (targetMemberships as Array<{ role: string }>).some((row) => normalizeRole(row.role) === candidate)
  ) || 'USER';
  if (!canManageRole(actorRole, targetHighestRole)) {
    return jsonResponse(403, { error: 'Not allowed to issue recovery link for this user' });
  }

  const recoveryResult = await supabaseAdmin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo, data: { name } },
  });
  if (recoveryResult.error) {
    return jsonResponse(400, { error: recoveryResult.error.message || 'Failed to generate recovery link' });
  }
  const actionLink = resolveActionLinkFromData(recoveryResult.data);

  await supabaseAdmin.from('audit_logs').insert({
    org_id: orgId,
    actor_user_id: actorUserId,
    action: 'USER_RECOVERY_LINK_GENERATED',
    target_type: 'user',
    target_id: targetUserId,
    payload: {
      org_id: orgId,
      target_user_id: targetUserId,
      email,
      role: targetHighestRole,
      requested_link_type: 'RECOVERY',
      issued_link_type: 'RECOVERY',
    },
  });

  return jsonResponse(200, {
    ok: true,
    orgId,
    userId: targetUserId,
    role: targetHighestRole,
    actionLink,
    linkType: 'RECOVERY',
    reusedExistingUser: true,
    appliedPlanCode: null,
  });
});
