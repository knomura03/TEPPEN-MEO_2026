import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { resolveAuthenticatedUserId } from '../_shared/auth.ts';
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

  let payload: { messageId?: string; storeId?: string; externalMessageId?: string; replyText?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const messageId = payload.messageId?.trim();
  const storeIdFromPayload = payload.storeId?.trim();
  const externalMessageIdFromPayload = payload.externalMessageId?.trim();
  const replyText = payload.replyText?.trim();
  if (!replyText) {
    return jsonResponse(400, { error: 'Missing replyText' });
  }
  if (!messageId && !(storeIdFromPayload && externalMessageIdFromPayload)) {
    return jsonResponse(400, { error: 'Missing messageId or (storeId + externalMessageId)' });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let resolvedStoreId = storeIdFromPayload || '';
  let resolvedExternalMessageId = externalMessageIdFromPayload || '';
  let targetMessageId = messageId || externalMessageIdFromPayload || '';

  if (messageId) {
    const { data: inboxMessage, error: inboxError } = await supabaseAdmin
      .from('inbox_messages')
      .select('id, store_id, provider, external_message_id, is_replied')
      .eq('id', messageId)
      .maybeSingle();
    if (inboxError || !inboxMessage) {
      return jsonResponse(404, { error: 'Inbox message not found' });
    }
    if (inboxMessage.provider !== 'FACEBOOK') {
      return jsonResponse(400, { error: 'Message provider is not FACEBOOK' });
    }
    if (inboxMessage.is_replied) {
      return jsonResponse(400, { error: 'Message already replied' });
    }
    if (!inboxMessage.store_id || !inboxMessage.external_message_id) {
      return jsonResponse(400, { error: 'Message store/external ID is missing' });
    }
    resolvedStoreId = inboxMessage.store_id;
    resolvedExternalMessageId = inboxMessage.external_message_id;
    targetMessageId = inboxMessage.id;
  }

  if (!resolvedStoreId || !resolvedExternalMessageId) {
    return jsonResponse(400, { error: 'Missing storeId or externalMessageId' });
  }

  const { data: store, error: storeError } = await supabaseAdmin
    .from('stores')
    .select('id, org_id')
    .eq('id', resolvedStoreId)
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
  const canReply = memberships.some((row: { role: string }) => {
    const role = (row.role || '').toUpperCase();
    return role === 'ADMIN' || role === 'SUPERVISOR' || role === 'MANAGER';
  });
  if (!canReply) {
    return jsonResponse(403, { error: 'Only ADMIN/SUPERVISOR/MANAGER can reply to Facebook messages' });
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
    .eq('store_id', resolvedStoreId)
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
    .eq('store_id', resolvedStoreId)
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

  const replyResponse = await fetch(`${graphBaseUrl}/${resolvedExternalMessageId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: toFormBody({
      message: replyText,
      access_token: accessToken,
    }),
  });

  const replyBodyText = await replyResponse.text();
  let replyBody: Record<string, unknown> = {};
  try {
    replyBody = replyBodyText ? (JSON.parse(replyBodyText) as Record<string, unknown>) : {};
  } catch {
    replyBody = {};
  }

  if (!replyResponse.ok) {
    return jsonResponse(400, {
      error: (replyBody.error as { message?: string } | undefined)?.message || 'Facebook replyに失敗しました。',
      details: replyBody,
    });
  }

  const externalReplyId = typeof replyBody.id === 'string' ? replyBody.id : '';
  if (!externalReplyId) {
    return jsonResponse(400, { error: 'Facebook reply ID の取得に失敗しました。' });
  }

  const replySentAtIso = new Date().toISOString();
  await supabaseAdmin
    .from('inbox_messages')
    .update({
      is_replied: true,
      reply_content: replyText,
      reply_sent_at: replySentAtIso,
      sla_status: 'COMPLETED',
    })
    .eq('store_id', resolvedStoreId)
    .eq('provider', 'FACEBOOK')
    .eq('external_message_id', resolvedExternalMessageId);

  await supabaseAdmin.from('audit_logs').insert({
      org_id: store.org_id,
      store_id: resolvedStoreId,
      actor_user_id: actorUserId,
      action: 'FACEBOOK_REPLY',
      target_type: messageId ? 'inbox_message' : 'inbox_message_external',
      target_id: targetMessageId,
      payload: {
        external_reply_id: externalReplyId,
        external_message_id: resolvedExternalMessageId,
        page_id: pageId,
        mode: 'REAL',
      },
  });

  return jsonResponse(200, {
    ok: true,
    provider: 'FACEBOOK',
    mode: 'REAL',
    externalReplyId,
  });
});
