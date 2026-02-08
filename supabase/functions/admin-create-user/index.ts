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

  let payload: { email?: string; name?: string; role?: string; storeId?: string; orgId?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const email = payload.email?.trim().toLowerCase();
  const name = payload.name?.trim();
  const role = payload.role?.toUpperCase();
  const storeId = payload.storeId?.trim();
  const orgId = payload.orgId?.trim();

  if (!email || !name || !role) {
    return jsonResponse(400, { error: 'Missing required fields' });
  }

  const allowedRoles = new Set(['ADMIN', 'MANAGER', 'USER']);
  if (!allowedRoles.has(role)) {
    return jsonResponse(400, { error: 'Invalid role' });
  }

  let targetOrgId = orgId || null;
  if (storeId) {
    const { data: storeRow, error: storeError } = await supabaseAdmin
      .from('stores')
      .select('id, org_id')
      .eq('id', storeId)
      .maybeSingle();
    if (storeError || !storeRow) {
      return jsonResponse(400, { error: 'Store not found' });
    }
    targetOrgId = storeRow.org_id;
  }

  if (!targetOrgId) {
    return jsonResponse(400, { error: 'orgId is required when storeId is omitted' });
  }

  const { data: actorMemberships, error: actorMembershipError } = await supabaseAdmin
    .from('memberships')
    .select('role, org_id')
    .eq('user_id', actorUserId)
    .eq('org_id', targetOrgId);
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

  const membershipStoreId = role === 'USER' ? storeId || null : null;
  const { error: membershipError } = await supabaseAdmin.from('memberships').insert({
    user_id: newUserId,
    org_id: targetOrgId,
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
