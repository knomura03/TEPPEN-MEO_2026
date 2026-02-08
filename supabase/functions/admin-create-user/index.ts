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

const findUserIdByEmail = async (
  supabaseAdmin: ReturnType<typeof createClient>,
  email: string
): Promise<string | null> => {
  const normalized = email.trim().toLowerCase();
  // Fallback only. This is used when createUser fails due to an existing account.
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users) return null;
    const found = data.users.find((u: { email?: string | null }) => (u.email || '').toLowerCase() === normalized);
    if (found?.id) return found.id;
    if (data.users.length < 1000) break;
  }
  return null;
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

  let payload: {
    email?: string;
    name?: string;
    role?: string;
    storeId?: string;
    orgId?: string;
    // Optional: when provided, create/update the user with a known password (no invite email).
    password?: string;
  };
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
  const password = payload.password?.trim();

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

  let newUserId: string;
  if (password && password.length > 0) {
    // For deterministic automation (e.g., audits), allow provisioning with a known password.
    // This does not send an invite email.
    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });

    if (createError || !created?.user?.id) {
      const existingUserId = await findUserIdByEmail(supabaseAdmin, email);
      if (!existingUserId) {
        return jsonResponse(400, { error: createError?.message || 'Failed to create user' });
      }
      const { data: updated, error: updateError } = await supabaseAdmin.auth.admin.updateUserById(existingUserId, {
        password,
        email_confirm: true,
        user_metadata: { name },
      });
      if (updateError || !updated?.user?.id) {
        return jsonResponse(400, { error: updateError?.message || 'Failed to update user' });
      }
      newUserId = existingUserId;
    } else {
      newUserId = created.user.id;
    }
  } else {
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { name },
    });
    if (inviteError || !inviteData?.user?.id) {
      return jsonResponse(400, { error: inviteError?.message || 'Failed to invite user' });
    }
    newUserId = inviteData.user.id;
  }

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
  const { data: existingMembership, error: existingMembershipError } = await supabaseAdmin
    .from('memberships')
    .select('id')
    .eq('user_id', newUserId)
    .eq('org_id', targetOrgId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existingMembershipError) {
    return jsonResponse(400, { error: existingMembershipError.message });
  }

  if (existingMembership?.id) {
    const { error: membershipUpdateError } = await supabaseAdmin
      .from('memberships')
      .update({ store_id: membershipStoreId, role })
      .eq('id', existingMembership.id);
    if (membershipUpdateError) {
      return jsonResponse(400, { error: membershipUpdateError.message });
    }
  } else {
    const { error: membershipInsertError } = await supabaseAdmin.from('memberships').insert({
      user_id: newUserId,
      org_id: targetOrgId,
      store_id: membershipStoreId,
      role,
    });
    if (membershipInsertError) {
      return jsonResponse(400, { error: membershipInsertError.message });
    }
  }

  return jsonResponse(200, {
    ok: true,
    userId: newUserId,
  });
});
