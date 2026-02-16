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

const ensureAdmin = async (
  supabaseAdmin: ReturnType<typeof createClient>,
  actorUserId: string
): Promise<boolean> => {
  const { data, error } = await supabaseAdmin
    .from('memberships')
    .select('role')
    .eq('user_id', actorUserId)
    .eq('role', 'ADMIN')
    .limit(1);
  if (error) throw new Error(error.message);
  return Array.isArray(data) && data.length > 0;
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

  try {
    const isAdmin = await ensureAdmin(supabaseAdmin, actorUserId);
    if (!isAdmin) {
      return jsonResponse(403, { error: 'Only ADMIN can assign supervisors' });
    }
  } catch (error) {
    return jsonResponse(400, { error: error instanceof Error ? error.message : 'Failed to verify role' });
  }

  let payload: { managementUnitId?: string; supervisorUserId?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const managementUnitId = String(payload.managementUnitId || '').trim();
  const supervisorUserId = String(payload.supervisorUserId || '').trim();
  if (!managementUnitId || !supervisorUserId) {
    return jsonResponse(400, { error: 'managementUnitId and supervisorUserId are required' });
  }

  const { data: unitRow, error: unitError } = await supabaseAdmin
    .from('management_units')
    .select('id')
    .eq('id', managementUnitId)
    .maybeSingle();
  if (unitError || !unitRow?.id) {
    return jsonResponse(404, { error: 'management unit not found' });
  }

  const { data: supervisorMembershipRows, error: supervisorMembershipError } = await supabaseAdmin
    .from('memberships')
    .select('role')
    .eq('user_id', supervisorUserId)
    .eq('role', 'SUPERVISOR')
    .limit(1);
  if (supervisorMembershipError) {
    return jsonResponse(400, { error: supervisorMembershipError.message });
  }
  if (!Array.isArray(supervisorMembershipRows) || supervisorMembershipRows.length === 0) {
    return jsonResponse(400, { error: 'target user is not SUPERVISOR' });
  }

  const { data: upserted, error: upsertError } = await supabaseAdmin
    .from('management_unit_supervisors')
    .upsert(
      {
        management_unit_id: managementUnitId,
        supervisor_user_id: supervisorUserId,
        created_by: actorUserId,
      },
      { onConflict: 'supervisor_user_id' }
    )
    .select('id, management_unit_id, supervisor_user_id, created_at, updated_at')
    .maybeSingle();
  if (upsertError || !upserted?.id) {
    return jsonResponse(400, { error: upsertError?.message || 'Failed to assign supervisor' });
  }

  await supabaseAdmin.from('audit_logs').insert({
    actor_user_id: actorUserId,
    action: 'MANAGEMENT_UNIT_ASSIGN_SUPERVISOR',
    target_type: 'management_unit_supervisor',
    target_id: upserted.id,
    payload: {
      management_unit_id: upserted.management_unit_id,
      supervisor_user_id: upserted.supervisor_user_id,
    },
  });

  return jsonResponse(200, {
    ok: true,
    assignment: upserted,
  });
});
