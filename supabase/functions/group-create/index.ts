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

const resolveActorRole = async (
  supabaseAdmin: ReturnType<typeof createClient>,
  actorUserId: string
): Promise<AppRole | null> => {
  const { data, error } = await supabaseAdmin
    .from('memberships')
    .select('role')
    .eq('user_id', actorUserId);
  if (error) {
    throw new Error(error.message);
  }
  const roles = (data || [])
    .map((row) => normalizeRole((row as { role?: string }).role))
    .filter((role): role is AppRole => Boolean(role));
  if (roles.includes('ADMIN')) return 'ADMIN';
  if (roles.includes('SUPERVISOR')) return 'SUPERVISOR';
  if (roles.includes('MANAGER')) return 'MANAGER';
  if (roles.includes('USER')) return 'USER';
  return null;
};

const resolveFallbackManagementUnit = async (
  supabaseAdmin: ReturnType<typeof createClient>
): Promise<string> => {
  const { data: existing } = await supabaseAdmin
    .from('management_units')
    .select('id')
    .eq('name', 'ADMIN直轄')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing?.id) return String(existing.id);

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('management_units')
    .insert({ name: 'ADMIN直轄' })
    .select('id')
    .maybeSingle();
  if (insertError || !inserted?.id) {
    throw new Error(insertError?.message || 'Failed to prepare fallback management unit');
  }
  return String(inserted.id);
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

  let payload: { groupName?: string; initialStoreName?: string; managementUnitId?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const groupName = String(payload.groupName || '').trim();
  const initialStoreName = String(payload.initialStoreName || '').trim();
  const requestedManagementUnitId = String(payload.managementUnitId || '').trim();
  if (!groupName || !initialStoreName) {
    return jsonResponse(400, { error: 'groupName and initialStoreName are required' });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let actorRole: AppRole | null = null;
  try {
    actorRole = await resolveActorRole(supabaseAdmin, actorUserId);
  } catch (error) {
    return jsonResponse(400, { error: error instanceof Error ? error.message : 'Failed to resolve actor role' });
  }

  if (actorRole !== 'ADMIN' && actorRole !== 'SUPERVISOR') {
    return jsonResponse(403, { error: 'Only ADMIN/SUPERVISOR can create group' });
  }

  let resolvedManagementUnitId = '';
  if (actorRole === 'ADMIN') {
    resolvedManagementUnitId = requestedManagementUnitId;
    if (!resolvedManagementUnitId) {
      try {
        resolvedManagementUnitId = await resolveFallbackManagementUnit(supabaseAdmin);
      } catch (error) {
        return jsonResponse(400, { error: error instanceof Error ? error.message : 'Failed to resolve management unit' });
      }
    }
  } else {
    const { data: actorUnitRow, error: actorUnitError } = await supabaseAdmin
      .from('management_unit_supervisors')
      .select('management_unit_id')
      .eq('supervisor_user_id', actorUserId)
      .maybeSingle();
    if (actorUnitError || !actorUnitRow?.management_unit_id) {
      return jsonResponse(403, { error: 'SUPERVISOR must belong to a management unit' });
    }
    resolvedManagementUnitId = String(actorUnitRow.management_unit_id);
  }

  const { data: unitRow, error: unitError } = await supabaseAdmin
    .from('management_units')
    .select('id')
    .eq('id', resolvedManagementUnitId)
    .maybeSingle();
  if (unitError || !unitRow?.id) {
    return jsonResponse(400, { error: 'management unit not found' });
  }

  const { data: orgRow, error: orgError } = await supabaseAdmin
    .from('organizations')
    .insert({ name: groupName, management_unit_id: resolvedManagementUnitId })
    .select('id, name, management_unit_id')
    .maybeSingle();
  if (orgError || !orgRow?.id) {
    return jsonResponse(400, { error: orgError?.message || 'Failed to create group' });
  }
  const orgId = String(orgRow.id);

  const { data: storeRow, error: storeError } = await supabaseAdmin
    .from('stores')
    .insert({
      org_id: orgId,
      name: initialStoreName,
    })
    .select('id, org_id, name')
    .maybeSingle();
  if (storeError || !storeRow?.id) {
    return jsonResponse(400, { error: storeError?.message || 'Failed to create initial store' });
  }
  const storeId = String(storeRow.id);

  const assignedRole: AppRole = actorRole;
  const { error: membershipError } = await supabaseAdmin
    .from('memberships')
    .insert({
      user_id: actorUserId,
      org_id: orgId,
      store_id: assignedRole === 'USER' ? storeId : null,
      role: assignedRole,
    });
  if (membershipError) {
    return jsonResponse(400, { error: membershipError.message });
  }

  await supabaseAdmin.from('org_store_policies').upsert(
    {
      org_id: orgId,
      default_user_store_limit: 1,
      allow_user_store_creation: true,
      updated_by: actorUserId,
    },
    { onConflict: 'org_id' }
  );

  const { data: freePlan } = await supabaseAdmin
    .from('billing_plans')
    .select('id')
    .eq('code', 'FREE')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (freePlan?.id) {
    await supabaseAdmin.from('store_subscriptions').upsert(
      {
        store_id: storeId,
        billing_plan_id: freePlan.id,
        status: 'ACTIVE',
      },
      { onConflict: 'store_id' }
    );
  }

  await supabaseAdmin.from('audit_logs').insert({
    org_id: orgId,
    store_id: storeId,
    actor_user_id: actorUserId,
    action: 'GROUP_CREATE',
    target_type: 'organization',
    target_id: orgId,
    payload: {
      group_name: groupName,
      initial_store_name: initialStoreName,
      assigned_role: assignedRole,
      management_unit_id: resolvedManagementUnitId,
    },
  });

  return jsonResponse(200, {
    ok: true,
    orgId,
    groupName,
    storeId,
    storeName: initialStoreName,
    role: assignedRole,
    managementUnitId: resolvedManagementUnitId,
  });
});
