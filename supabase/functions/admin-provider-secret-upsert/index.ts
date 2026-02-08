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

const toBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const encryptSecret = async (rawSecret: string, encryptionKey: string): Promise<string> => {
  const encoder = new TextEncoder();
  const keyHash = await crypto.subtle.digest('SHA-256', encoder.encode(encryptionKey));
  const key = await crypto.subtle.importKey('raw', keyHash, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(rawSecret)
  );
  return `${toBase64(iv)}:${toBase64(new Uint8Array(encrypted))}`;
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
  const encryptionKey = Deno.env.get('PROVIDER_CONFIG_ENCRYPTION_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { error: 'Missing Supabase env vars' });
  }
  if (!encryptionKey) {
    return jsonResponse(500, { error: 'Missing PROVIDER_CONFIG_ENCRYPTION_KEY' });
  }

  const authResult = await resolveAuthenticatedUserId(req, supabaseUrl, serviceRoleKey);
  if (!authResult.userId) {
    return jsonResponse(401, { error: authResult.error || 'Invalid auth token' });
  }
  const actorUserId = authResult.userId;

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let payload: { providerConfigurationId?: string; secret?: string; keyVersion?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const providerConfigurationId = payload.providerConfigurationId?.trim();
  const secret = payload.secret?.trim();
  const keyVersion = payload.keyVersion?.trim() || 'v1';
  if (!providerConfigurationId || !secret) {
    return jsonResponse(400, { error: 'Missing required fields' });
  }

  const { data: configuration, error: configurationError } = await supabaseAdmin
    .from('provider_configurations')
    .select('id, store_id, provider_catalog_id')
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
    return jsonResponse(403, { error: 'Only ADMIN can manage provider secrets' });
  }

  const encryptedSecret = await encryptSecret(secret, encryptionKey);

  const { error: upsertSecretError } = await supabaseAdmin.from('provider_secrets').upsert(
    {
      provider_configuration_id: providerConfigurationId,
      encrypted_secret: encryptedSecret,
      key_version: keyVersion,
      updated_by: actorUserId,
    },
    { onConflict: 'provider_configuration_id' }
  );
  if (upsertSecretError) {
    return jsonResponse(400, { error: upsertSecretError.message });
  }

  const { error: configurationUpdateError } = await supabaseAdmin
    .from('provider_configurations')
    .update({
      has_gui_config: true,
      secret_updated_at: new Date().toISOString(),
      updated_by: actorUserId,
      connection_status: 'DISCONNECTED',
    })
    .eq('id', providerConfigurationId);
  if (configurationUpdateError) {
    return jsonResponse(400, { error: configurationUpdateError.message });
  }

  await supabaseAdmin.from('audit_logs').insert({
    org_id: catalog.org_id,
    store_id: configuration.store_id,
    actor_user_id: actorUserId,
    action: 'PROVIDER_SECRET_UPSERT',
    target_type: 'provider_configuration',
    target_id: providerConfigurationId,
    payload: {
      provider_key: catalog.provider_key,
      key_version: keyVersion,
    },
  });

  return jsonResponse(200, {
    ok: true,
    providerConfigurationId,
  });
});
