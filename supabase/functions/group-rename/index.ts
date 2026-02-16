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

const normalizeRole = (raw: unknown): AppRole | null => {
  const role = String(raw || '').trim().toUpperCase();
  if (role === 'ADMIN' || role === 'SUPERVISOR' || role === 'MANAGER' || role === 'USER') return role;
  return null;
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
  if (actorMembershipError) throw new Error(actorMembershipError.message);

  const memberships = (actorMembershipRows || []) as Array<{ org_id: string; role: string }>;
  const actorRoles = memberships
    .map((row) => normalizeRole(row.role))
    .filter((role): role is AppRole => Boolean(role));
  const isAdmin = actorRoles.includes('ADMIN');
  if (isAdmin) return 'ADMIN';

  const isSupervisor = actorRoles.includes('SUPERVISOR');
  if (isSupervisor) {
    const { data: actorUnitRow, error: actorUnitError } = await supabaseAdmin
      .from('management_unit_supervisors')
      .select('management_unit_id')
      .eq('supervisor_user_id', actorUserId)
      .maybeSingle();
    if (actorUnitError) throw new Error(actorUnitError.message);

    const { data: orgRow, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('management_unit_id')
      .eq('id', targetOrgId)
      .maybeSingle();
    if (orgError || !orgRow) {
      throw new Error(orgError?.message || 'group not found');
    }

    if (
      actorUnitRow?.management_unit_id &&
      String(actorUnitRow.management_unit_id) === String(orgRow.management_unit_id || '')
    ) {
      return 'SUPERVISOR';
    }
  }

  const isManagerInOrg = memberships.some(
    (row) => row.org_id === targetOrgId && normalizeRole(row.role) === 'MANAGER'
  );
  if (isManagerInOrg) return 'MANAGER';

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

  let payload: { orgId?: string; groupName?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const orgId = String(payload.orgId || '').trim();
  const groupName = String(payload.groupName || '').trim();
  if (!orgId || !groupName) {
    return jsonResponse(400, { error: 'orgId and groupName are required' });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let actorRole: AppRole | null = null;
  try {
    actorRole = await resolveActorRoleForOrg(supabaseAdmin, actorUserId, orgId);
  } catch (error) {
    return jsonResponse(400, { error: error instanceof Error ? error.message : 'Failed to resolve actor role' });
  }
  if (!actorRole || (actorRole !== 'ADMIN' && actorRole !== 'SUPERVISOR' && actorRole !== 'MANAGER')) {
    return jsonResponse(403, { error: 'Only ADMIN/SUPERVISOR/MANAGER can rename group' });
  }

  const { data: updatedOrg, error: updateError } = await supabaseAdmin
    .from('organizations')
    .update({ name: groupName })
    .eq('id', orgId)
    .select('id, name')
    .maybeSingle();
  if (updateError || !updatedOrg?.id) {
    return jsonResponse(400, { error: updateError?.message || 'Failed to rename group' });
  }

  await supabaseAdmin.from('audit_logs').insert({
    org_id: orgId,
    actor_user_id: actorUserId,
    action: 'GROUP_RENAME',
    target_type: 'organization',
    target_id: orgId,
    payload: {
      org_id: orgId,
      group_name: groupName,
      actor_role: actorRole,
    },
  });

  return jsonResponse(200, {
    ok: true,
    orgId,
    groupName,
  });
});
