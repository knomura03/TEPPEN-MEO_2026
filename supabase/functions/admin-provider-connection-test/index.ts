import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { decodeMaybeEncryptedPayload } from '../_shared/crypto.ts';

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

const readString = (source: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return '';
};

const parseCredentialPayload = async (
  encoded: string,
  encryptionKey: string
): Promise<{ accessToken: string; credentialPayload: Record<string, unknown> }> => {
  try {
    const decodedText = await decodeMaybeEncryptedPayload(encoded, encryptionKey);
    const parsed = JSON.parse(decodedText) as { auth_code?: unknown; credential_payload?: unknown };
    const credentialPayload =
      parsed.credential_payload && typeof parsed.credential_payload === 'object'
        ? (parsed.credential_payload as Record<string, unknown>)
        : {};
    const accessTokenCandidate =
      typeof credentialPayload.access_token === 'string'
        ? credentialPayload.access_token
        : typeof parsed.auth_code === 'string'
          ? parsed.auth_code
          : '';
    return { accessToken: accessTokenCandidate.trim(), credentialPayload };
  } catch {
    return { accessToken: '', credentialPayload: {} };
  }
};

const extractProviderErrorMessage = (body: unknown): string => {
  if (!body) return '';
  if (typeof body === 'string') return body;
  if (typeof body !== 'object') return String(body);
  const typed = body as Record<string, unknown>;
  const err = typed.error;
  if (err && typeof err === 'object') {
    const errTyped = err as Record<string, unknown>;
    if (typeof errTyped.message === 'string' && errTyped.message.trim()) return errTyped.message.trim();
  }
  if (typeof typed.message === 'string' && typed.message.trim()) return typed.message.trim();
  return '';
};

const fetchJson = async (input: RequestInfo | URL, init?: RequestInit): Promise<{ ok: boolean; status: number; body: unknown; text: string }> => {
  const response = await fetch(input, init);
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body, text };
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
    .select('id, store_id, provider_catalog_id, config, has_gui_config, connection_status')
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

  const isInternal = actorMemberships.some((row: { role: string }) => {
    const role = (row.role || '').toUpperCase();
    return role === 'ADMIN' || role === 'SUPERVISOR';
  });
  if (!isInternal) {
    return jsonResponse(403, { error: 'Only ADMIN/SUPERVISOR can test provider connection' });
  }

  const { data: providerSecret, error: secretError } = await supabaseAdmin
    .from('provider_secrets')
    .select('id')
    .eq('provider_configuration_id', providerConfigurationId)
    .maybeSingle();
  if (secretError) {
    return jsonResponse(400, { error: secretError.message });
  }

  const nowIso = new Date().toISOString();
  const hasConfig = Boolean(configuration.has_gui_config);
  const hasSecret = Boolean(providerSecret?.id);

  const { data: integration, error: integrationError } = await supabaseAdmin
    .from('integrations')
    .select('id, status')
    .eq('store_id', configuration.store_id)
    .eq('provider', catalog.provider_key)
    .maybeSingle();
  if (integrationError) {
    return jsonResponse(400, { error: integrationError.message });
  }

  const { data: credential, error: credentialError } = integration?.id
    ? await supabaseAdmin
      .from('integration_credentials')
      .select('encrypted_payload')
      .eq('integration_id', integration.id)
      .maybeSingle()
    : { data: null, error: null };
  if (credentialError) {
    return jsonResponse(400, { error: credentialError.message });
  }

  const hasCredential = Boolean(credential?.encrypted_payload);
  let connectionStatus: 'CONNECTED' | 'ERROR' = 'ERROR';
  let lastError: string | null = null;

  if (!hasConfig || !hasSecret) {
    connectionStatus = 'ERROR';
    lastError = 'GUI設定またはシークレットが不足しています。';
  } else if (!integration?.id || integration.status !== 'CONNECTED') {
    connectionStatus = 'ERROR';
    lastError = 'integration が未接続です。まず「連携する」を実行してください。';
  } else if (!hasCredential) {
    connectionStatus = 'ERROR';
    lastError = 'OAuthトークンが見つかりません。連携をやり直してください。';
  } else {
    const config = configuration.has_gui_config && configuration ? (configuration as { config?: unknown }).config : {};
    const configObject = config && typeof config === 'object' ? (config as Record<string, unknown>) : {};
    const graphApiVersion = readString(configObject, ['graph_api_version']) || 'v20.0';

    const parsedCredential = await parseCredentialPayload(String(credential?.encrypted_payload || ''), encryptionKey);
    const accessToken = parsedCredential.accessToken;
    if (!accessToken) {
      connectionStatus = 'ERROR';
      lastError = 'access_token が見つかりません。連携をやり直してください。';
    } else {
      const providerKey = String(catalog.provider_key || '').toUpperCase();
      if (providerKey === 'GBP') {
        const result = await fetchJson('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (result.ok) {
          connectionStatus = 'CONNECTED';
          lastError = null;
        } else {
          connectionStatus = 'ERROR';
          lastError = extractProviderErrorMessage(result.body) || `GBP API エラー（status=${result.status}）`;
        }
      } else if (providerKey === 'FACEBOOK') {
        const result = await fetchJson(`https://graph.facebook.com/${graphApiVersion}/me/accounts?fields=id,name`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (result.ok) {
          connectionStatus = 'CONNECTED';
          lastError = null;
        } else {
          connectionStatus = 'ERROR';
          lastError = extractProviderErrorMessage(result.body) || `Facebook API エラー（status=${result.status}）`;
        }
      } else if (providerKey === 'INSTAGRAM') {
        const igUserId = readString(configObject, ['ig_user_id', 'instagram_user_id']);
        if (!igUserId) {
          connectionStatus = 'ERROR';
          lastError = 'instagram_user_id（または ig_user_id）が未設定です。';
        } else {
          const result = await fetchJson(`https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(igUserId)}?fields=id,username`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (result.ok) {
            connectionStatus = 'CONNECTED';
            lastError = null;
          } else {
            connectionStatus = 'ERROR';
            lastError = extractProviderErrorMessage(result.body) || `Instagram API エラー（status=${result.status}）`;
          }
        }
      } else {
        connectionStatus = 'ERROR';
        lastError = '未対応のproviderです。';
      }
    }
  }

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
