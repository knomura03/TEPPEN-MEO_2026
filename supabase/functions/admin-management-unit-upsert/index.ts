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
      return jsonResponse(403, { error: 'Only ADMIN can manage management units' });
    }
  } catch (error) {
    return jsonResponse(400, { error: error instanceof Error ? error.message : 'Failed to verify role' });
  }

  let payload: { id?: string; name?: string; orgId?: string; managementUnitId?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const unitId = String(payload.id || '').trim();
  const name = String(payload.name || '').trim();
  const orgId = String(payload.orgId || '').trim();
  const targetUnitId = String(payload.managementUnitId || '').trim();

  if (orgId) {
    const resolvedUnitId = targetUnitId || unitId;
    if (!resolvedUnitId) {
      return jsonResponse(400, { error: 'managementUnitId is required when orgId is specified' });
    }
    const { data: updatedOrg, error: updateOrgError } = await supabaseAdmin
      .from('organizations')
      .update({ management_unit_id: resolvedUnitId })
      .eq('id', orgId)
      .select('id, management_unit_id')
      .maybeSingle();
    if (updateOrgError || !updatedOrg?.id) {
      return jsonResponse(400, { error: updateOrgError?.message || 'Failed to assign group to management unit' });
    }

    await supabaseAdmin.from('audit_logs').insert({
      org_id: orgId,
      actor_user_id: actorUserId,
      action: 'MANAGEMENT_UNIT_ASSIGN_GROUP',
      target_type: 'organization',
      target_id: orgId,
      payload: {
        org_id: orgId,
        management_unit_id: updatedOrg.management_unit_id,
      },
    });

    return jsonResponse(200, {
      ok: true,
      orgId: updatedOrg.id,
      managementUnitId: updatedOrg.management_unit_id,
    });
  }

  if (!name) {
    return jsonResponse(400, { error: 'name is required' });
  }

  if (unitId) {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('management_units')
      .update({ name })
      .eq('id', unitId)
      .select('id, name, created_at, updated_at')
      .maybeSingle();
    if (updateError || !updated?.id) {
      return jsonResponse(400, { error: updateError?.message || 'Failed to update management unit' });
    }

    await supabaseAdmin.from('audit_logs').insert({
      actor_user_id: actorUserId,
      action: 'MANAGEMENT_UNIT_UPDATE',
      target_type: 'management_unit',
      target_id: updated.id,
      payload: {
        management_unit_id: updated.id,
        name: updated.name,
      },
    });

    return jsonResponse(200, { ok: true, unit: updated });
  }

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('management_units')
    .insert({ name, created_by: actorUserId })
    .select('id, name, created_at, updated_at')
    .maybeSingle();
  if (insertError || !inserted?.id) {
    return jsonResponse(400, { error: insertError?.message || 'Failed to create management unit' });
  }

  await supabaseAdmin.from('audit_logs').insert({
    actor_user_id: actorUserId,
    action: 'MANAGEMENT_UNIT_CREATE',
    target_type: 'management_unit',
    target_id: inserted.id,
    payload: {
      management_unit_id: inserted.id,
      name: inserted.name,
    },
  });

  return jsonResponse(200, { ok: true, unit: inserted });
});
