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

  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) {
    return jsonResponse(401, { error: 'Missing auth token' });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: authUserData, error: authUserError } = await supabaseAdmin.auth.getUser(token);
  if (authUserError || !authUserData?.user) {
    return jsonResponse(401, { error: 'Invalid auth token' });
  }

  let payload: { email?: string; name?: string; role?: string; storeId?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const email = payload.email?.trim().toLowerCase();
  const name = payload.name?.trim();
  const role = payload.role?.toUpperCase();
  const storeId = payload.storeId?.trim();

  if (!email || !name || !role || !storeId) {
    return jsonResponse(400, { error: 'Missing required fields' });
  }

  const allowedRoles = new Set(['ADMIN', 'MANAGER', 'USER']);
  if (!allowedRoles.has(role)) {
    return jsonResponse(400, { error: 'Invalid role' });
  }

  const { data: storeRow, error: storeError } = await supabaseAdmin
    .from('stores')
    .select('id, org_id')
    .eq('id', storeId)
    .maybeSingle();
  if (storeError || !storeRow) {
    return jsonResponse(400, { error: 'Store not found' });
  }

  const { data: actorMemberships, error: actorMembershipError } = await supabaseAdmin
    .from('memberships')
    .select('role, org_id')
    .eq('user_id', authUserData.user.id)
    .eq('org_id', storeRow.org_id);
  if (actorMembershipError || !actorMemberships || actorMemberships.length === 0) {
    return jsonResponse(403, { error: 'Not allowed' });
  }

  const actorRoles = actorMemberships.map((row: { role: string }) => row.role.toUpperCase());
  const isAdmin = actorRoles.includes('ADMIN');
  const isManager = actorRoles.includes('MANAGER');

  if ((role === 'ADMIN' || role === 'MANAGER') && !isAdmin) {
    return jsonResponse(403, { error: 'Only ADMIN can create ADMIN/MANAGER' });
  }
  if (role === 'USER' && !(isAdmin || isManager)) {
    return jsonResponse(403, { error: 'Only ADMIN or MANAGER can create USER' });
  }

  const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    data: { name },
  });
  if (inviteError || !inviteData?.user) {
    return jsonResponse(400, { error: inviteError?.message || 'Failed to invite user' });
  }

  const newUserId = inviteData.user.id;

  const { error: profileError } = await supabaseAdmin.from('profiles').upsert(
    {
      id: newUserId,
      name,
      email,
    },
    { onConflict: 'id' }
  );
  if (profileError) {
    return jsonResponse(400, { error: profileError.message });
  }

  const membershipStoreId = role === 'USER' ? storeId : null;
  const { error: membershipError } = await supabaseAdmin.from('memberships').insert({
    user_id: newUserId,
    org_id: storeRow.org_id,
    store_id: membershipStoreId,
    role,
  });
  if (membershipError) {
    return jsonResponse(400, { error: membershipError.message });
  }

  return jsonResponse(200, {
    ok: true,
    userId: newUserId,
  });
});
