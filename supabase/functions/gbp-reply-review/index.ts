import { resolveAuthenticatedUserId } from '../_shared/auth.ts';
import { decryptAesGcm } from '../_shared/crypto.ts';
import { ensureGoogleAccessToken } from '../_shared/googleAuth.ts';
import { resolveAndPersistGbpLocation } from '../_shared/googleLocation.ts';
import { extractProviderErrorMessage, fetchJson, jsonResponse, optionsResponse, readString } from '../_shared/http.ts';
import { createServiceRoleClient, requireEnv } from '../_shared/supabase.ts';

const isAllowedRole = (role: string): boolean => {
  const normalized = (role || '').toUpperCase();
  return normalized === 'ADMIN' || normalized === 'SUPERVISOR' || normalized === 'MANAGER';
};

const parseReviewResourceName = (params: {
  externalMessageId: string;
  accountId?: string;
  locationId?: string;
}): string => {
  const raw = (params.externalMessageId || '').trim().replace(/^\/+/, '');
  if (!raw) return '';
  if (raw.startsWith('accounts/') && raw.includes('/reviews/')) return raw;
  if (raw.startsWith('locations/')) return '';

  const accountId = (params.accountId || '').trim();
  const locationId = (params.locationId || '').trim();
  if (!accountId || !locationId) return '';
  return `accounts/${accountId}/locations/${locationId}/reviews/${raw}`;
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
    if (inboxMessage.provider !== 'GBP') {
      return jsonResponse(400, { error: 'Message provider is not GBP' });
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
    .eq('provider_key', 'GBP')
    .eq('is_active', true)
    .maybeSingle();
  if (providerCatalogError || !providerCatalog) {
    return jsonResponse(400, { error: 'GBP provider catalog not found' });
  }

  const { data: configuration, error: configurationError } = await supabaseAdmin
    .from('provider_configurations')
    .select('id, config, has_gui_config, connection_status')
    .eq('store_id', resolvedStoreId)
    .eq('provider_catalog_id', providerCatalog.id)
    .maybeSingle();
  if (configurationError || !configuration) {
    return jsonResponse(400, { error: 'GBP provider configuration not found' });
  }
  if (!configuration.has_gui_config || configuration.connection_status !== 'CONNECTED') {
    return jsonResponse(400, { error: 'GBP provider is not connected' });
  }

  const { data: integration, error: integrationError } = await supabaseAdmin
    .from('integrations')
    .select('id, status')
    .eq('store_id', resolvedStoreId)
    .eq('provider', 'GBP')
    .maybeSingle();
  if (integrationError || !integration || integration.status !== 'CONNECTED') {
    return jsonResponse(400, { error: 'GBP integration is not connected' });
  }

  const { data: credential, error: credentialError } = await supabaseAdmin
    .from('integration_credentials')
    .select('encrypted_payload')
    .eq('integration_id', integration.id)
    .maybeSingle();
  if (credentialError || !credential?.encrypted_payload) {
    return jsonResponse(400, { error: 'GBP credential not found' });
  }

  const { data: secret, error: secretError } = await supabaseAdmin
    .from('provider_secrets')
    .select('encrypted_secret')
    .eq('provider_configuration_id', configuration.id)
    .maybeSingle();
  if (secretError || !secret?.encrypted_secret) {
    return jsonResponse(400, { error: 'GBP client_secret が未設定です。' });
  }

  const providerSecret = await decryptAesGcm(String(secret.encrypted_secret), encryptionKey);
  const config = configuration.config && typeof configuration.config === 'object' ? (configuration.config as Record<string, unknown>) : {};
  const clientId = readString(config, ['client_id', 'google_client_id']);
  if (!clientId) {
    return jsonResponse(400, { error: 'GBP client_id が未設定です。' });
  }

  const token = await ensureGoogleAccessToken({
    supabaseAdmin,
    integrationId: integration.id,
    encryptedPayload: String(credential.encrypted_payload),
    encryptionKey,
    clientId,
    clientSecret: providerSecret,
  });
  if (!token.ok || !token.accessToken) {
    return jsonResponse(400, { error: token.error || 'GBP access_token の取得に失敗しました。' });
  }

  const location = await resolveAndPersistGbpLocation({
    supabaseAdmin,
    providerConfigurationId: configuration.id,
    config,
    accessToken: token.accessToken,
  });
  if (!location.ok) {
    return jsonResponse(400, { error: location.error || 'GBP店舗情報の解決に失敗しました。' });
  }

  const accountId = location.accountId || readString(config, ['gbp_account_id', 'account_id']);
  const locationId = location.locationId || readString(config, ['gbp_location_id', 'location_id']);
  const reviewResourceName = parseReviewResourceName({
    externalMessageId: resolvedExternalMessageId,
    accountId,
    locationId,
  });
  if (!reviewResourceName) {
    return jsonResponse(400, { error: 'GBP review ID の解決に失敗しました。' });
  }

  const replyResponse = await fetchJson(`https://mybusiness.googleapis.com/v4/${reviewResourceName}/reply`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ comment: replyText }),
  });

  if (!replyResponse.ok) {
    return jsonResponse(400, {
      error: extractProviderErrorMessage(replyResponse.body) || 'GBP replyに失敗しました。',
      details: replyResponse.body,
    });
  }

  const replyBody = replyResponse.body && typeof replyResponse.body === 'object' ? (replyResponse.body as Record<string, unknown>) : {};
  const externalReplyId = readString(replyBody, ['name']) || `${reviewResourceName}/reply`;

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
    .eq('provider', 'GBP')
    .eq('external_message_id', resolvedExternalMessageId);

  await supabaseAdmin.from('audit_logs').insert({
    org_id: store.org_id,
    store_id: resolvedStoreId,
    actor_user_id: actorUserId,
    action: 'GBP_REPLY',
    target_type: messageId ? 'inbox_message' : 'inbox_message_external',
    target_id: targetMessageId,
    payload: {
      external_reply_id: externalReplyId,
      external_message_id: resolvedExternalMessageId,
      review_resource_name: reviewResourceName,
      mode: 'REAL',
    },
  });

  return jsonResponse(200, {
    ok: true,
    provider: 'GBP',
    mode: 'REAL',
    externalReplyId,
  });
});
