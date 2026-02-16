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

type AppRole = 'ADMIN' | 'SUPERVISOR' | 'MANAGER' | 'USER';

const roleRank: Record<AppRole, number> = {
  ADMIN: 4,
  SUPERVISOR: 3,
  MANAGER: 2,
  USER: 1,
};

const normalizeRole = (raw: unknown): AppRole | null => {
  const role = String(raw || '').trim().toUpperCase();
  if (role === 'ADMIN' || role === 'SUPERVISOR' || role === 'MANAGER' || role === 'USER') {
    return role;
  }
  return null;
};

const highestRoleFromRows = (rows: Array<{ role?: string }>): AppRole | null => {
  const roles = rows
    .map((row) => normalizeRole(row.role))
    .filter((role): role is AppRole => Boolean(role));
  if (roles.length === 0) return null;
  return roles.reduce((best, next) => (roleRank[next] > roleRank[best] ? next : best), roles[0]);
};

const canManageRole = (actorRole: AppRole, targetRole: AppRole): boolean => {
  if (actorRole === 'ADMIN') return true;
  if (actorRole === 'SUPERVISOR') return targetRole === 'MANAGER' || targetRole === 'USER';
  if (actorRole === 'MANAGER') return targetRole === 'USER';
  return false;
};

const normalizeStoreIds = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const unique = new Set<string>();
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    unique.add(trimmed);
  }
  return Array.from(unique);
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
    targetUserId?: string;
    patch?: {
      name?: string;
      role?: string;
      storeIds?: string[];
    };
  };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const orgId = String(payload.orgId || '').trim();
  const targetUserId = String(payload.targetUserId || '').trim();
  const patch = payload.patch || {};
  const nextName = typeof patch.name === 'string' ? patch.name.trim() : '';
  const requestedRole = patch.role ? normalizeRole(patch.role) : null;
  const requestedStoreIds = normalizeStoreIds(patch.storeIds);

  if (!orgId || !targetUserId) {
    return jsonResponse(400, { error: 'Missing required fields' });
  }
  if (actorUserId === targetUserId && requestedRole) {
    return jsonResponse(400, { error: 'Cannot change own role' });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: actorMemberships, error: actorMembershipError } = await supabaseAdmin
    .from('memberships')
    .select('role')
    .eq('user_id', actorUserId)
    .eq('org_id', orgId);
  if (actorMembershipError || !actorMemberships || actorMemberships.length === 0) {
    return jsonResponse(403, { error: 'Not allowed' });
  }
  const actorHighestRole = highestRoleFromRows(actorMemberships as Array<{ role?: string }>);
  if (!actorHighestRole) {
    return jsonResponse(403, { error: 'Not allowed' });
  }

  const { data: targetMemberships, error: targetMembershipError } = await supabaseAdmin
    .from('memberships')
    .select('id, role, store_id')
    .eq('user_id', targetUserId)
    .eq('org_id', orgId);
  if (targetMembershipError) {
    return jsonResponse(400, { error: targetMembershipError.message });
  }
  if (!targetMemberships || targetMemberships.length === 0) {
    return jsonResponse(404, { error: 'Target user membership not found in this org' });
  }

  const targetCurrentRole = highestRoleFromRows(targetMemberships as Array<{ role?: string }>);
  if (!targetCurrentRole) {
    return jsonResponse(404, { error: 'Target role not found' });
  }

  const targetRole = requestedRole || targetCurrentRole;
  if (!canManageRole(actorHighestRole, targetRole)) {
    return jsonResponse(403, { error: `Role ${actorHighestRole} cannot manage ${targetRole}` });
  }
  if (!canManageRole(actorHighestRole, targetCurrentRole)) {
    return jsonResponse(403, { error: `Role ${actorHighestRole} cannot manage ${targetCurrentRole}` });
  }

  if (patch.name !== undefined) {
    if (!nextName) {
      return jsonResponse(400, { error: 'name cannot be empty' });
    }
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({ name: nextName })
      .eq('id', targetUserId);
    if (profileError) {
      return jsonResponse(400, { error: profileError.message });
    }
  }

  let storeIdsForUserRole: string[] = [];
  if (targetRole === 'USER') {
    if (patch.storeIds !== undefined) {
      storeIdsForUserRole = requestedStoreIds;
    } else {
      storeIdsForUserRole = Array.from(
        new Set(
          (targetMemberships as Array<{ store_id?: string | null }>)
            .map((row) => (typeof row.store_id === 'string' ? row.store_id : ''))
            .filter((storeId) => storeId.length > 0)
        )
      );
    }

    if (storeIdsForUserRole.length > 0) {
      const { data: stores, error: storesError } = await supabaseAdmin
        .from('stores')
        .select('id')
        .eq('org_id', orgId)
        .in('id', storeIdsForUserRole);
      if (storesError) {
        return jsonResponse(400, { error: storesError.message });
      }
      if (!stores || stores.length !== storeIdsForUserRole.length) {
        return jsonResponse(400, { error: 'Some storeIds are invalid for the target org' });
      }
    }
  }

  const { error: deleteMembershipError } = await supabaseAdmin
    .from('memberships')
    .delete()
    .eq('user_id', targetUserId)
    .eq('org_id', orgId);
  if (deleteMembershipError) {
    return jsonResponse(400, { error: deleteMembershipError.message });
  }

  const membershipRows =
    targetRole === 'USER'
      ? (storeIdsForUserRole.length > 0
          ? storeIdsForUserRole
          : [null]
        ).map((storeId) => ({
          user_id: targetUserId,
          org_id: orgId,
          role: targetRole,
          store_id: storeId,
        }))
      : [
          {
            user_id: targetUserId,
            org_id: orgId,
            role: targetRole,
            store_id: null,
          },
        ];

  const { error: insertMembershipError } = await supabaseAdmin.from('memberships').insert(membershipRows);
  if (insertMembershipError) {
    return jsonResponse(400, { error: insertMembershipError.message });
  }

  await supabaseAdmin.from('audit_logs').insert({
    org_id: orgId,
    actor_user_id: actorUserId,
    action: 'USER_UPDATED',
    target_type: 'user',
    target_id: targetUserId,
    payload: {
      target_user_id: targetUserId,
      role_before: targetCurrentRole,
      role_after: targetRole,
      name_changed: patch.name !== undefined,
      store_ids: targetRole === 'USER' ? storeIdsForUserRole : [],
    },
  });

  return jsonResponse(200, {
    ok: true,
    orgId,
    targetUserId,
    role: targetRole,
    storeIds: targetRole === 'USER' ? storeIdsForUserRole : [],
  });
});
