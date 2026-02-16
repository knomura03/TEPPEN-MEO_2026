import { resolveAuthenticatedUserId } from '../_shared/auth.ts';
import { parseCredentialEnvelope } from '../_shared/integrationCredentials.ts';
import { extractProviderErrorMessage, fetchJson, jsonResponse, optionsResponse, readString, toFormBody } from '../_shared/http.ts';
import { resolveMetaPageAccessToken } from '../_shared/metaAuth.ts';
import { createServiceRoleClient, requireEnv } from '../_shared/supabase.ts';

const isAllowedRole = (role: string): boolean => {
  const normalized = (role || '').toUpperCase();
  return normalized === 'ADMIN' || normalized === 'SUPERVISOR' || normalized === 'MANAGER';
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return optionsResponse();
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  let runtime;
  let encryptionKey = '';
  try {
    runtime = createServiceRoleClient();
    encryptionKey = requireEnv('PROVIDER_CONFIG_ENCRYPTION_KEY');
  } catch (error) {
    return jsonResponse(500, { error: error instanceof Error ? error.message : 'Missing env vars' });
  }

  const authResult = await resolveAuthenticatedUserId(req, runtime.supabaseUrl, runtime.serviceRoleKey);
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

  const supabaseAdmin = runtime.client;
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
    if (inboxMessage.provider !== 'INSTAGRAM') {
      return jsonResponse(400, { error: 'Message provider is not INSTAGRAM' });
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
  if (membershipError || !memberships || memberships.length === 0 || !memberships.some((row: { role: string }) => isAllowedRole(row.role))) {
    return jsonResponse(403, { error: 'Not allowed' });
  }

  const { data: providerCatalog, error: providerCatalogError } = await supabaseAdmin
    .from('provider_catalog')
    .select('id')
    .eq('org_id', store.org_id)
    .eq('provider_key', 'INSTAGRAM')
    .eq('is_active', true)
    .maybeSingle();
  if (providerCatalogError || !providerCatalog) {
    return jsonResponse(400, { error: 'INSTAGRAM provider catalog not found' });
  }

  const { data: configuration, error: configurationError } = await supabaseAdmin
    .from('provider_configurations')
    .select('id, config, has_gui_config, connection_status')
    .eq('store_id', resolvedStoreId)
    .eq('provider_catalog_id', providerCatalog.id)
    .maybeSingle();
  if (configurationError || !configuration) {
    return jsonResponse(400, { error: 'Instagram provider configuration not found' });
  }
  if (!configuration.has_gui_config || configuration.connection_status !== 'CONNECTED') {
    return jsonResponse(400, { error: 'Instagram provider is not connected' });
  }

  const { data: integration, error: integrationError } = await supabaseAdmin
    .from('integrations')
    .select('id, status')
    .eq('store_id', resolvedStoreId)
    .eq('provider', 'INSTAGRAM')
    .maybeSingle();
  if (integrationError || !integration || integration.status !== 'CONNECTED') {
    return jsonResponse(400, { error: 'INSTAGRAM integration is not connected' });
  }

  const { data: credential, error: credentialError } = await supabaseAdmin
    .from('integration_credentials')
    .select('encrypted_payload')
    .eq('integration_id', integration.id)
    .maybeSingle();
  if (credentialError || !credential?.encrypted_payload) {
    return jsonResponse(400, { error: 'Instagram credential not found' });
  }

  const envelope = await parseCredentialEnvelope(String(credential.encrypted_payload), encryptionKey);
  const userAccessToken = readString(envelope.credentialPayload, ['access_token']) || envelope.accessToken;
  if (!userAccessToken) {
    return jsonResponse(400, { error: 'Instagram access token is missing' });
  }

  const config = configuration.config && typeof configuration.config === 'object' ? (configuration.config as Record<string, unknown>) : {};
  const graphApiVersion = readString(config, ['graph_api_version']) || 'v20.0';
  const preferredPageId = readString(config, ['facebook_page_id', 'fb_page_id', 'page_id']);
  const pageTokenResult = await resolveMetaPageAccessToken({
    userAccessToken,
    graphApiVersion,
    preferredPageId: preferredPageId || undefined,
  });
  const accessToken = pageTokenResult.ok && pageTokenResult.pageAccessToken ? pageTokenResult.pageAccessToken : userAccessToken;

  const replyResponse = await fetchJson(`https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(resolvedExternalMessageId)}/replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: toFormBody({
      message: replyText,
      access_token: accessToken,
    }),
  });

  if (!replyResponse.ok) {
    return jsonResponse(400, {
      error: extractProviderErrorMessage(replyResponse.body) || 'Instagram replyに失敗しました。',
      details: replyResponse.body,
    });
  }

  const body = replyResponse.body && typeof replyResponse.body === 'object' ? (replyResponse.body as Record<string, unknown>) : {};
  const externalReplyId = readString(body, ['id']);
  if (!externalReplyId) {
    return jsonResponse(400, { error: 'Instagram reply ID の取得に失敗しました。' });
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
    .eq('provider', 'INSTAGRAM')
    .eq('external_message_id', resolvedExternalMessageId);

  await supabaseAdmin.from('audit_logs').insert({
    org_id: store.org_id,
    store_id: resolvedStoreId,
    actor_user_id: actorUserId,
    action: 'INSTAGRAM_REPLY',
    target_type: messageId ? 'inbox_message' : 'inbox_message_external',
    target_id: targetMessageId,
    payload: {
      external_reply_id: externalReplyId,
      external_message_id: resolvedExternalMessageId,
      mode: 'REAL',
    },
  });

  return jsonResponse(200, {
    ok: true,
    provider: 'INSTAGRAM',
    mode: 'REAL',
    externalReplyId,
  });
});
