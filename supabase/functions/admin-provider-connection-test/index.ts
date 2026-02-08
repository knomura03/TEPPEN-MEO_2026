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

  let payload: { providerConfigurationId?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const providerConfigurationId = payload.providerConfigurationId?.trim();
  if (!providerConfigurationId) {
    return jsonResponse(400, { error: 'Missing providerConfigurationId' });
  }

  const { data: configuration, error: configurationError } = await supabaseAdmin
    .from('provider_configurations')
    .select('id, store_id, provider_catalog_id, has_gui_config')
    .eq('id', providerConfigurationId)
    .maybeSingle();
  if (configurationError || !configuration) {
    return jsonResponse(404, { error: 'provider configuration not found' });
  }

  const { data: catalog, error: catalogError } = await supabaseAdmin
    .from('provider_catalog')
    .select('id, org_id, provider_key')
    .eq('id', configuration.provider_catalog_id)
    .maybeSingle();
  if (catalogError || !catalog) {
    return jsonResponse(404, { error: 'provider catalog not found' });
  }

  const { data: actorMemberships, error: actorMembershipError } = await supabaseAdmin
    .from('memberships')
    .select('role')
    .eq('user_id', actorUserId)
    .eq('org_id', catalog.org_id);
  if (actorMembershipError || !actorMemberships || actorMemberships.length === 0) {
    return jsonResponse(403, { error: 'Not allowed' });
  }

  const isAdmin = actorMemberships.some((row: { role: string }) => row.role?.toUpperCase() === 'ADMIN');
  if (!isAdmin) {
    return jsonResponse(403, { error: 'Only ADMIN can test provider connection' });
  }

  const { data: secret, error: secretError } = await supabaseAdmin
    .from('provider_secrets')
    .select('id')
    .eq('provider_configuration_id', providerConfigurationId)
    .maybeSingle();
  if (secretError) {
    return jsonResponse(400, { error: secretError.message });
  }

  const nowIso = new Date().toISOString();
  const hasConfig = Boolean(configuration.has_gui_config);
  const hasSecret = Boolean(secret?.id);
  const connectionStatus = hasConfig && hasSecret ? 'CONNECTED' : 'ERROR';
  const lastError = connectionStatus === 'CONNECTED' ? null : 'GUI設定またはシークレットが不足しています。';

  const { error: updateConfigurationError } = await supabaseAdmin
    .from('provider_configurations')
    .update({
      connection_status: connectionStatus,
      last_tested_at: nowIso,
      last_error: lastError,
      updated_by: actorUserId,
    })
    .eq('id', providerConfigurationId);
  if (updateConfigurationError) {
    return jsonResponse(400, { error: updateConfigurationError.message });
  }

  const { error: integrationUpsertError } = await supabaseAdmin.from('integrations').upsert(
    {
      store_id: configuration.store_id,
      provider: catalog.provider_key,
      status: connectionStatus,
      last_sync_at: connectionStatus === 'CONNECTED' ? nowIso : null,
      last_error: lastError,
    },
    { onConflict: 'store_id,provider' }
  );
  if (integrationUpsertError) {
    return jsonResponse(400, { error: integrationUpsertError.message });
  }

  await supabaseAdmin.from('audit_logs').insert({
    org_id: catalog.org_id,
    store_id: configuration.store_id,
    actor_user_id: actorUserId,
    action: 'PROVIDER_CONNECTION_TEST',
    target_type: 'provider_configuration',
    target_id: providerConfigurationId,
    payload: {
      provider_key: catalog.provider_key,
      connection_status: connectionStatus,
      has_config: hasConfig,
      has_secret: hasSecret,
    },
  });

  return jsonResponse(200, {
    ok: true,
    providerConfigurationId,
    connectionStatus,
    lastError,
  });
});
