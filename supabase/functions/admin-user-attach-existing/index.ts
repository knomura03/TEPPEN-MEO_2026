import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveAuthenticatedUserId } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

const canAttachRole = (actorRole: AppRole, targetRole: AppRole): boolean => {
  if (actorRole === 'ADMIN') return true;
  if (actorRole === 'SUPERVISOR') return targetRole === 'MANAGER' || targetRole === 'USER';
  if (actorRole === 'MANAGER') return targetRole === 'USER';
  return false;
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
    storeId?: string;
    targetUserId?: string;
    role?: string;
    query?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const orgId = String(payload.orgId || '').trim();
  const storeId = String(payload.storeId || '').trim();
  const targetUserId = String(payload.targetUserId || '').trim();
  const targetRole = normalizeRole(payload.role);
  const searchQuery = String(payload.query || '').trim().toLowerCase();

  if (!orgId) {
    return jsonResponse(400, { error: 'orgId is required' });
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

  const { data: targetOrgRow, error: targetOrgError } = await supabaseAdmin
    .from('organizations')
    .select('id, management_unit_id')
    .eq('id', orgId)
    .maybeSingle();
  if (targetOrgError || !targetOrgRow?.id) {
    return jsonResponse(404, { error: 'group not found' });
  }
  const targetManagementUnitId = String(targetOrgRow.management_unit_id || '');

  if (searchQuery && !targetUserId) {
    const collected: Array<{ userId: string; email: string; name: string }> = [];
    const seen = new Set<string>();

    for (let page = 1; page <= 10; page++) {
      const { data: usersPage, error: usersPageError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (usersPageError || !usersPage?.users) {
        return jsonResponse(400, { error: usersPageError?.message || 'Failed to list users' });
      }
      for (const user of usersPage.users) {
        const userId = String(user.id || '').trim();
        const email = String(user.email || '').trim();
        const name = String((user.user_metadata as Record<string, unknown> | null)?.name || '').trim();
        if (!userId || !email) continue;
        if (seen.has(userId)) continue;
        const matched = email.toLowerCase().includes(searchQuery) || name.toLowerCase().includes(searchQuery);
        if (!matched) continue;

        const { data: candidateMemberships, error: candidateMembershipError } = await supabaseAdmin
          .from('memberships')
          .select('org_id, role, organizations:organizations!memberships_org_id_fkey(management_unit_id)')
          .eq('user_id', userId);
        if (candidateMembershipError || !candidateMemberships || candidateMemberships.length === 0) {
          continue;
        }

        const typedMemberships = candidateMemberships as Array<{
          org_id: string;
          role: string;
          organizations?: { management_unit_id?: string | null } | Array<{ management_unit_id?: string | null }> | null;
        }>;

        const inSameOrg = typedMemberships.some((row) => row.org_id === orgId);
        const inSameUnit = typedMemberships.every((row) => {
          const relationValue = row.organizations;
          const relation = Array.isArray(relationValue) ? relationValue[0] : relationValue;
          const candidateUnitId = String(relation?.management_unit_id || '');
          return !candidateUnitId || candidateUnitId === targetManagementUnitId;
        });

        const allowedByRole = (() => {
          if (actorRole === 'ADMIN') return true;
          if (actorRole === 'SUPERVISOR') return inSameUnit;
          if (actorRole === 'MANAGER') return inSameOrg;
          return false;
        })();
        if (!allowedByRole) continue;

        seen.add(userId);
        collected.push({
          userId,
          email,
          name: name || email.split('@')[0] || userId.slice(0, 8),
        });
        if (collected.length >= 20) break;
      }

      if (collected.length >= 20 || usersPage.users.length < 200) break;
    }

    return jsonResponse(200, {
      ok: true,
      candidates: collected,
    });
  }

  if (!storeId || !targetUserId || !targetRole) {
    return jsonResponse(400, { error: 'storeId, targetUserId, role are required' });
  }
  if (!canAttachRole(actorRole, targetRole)) {
    return jsonResponse(403, { error: 'Not allowed' });
  }

  const { data: targetUserProfile, error: targetProfileError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('id', targetUserId)
    .maybeSingle();
  if (targetProfileError || !targetUserProfile?.id) {
    return jsonResponse(404, { error: 'Target user not found' });
  }

  const { data: targetStoreRow, error: targetStoreError } = await supabaseAdmin
    .from('stores')
    .select('id, org_id')
    .eq('id', storeId)
    .maybeSingle();
  if (targetStoreError || !targetStoreRow || String(targetStoreRow.org_id) !== orgId) {
    return jsonResponse(400, { error: 'storeId is invalid for orgId' });
  }

  const { data: existingMembershipRows, error: existingMembershipError } = await supabaseAdmin
    .from('memberships')
    .select('id, org_id, role, store_id, organizations:organizations!memberships_org_id_fkey(management_unit_id)')
    .eq('user_id', targetUserId);
  if (existingMembershipError) {
    return jsonResponse(400, { error: existingMembershipError.message });
  }

  const typedExistingRows = (existingMembershipRows || []) as Array<{
    id: string;
    org_id: string;
    role: string;
    store_id: string | null;
    organizations?: { management_unit_id?: string | null } | Array<{ management_unit_id?: string | null }> | null;
  }>;

  for (const row of typedExistingRows) {
    const relationValue = row.organizations;
    const relation = Array.isArray(relationValue) ? relationValue[0] : relationValue;
    const existingUnitId = String(relation?.management_unit_id || '');
    if (existingUnitId && existingUnitId !== targetManagementUnitId) {
      return jsonResponse(403, { error: '既存ユーザーは異なる管理ユニットへ追加できません。' });
    }
  }

  let attachedMembershipId: string | null = null;
  let attached = false;
  if (targetRole === 'USER') {
    const existingSame = typedExistingRows.find(
      (row) => row.org_id === orgId && normalizeRole(row.role) === 'USER' && row.store_id === storeId
    );
    if (existingSame?.id) {
      attachedMembershipId = existingSame.id;
      attached = false;
    } else {
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('memberships')
        .insert({
          user_id: targetUserId,
          org_id: orgId,
          store_id: storeId,
          role: 'USER',
        })
        .select('id')
        .maybeSingle();
      if (insertError || !inserted?.id) {
        return jsonResponse(400, { error: insertError?.message || 'Failed to attach membership' });
      }
      attachedMembershipId = inserted.id;
      attached = true;
    }
  } else {
    const existingRoleMembership = typedExistingRows.find(
      (row) => row.org_id === orgId && normalizeRole(row.role) === targetRole
    );
    if (existingRoleMembership?.id) {
      attachedMembershipId = existingRoleMembership.id;
      attached = false;
    } else {
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('memberships')
        .insert({
          user_id: targetUserId,
          org_id: orgId,
          store_id: null,
          role: targetRole,
        })
        .select('id')
        .maybeSingle();
      if (insertError || !inserted?.id) {
        return jsonResponse(400, { error: insertError?.message || 'Failed to attach membership' });
      }
      attachedMembershipId = inserted.id;
      attached = true;
    }
  }

  await supabaseAdmin.from('audit_logs').insert({
    org_id: orgId,
    store_id: targetRole === 'USER' ? storeId : null,
    actor_user_id: actorUserId,
    action: 'USER_ATTACHED_EXISTING_MEMBERSHIP',
    target_type: 'membership',
    target_id: attachedMembershipId,
    payload: {
      org_id: orgId,
      store_id: storeId,
      target_user_id: targetUserId,
      role: targetRole,
      attached,
    },
  });

  return jsonResponse(200, {
    ok: true,
    attached,
    membershipId: attachedMembershipId,
    orgId,
    storeId,
    targetUserId,
    role: targetRole,
  });
});
