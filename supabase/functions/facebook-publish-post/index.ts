import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { decodeMaybeEncryptedPayload } from '../_shared/crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });

const extractBearerToken = (headerValue: string | null): string => {
  if (!headerValue) return '';
  const matched = headerValue.match(/Bearer\s+([^,\s]+)/i);
  if (matched?.[1]) return matched[1].trim();
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
    return {
      accessToken: accessTokenCandidate.trim(),
      credentialPayload,
    };
  } catch {
    return { accessToken: '', credentialPayload: {} };
  }
};

const toFormBody = (input: Record<string, string>) => {
  const body = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    body.append(key, value);
  });
  return body.toString();
};

const readString = (source: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return '';
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

  let payload: { postId?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const postId = payload.postId?.trim();
  if (!postId) {
    return jsonResponse(400, { error: 'Missing postId' });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: post, error: postError } = await supabaseAdmin
    .from('posts')
    .select('id, store_id, content, platforms')
    .eq('id', postId)
    .maybeSingle();
  if (postError || !post) {
    return jsonResponse(404, { error: 'Post not found' });
  }
  const platforms = Array.isArray(post.platforms) ? post.platforms.map((v) => String(v).toUpperCase()) : [];
  if (!platforms.includes('FACEBOOK')) {
    return jsonResponse(400, { error: 'Post does not target FACEBOOK' });
  }

  const { data: store, error: storeError } = await supabaseAdmin
    .from('stores')
    .select('id, org_id')
    .eq('id', post.store_id)
    .maybeSingle();
  if (storeError || !store) {
    return jsonResponse(404, { error: 'Store not found' });
  }

  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from('memberships')
    .select('role')
    .eq('user_id', actorUserId)
    .eq('org_id', store.org_id);
  if (membershipError || !memberships || memberships.length === 0) {
    return jsonResponse(403, { error: 'Not allowed' });
  }
  const canPublish = memberships.some((row: { role: string }) => {
    const role = (row.role || '').toUpperCase();
    return role === 'ADMIN' || role === 'SUPERVISOR' || role === 'MANAGER';
  });
  if (!canPublish) {
    return jsonResponse(403, { error: 'Only ADMIN/SUPERVISOR/MANAGER can publish to Facebook' });
  }

  const { data: providerCatalog, error: providerCatalogError } = await supabaseAdmin
    .from('provider_catalog')
    .select('id')
    .eq('org_id', store.org_id)
    .eq('provider_key', 'FACEBOOK')
    .eq('is_active', true)
    .maybeSingle();
  if (providerCatalogError || !providerCatalog) {
    return jsonResponse(400, { error: 'FACEBOOK provider catalog not found' });
  }

  const { data: configuration, error: configurationError } = await supabaseAdmin
    .from('provider_configurations')
    .select('id, config, has_gui_config, connection_status')
    .eq('store_id', post.store_id)
    .eq('provider_catalog_id', providerCatalog.id)
    .maybeSingle();
  if (configurationError || !configuration) {
    return jsonResponse(400, { error: 'Facebook provider configuration not found' });
  }
  if (!configuration.has_gui_config || configuration.connection_status !== 'CONNECTED') {
    return jsonResponse(400, { error: 'Facebook provider is not connected' });
  }

  const config = configuration.config && typeof configuration.config === 'object' ? configuration.config : {};
  const configObject = config as Record<string, unknown>;

  const { data: integration, error: integrationError } = await supabaseAdmin
    .from('integrations')
    .select('id, status')
    .eq('store_id', post.store_id)
    .eq('provider', 'FACEBOOK')
    .maybeSingle();
  if (integrationError || !integration || integration.status !== 'CONNECTED') {
    return jsonResponse(400, { error: 'FACEBOOK integration is not connected' });
  }

  const { data: credential, error: credentialError } = await supabaseAdmin
    .from('integration_credentials')
    .select('encrypted_payload')
    .eq('integration_id', integration.id)
    .maybeSingle();
  if (credentialError || !credential) {
    return jsonResponse(400, { error: 'Facebook credential not found' });
  }

  const parsedCredential = await parseCredentialPayload(String(credential.encrypted_payload || ''), encryptionKey);
  const accessToken = parsedCredential.accessToken;
  if (!accessToken) {
    return jsonResponse(400, { error: 'Facebook access token is missing' });
  }

  const pageId = readString(configObject, ['fb_page_id', 'facebook_page_id', 'page_id'])
    || readString(parsedCredential.credentialPayload, ['fb_page_id', 'facebook_page_id', 'page_id']);
  if (!pageId) {
    return jsonResponse(400, { error: 'Facebook page id is required in provider config' });
  }

  const configuredVersion = readString(configObject, ['graph_api_version']);
  const apiVersion = configuredVersion || 'v20.0';
  const graphBaseUrl = `https://graph.facebook.com/${apiVersion}`;

  const publishResponse = await fetch(`${graphBaseUrl}/${pageId}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: toFormBody({
      message: String(post.content || ''),
      access_token: accessToken,
    }),
  });

  const publishBodyText = await publishResponse.text();
  let publishBody: Record<string, unknown> = {};
  try {
    publishBody = publishBodyText ? (JSON.parse(publishBodyText) as Record<string, unknown>) : {};
  } catch {
    publishBody = {};
  }

  if (!publishResponse.ok) {
    return jsonResponse(400, {
      error: (publishBody.error as { message?: string } | undefined)?.message || 'Facebook publishに失敗しました。',
      details: publishBody,
    });
  }

  const externalPostId = typeof publishBody.id === 'string' ? publishBody.id : '';
  if (!externalPostId) {
    return jsonResponse(400, { error: 'Facebook post ID の取得に失敗しました。' });
  }

  await supabaseAdmin.from('audit_logs').insert({
    org_id: store.org_id,
    store_id: post.store_id,
    actor_user_id: actorUserId,
    action: 'FACEBOOK_PUBLISH',
    target_type: 'post',
    target_id: post.id,
    payload: {
      external_post_id: externalPostId,
      page_id: pageId,
      mode: 'REAL',
    },
  });

  return jsonResponse(200, {
    ok: true,
    provider: 'FACEBOOK',
    mode: 'REAL',
    externalPostId,
  });
});
