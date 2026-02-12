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

const fetchJson = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; body: unknown; text: string }> => {
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

const extractProviderErrorMessage = (body: unknown): string => {
  if (!body) return '';
  if (typeof body === 'string') return body;
  if (typeof body !== 'object') return String(body);
  const typed = body as Record<string, unknown>;
  const err = typed.error;
  if (err && typeof err === 'object') {
    const errTyped = err as Record<string, unknown>;
    const message = readString(errTyped, ['message']);
    if (message) return message;
  }
  return readString(typed, ['message']);
};

type DiscoveredFacebookPage = {
  id: string;
  name: string;
};

type DiscoveredInstagramAccount = {
  instagramUserId: string;
  username?: string;
  facebookPageId?: string;
  facebookPageName?: string;
};

const appendInstagramCandidates = (
  instagramMap: Map<string, DiscoveredInstagramAccount>,
  source: Record<string, unknown>,
  pageId: string,
  pageName: string
) => {
  const instaCandidates = [
    source.instagram_business_account && typeof source.instagram_business_account === 'object'
      ? (source.instagram_business_account as Record<string, unknown>)
      : null,
    source.connected_instagram_account && typeof source.connected_instagram_account === 'object'
      ? (source.connected_instagram_account as Record<string, unknown>)
      : null,
  ].filter(Boolean) as Record<string, unknown>[];

  for (const candidate of instaCandidates) {
    const instagramUserId = readString(candidate, ['id']);
    if (!instagramUserId) continue;
    if (instagramMap.has(instagramUserId)) continue;
    instagramMap.set(instagramUserId, {
      instagramUserId,
      username: readString(candidate, ['username']) || undefined,
      facebookPageId: pageId || undefined,
      facebookPageName: pageName || undefined,
    });
  }
};

const discoverMetaTargets = async (
  accessToken: string,
  graphApiVersion: string
): Promise<{
  ok: boolean;
  error?: string;
  facebookPages: DiscoveredFacebookPage[];
  instagramAccounts: DiscoveredInstagramAccount[];
}> => {
  const fields = 'id,name,access_token,instagram_business_account{id,username},connected_instagram_account{id,username}';
  const url = `https://graph.facebook.com/${graphApiVersion}/me/accounts?fields=${encodeURIComponent(fields)}`;
  const result = await fetchJson(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!result.ok) {
    return {
      ok: false,
      error: extractProviderErrorMessage(result.body) || `Meta API エラー（status=${result.status}）`,
      facebookPages: [],
      instagramAccounts: [],
    };
  }

  const body = result.body && typeof result.body === 'object' ? (result.body as Record<string, unknown>) : {};
  const dataRows = Array.isArray(body.data) ? body.data : [];

  const pages: DiscoveredFacebookPage[] = [];
  const instagramMap = new Map<string, DiscoveredInstagramAccount>();
  const pageAccessTokens: { pageId: string; pageName: string; accessToken: string }[] = [];

  for (const row of dataRows) {
    const typed = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
    const pageId = readString(typed, ['id']);
    const pageName = readString(typed, ['name']);
    const pageAccessToken = readString(typed, ['access_token']);
    if (pageId) {
      pages.push({
        id: pageId,
        name: pageName || pageId,
      });
      if (pageAccessToken) {
        pageAccessTokens.push({
          pageId,
          pageName: pageName || pageId,
          accessToken: pageAccessToken,
        });
      }
    }
    appendInstagramCandidates(instagramMap, typed, pageId, pageName);
  }

  if (instagramMap.size === 0) {
    for (const page of pageAccessTokens) {
      const pageUrl = `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(page.pageId)}?fields=${encodeURIComponent('instagram_business_account{id,username},connected_instagram_account{id,username}')}&access_token=${encodeURIComponent(page.accessToken)}`;
      const pageResult = await fetchJson(pageUrl, { method: 'GET' });
      if (!pageResult.ok) {
        continue;
      }
      const pageBody = pageResult.body && typeof pageResult.body === 'object' ? (pageResult.body as Record<string, unknown>) : {};
      appendInstagramCandidates(instagramMap, pageBody, page.pageId, page.pageName);
      if (instagramMap.size > 0) {
        break;
      }
    }
  }

  return {
    ok: true,
    facebookPages: pages,
    instagramAccounts: Array.from(instagramMap.values()),
  };
};

const pickPreferredId = (currentId: string, ids: string[]): string => {
  if (currentId && ids.includes(currentId)) return currentId;
  return ids[0] || '';
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
    .select('id, store_id, provider_catalog_id, config, has_gui_config')
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

  const providerKey = String(catalog.provider_key || '').toUpperCase();
  if (providerKey !== 'FACEBOOK' && providerKey !== 'INSTAGRAM') {
    return jsonResponse(400, { error: 'この機能は Facebook / Instagram のみ対応しています。' });
  }

  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from('memberships')
    .select('role')
    .eq('user_id', actorUserId)
    .eq('org_id', catalog.org_id);
  if (membershipError || !memberships || memberships.length === 0) {
    return jsonResponse(403, { error: 'Not allowed' });
  }
  const isInternal = memberships.some((row: { role: string }) => {
    const role = (row.role || '').toUpperCase();
    return role === 'ADMIN' || role === 'SUPERVISOR';
  });
  if (!isInternal) {
    return jsonResponse(403, { error: 'Only ADMIN/SUPERVISOR can discover provider targets' });
  }

  const integrationProviders = providerKey === 'INSTAGRAM' ? ['INSTAGRAM', 'FACEBOOK'] : ['FACEBOOK'];
  const { data: integrations, error: integrationError } = await supabaseAdmin
    .from('integrations')
    .select('id, provider, status')
    .eq('store_id', configuration.store_id)
    .in('provider', integrationProviders);
  if (integrationError || !integrations || integrations.length === 0) {
    return jsonResponse(400, { error: 'integration が未接続です。先に「連携する」を実行してください。' });
  }

  const preferredIntegration =
    integrations.find((row: { provider: string }) => String(row.provider || '').toUpperCase() === providerKey) || integrations[0];
  const { data: credential, error: credentialError } = await supabaseAdmin
    .from('integration_credentials')
    .select('encrypted_payload')
    .eq('integration_id', preferredIntegration.id)
    .maybeSingle();
  if (credentialError || !credential?.encrypted_payload) {
    return jsonResponse(400, { error: 'OAuthトークンが見つかりません。連携をやり直してください。' });
  }

  const parsedCredential = await parseCredentialPayload(String(credential.encrypted_payload), encryptionKey);
  const accessToken = parsedCredential.accessToken;
  if (!accessToken) {
    return jsonResponse(400, { error: 'access_token が見つかりません。連携をやり直してください。' });
  }

  const rawConfig =
    configuration.has_gui_config && configuration.config && typeof configuration.config === 'object'
      ? (configuration.config as Record<string, unknown>)
      : {};
  const currentConfig = { ...rawConfig };
  const graphApiVersion = readString(currentConfig, ['graph_api_version']) || 'v20.0';

  const discovery = await discoverMetaTargets(accessToken, graphApiVersion);
  if (!discovery.ok) {
    return jsonResponse(400, { error: discovery.error || 'Meta APIから候補取得に失敗しました。' });
  }

  const pageIds = discovery.facebookPages.map((page) => page.id);
  const instagramIds = discovery.instagramAccounts.map((item) => item.instagramUserId);
  const preferredPageId = pickPreferredId(readString(currentConfig, ['facebook_page_id']), pageIds);
  const preferredInstagramId = pickPreferredId(readString(currentConfig, ['instagram_user_id', 'ig_user_id']), instagramIds);

  const preferredInstagram = preferredInstagramId
    ? discovery.instagramAccounts.find((item) => item.instagramUserId === preferredInstagramId) || null
    : null;

  const nextConfig: Record<string, unknown> = {
    ...currentConfig,
    graph_api_version: graphApiVersion,
  };
  let autoApplied = false;

  if (preferredPageId && String(nextConfig.facebook_page_id || '') !== preferredPageId) {
    nextConfig.facebook_page_id = preferredPageId;
    autoApplied = true;
  }

  if (providerKey === 'INSTAGRAM' && preferredInstagramId) {
    if (String(nextConfig.instagram_user_id || '') !== preferredInstagramId) {
      nextConfig.instagram_user_id = preferredInstagramId;
      autoApplied = true;
    }
    if (String(nextConfig.ig_user_id || '') !== preferredInstagramId) {
      nextConfig.ig_user_id = preferredInstagramId;
      autoApplied = true;
    }
  }

  if (!preferredPageId && providerKey === 'FACEBOOK') {
    return jsonResponse(400, { error: 'Facebookページ候補が取得できませんでした。Metaの権限設定を確認してください。' });
  }
  if (providerKey === 'INSTAGRAM' && !preferredInstagramId) {
    return jsonResponse(400, {
      error:
        'Instagramビジネスアカウント候補が取得できませんでした。Facebookページとの紐づけを確認してください。',
      facebookPages: discovery.facebookPages,
    });
  }

  if (autoApplied) {
    const { error: updateError } = await supabaseAdmin
      .from('provider_configurations')
      .update({
        config: nextConfig,
        has_gui_config: true,
        updated_by: actorUserId,
      })
      .eq('id', configuration.id);
    if (updateError) {
      return jsonResponse(400, { error: `設定保存に失敗しました。${updateError.message}` });
    }
  }

  await supabaseAdmin.from('audit_logs').insert({
    org_id: catalog.org_id,
    store_id: configuration.store_id,
    actor_user_id: actorUserId,
    action: 'PROVIDER_TARGET_DISCOVER',
    target_type: 'provider_configuration',
    target_id: configuration.id,
    payload: {
      provider_key: providerKey,
      facebook_pages: discovery.facebookPages.length,
      instagram_accounts: discovery.instagramAccounts.length,
      auto_applied: autoApplied,
      applied_facebook_page_id: nextConfig.facebook_page_id || null,
      applied_instagram_user_id: nextConfig.instagram_user_id || null,
    },
  });

  return jsonResponse(200, {
    ok: true,
    providerKey,
    facebookPages: discovery.facebookPages,
    instagramAccounts: discovery.instagramAccounts,
    autoApplied,
    appliedConfig: nextConfig,
    message: autoApplied
      ? '候補を取得し、利用IDを自動反映しました。'
      : '候補は取得済みです。既存設定がそのまま利用されます。',
  });
});
