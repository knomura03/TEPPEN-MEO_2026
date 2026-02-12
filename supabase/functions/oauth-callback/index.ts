import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { decodeMaybeEncryptedPayload, decryptAesGcm, encryptAesGcm } from '../_shared/crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const extractErrorMessage = (input: unknown): string => {
  if (!input) return '';
  if (typeof input === 'string') return input.trim();
  if (typeof input === 'object') {
    const typed = input as Record<string, unknown>;
    if (typeof typed.message === 'string') return typed.message.trim();
  }
  return '';
};

const extractMetaErrorMessage = (input: Record<string, unknown>): string => {
  const errorObj = input.error && typeof input.error === 'object' ? (input.error as Record<string, unknown>) : null;
  const message = extractErrorMessage(errorObj || input);
  const code =
    errorObj && typeof errorObj.code === 'number'
      ? String(errorObj.code)
      : errorObj && typeof errorObj.code === 'string'
        ? errorObj.code.trim()
        : '';
  const subcode =
    errorObj && typeof errorObj.error_subcode === 'number'
      ? String(errorObj.error_subcode)
      : errorObj && typeof errorObj.error_subcode === 'string'
        ? errorObj.error_subcode.trim()
        : '';
  const details = [code ? `code=${code}` : '', subcode ? `subcode=${subcode}` : ''].filter(Boolean).join(', ');
  if (!message) return '';
  return details ? `${message} (${details})` : message;
};

const readString = (source: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return '';
};

const toFormBody = (input: Record<string, string>) => {
  const body = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => body.append(key, value));
  return body.toString();
};

const resolveSafeReturnTo = (returnToCandidate: string | null, fallback: string | null): string | null => {
  const normalize = (candidate: string): string | null => {
    try {
      const url = new URL(candidate);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      url.hash = '';
      return url.toString();
    } catch {
      return null;
    }
  };
  const normalizedCandidate = returnToCandidate ? normalize(returnToCandidate) : null;
  if (normalizedCandidate) return normalizedCandidate;
  const normalizedFallback = fallback ? normalize(fallback) : null;
  if (normalizedFallback) return normalizedFallback;
  return null;
};

const redirectTo = (targetUrl: string, params: Record<string, string>): Response => {
  const url = new URL(targetUrl);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return Response.redirect(url.toString(), 302);
};

type OAuthSessionRow = {
  id: string;
  store_id: string;
  provider: string;
  actor_user_id: string | null;
  state_token: string;
  status: string;
  expires_at: string;
  metadata: Record<string, unknown>;
};

type TokenExchangeResult = {
  ok: boolean;
  error?: string;
  credentialPayload?: Record<string, unknown>;
};

const exchangeGoogleToken = async (params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<TokenExchangeResult> => {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: toFormBody({
      code: params.code,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = {};
  }

  if (!response.ok) {
    return { ok: false, error: extractErrorMessage(body.error) || extractErrorMessage(body) || 'Google token交換に失敗しました。' };
  }

  const accessToken = typeof body.access_token === 'string' ? body.access_token.trim() : '';
  if (!accessToken) {
    return { ok: false, error: 'Google access_token が取得できませんでした。' };
  }

  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : typeof body.expires_in === 'string' ? Number(body.expires_in) : 0;
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
  return {
    ok: true,
    credentialPayload: {
      access_token: accessToken,
      refresh_token: typeof body.refresh_token === 'string' ? body.refresh_token.trim() : undefined,
      token_type: typeof body.token_type === 'string' ? body.token_type.trim() : undefined,
      scope: typeof body.scope === 'string' ? body.scope.trim() : undefined,
      expires_in: expiresIn || undefined,
      expires_at: expiresAt || undefined,
      obtained_at: new Date().toISOString(),
    },
  };
};

const exchangeMetaToken = async (params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  graphApiVersion: string;
}): Promise<TokenExchangeResult> => {
  const baseUrl = `https://graph.facebook.com/${params.graphApiVersion}`;

  const shortLivedUrl = `${baseUrl}/oauth/access_token?${toFormBody({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    code: params.code,
  })}`;
  const shortLivedResponse = await fetch(shortLivedUrl, { method: 'GET' });
  const shortText = await shortLivedResponse.text();
  let shortBody: Record<string, unknown> = {};
  try {
    shortBody = shortText ? (JSON.parse(shortText) as Record<string, unknown>) : {};
  } catch {
    shortBody = {};
  }

  if (!shortLivedResponse.ok) {
    return {
      ok: false,
      error: extractMetaErrorMessage(shortBody) || `Meta token交換に失敗しました。（status=${shortLivedResponse.status}）`,
    };
  }

  const shortToken = typeof shortBody.access_token === 'string' ? shortBody.access_token.trim() : '';
  if (!shortToken) {
    return { ok: false, error: 'Meta access_token が取得できませんでした。' };
  }

  const longLivedUrl = `${baseUrl}/oauth/access_token?${toFormBody({
    grant_type: 'fb_exchange_token',
    client_id: params.clientId,
    client_secret: params.clientSecret,
    fb_exchange_token: shortToken,
  })}`;
  const longLivedResponse = await fetch(longLivedUrl, { method: 'GET' });
  const longText = await longLivedResponse.text();
  let longBody: Record<string, unknown> = {};
  try {
    longBody = longText ? (JSON.parse(longText) as Record<string, unknown>) : {};
  } catch {
    longBody = {};
  }

  if (!longLivedResponse.ok) {
    return {
      ok: true,
      credentialPayload: {
        access_token: shortToken,
        token_type: typeof shortBody.token_type === 'string' ? shortBody.token_type.trim() : undefined,
        expires_in:
          typeof shortBody.expires_in === 'number'
            ? shortBody.expires_in
            : typeof shortBody.expires_in === 'string'
              ? Number(shortBody.expires_in)
              : undefined,
        obtained_at: new Date().toISOString(),
        mode: 'SHORT_LIVED_FALLBACK',
      },
    };
  }

  const accessToken = typeof longBody.access_token === 'string' ? longBody.access_token.trim() : shortToken;
  const expiresIn =
    typeof longBody.expires_in === 'number'
      ? longBody.expires_in
      : typeof longBody.expires_in === 'string'
        ? Number(longBody.expires_in)
        : 0;
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
  return {
    ok: true,
    credentialPayload: {
      access_token: accessToken,
      token_type: typeof longBody.token_type === 'string' ? longBody.token_type.trim() : undefined,
      expires_in: expiresIn || undefined,
      expires_at: expiresAt || undefined,
      obtained_at: new Date().toISOString(),
      mode: 'LONG_LIVED',
    },
  };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const encryptionKey = Deno.env.get('PROVIDER_CONFIG_ENCRYPTION_KEY');
  const defaultReturnTo = Deno.env.get('OAUTH_DEFAULT_RETURNTO')?.trim() || '';
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response('Missing Supabase env vars', { status: 500, headers: corsHeaders });
  }
  if (!encryptionKey) {
    return new Response('Missing PROVIDER_CONFIG_ENCRYPTION_KEY', { status: 500, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const stateToken = url.searchParams.get('state')?.trim() || '';
  const code = url.searchParams.get('code')?.trim() || '';
  const providerError = url.searchParams.get('error')?.trim() || '';
  const providerErrorDescription = url.searchParams.get('error_description')?.trim() || '';

  if (!stateToken) {
    return new Response('Missing state', { status: 400, headers: corsHeaders });
  }

  const redirectUri = `${supabaseUrl}/functions/v1/oauth-callback`;

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: session, error: sessionError } = await supabaseAdmin
    .from('oauth_sessions')
    .select('id, store_id, provider, actor_user_id, state_token, status, expires_at, metadata')
    .eq('state_token', stateToken)
    .maybeSingle();
  if (sessionError || !session) {
    const safeReturnTo = resolveSafeReturnTo(null, defaultReturnTo || null);
    if (safeReturnTo) {
      return redirectTo(safeReturnTo, {
        oauthStatus: 'error',
        oauthError: 'STATE_NOT_FOUND',
      });
    }
    return new Response('State not found', { status: 404, headers: corsHeaders });
  }

  const sessionRow = session as OAuthSessionRow;
  const safeReturnTo = resolveSafeReturnTo(
    typeof sessionRow.metadata?.return_to === 'string' ? String(sessionRow.metadata.return_to) : null,
    defaultReturnTo || null
  );

  const providerKey = (sessionRow.provider || '').toUpperCase();
  const nowIso = new Date().toISOString();
  const shouldRedirect = Boolean(safeReturnTo);
  let providerConfigurationId =
    typeof sessionRow.metadata?.provider_configuration_id === 'string'
      ? String(sessionRow.metadata.provider_configuration_id).trim()
      : '';

  const failAndRedirect = async (errorCode: string, message: string): Promise<Response> => {
    const safeMessage = (message || 'OAuth連携に失敗しました。').trim();
    const errorSummary = `${errorCode}: ${safeMessage}`.slice(0, 500);

    await supabaseAdmin
      .from('oauth_sessions')
      .update({
        status: 'FAILED',
        completed_at: nowIso,
        last_error: errorSummary,
      })
      .eq('id', sessionRow.id);

    if (providerConfigurationId) {
      await supabaseAdmin
        .from('provider_configurations')
        .update({
          connection_status: 'ERROR',
          last_error: errorSummary,
          last_tested_at: nowIso,
          updated_by: sessionRow.actor_user_id,
        })
        .eq('id', providerConfigurationId);
    }

    if (providerKey) {
      await supabaseAdmin.from('integrations').upsert(
        {
          store_id: sessionRow.store_id,
          provider: providerKey,
          status: 'ERROR',
          last_error: errorSummary,
          last_sync_at: null,
        },
        { onConflict: 'store_id,provider' }
      );
    }

    if (safeReturnTo && shouldRedirect) {
      return redirectTo(safeReturnTo, {
        oauthStatus: 'error',
        oauthProvider: providerKey,
        oauthError: errorCode,
        oauthErrorMessage: safeMessage.slice(0, 180),
      });
    }
    return new Response(safeMessage, { status: 400, headers: corsHeaders });
  };

  if (providerError) {
    return failAndRedirect(providerError, providerErrorDescription || 'Providerからエラーが返されました。');
  }

  if (!code) {
    return failAndRedirect('AUTH_CODE_REQUIRED', '認可コードが見つかりません。');
  }

  if (sessionRow.status !== 'PENDING') {
    return failAndRedirect('STATE_NOT_PENDING', 'このstateは既に処理済みです。');
  }

  const expiresAt = new Date(sessionRow.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
    await supabaseAdmin
      .from('oauth_sessions')
      .update({ status: 'EXPIRED', completed_at: nowIso, last_error: 'STATE_EXPIRED' })
      .eq('id', sessionRow.id);
    if (safeReturnTo && shouldRedirect) {
      return redirectTo(safeReturnTo, {
        oauthStatus: 'error',
        oauthProvider: providerKey,
        oauthError: 'STATE_EXPIRED',
      });
    }
    return new Response('State expired', { status: 400, headers: corsHeaders });
  }

  const { data: store, error: storeError } = await supabaseAdmin
    .from('stores')
    .select('id, org_id')
    .eq('id', sessionRow.store_id)
    .maybeSingle();
  if (storeError || !store) {
    return failAndRedirect('STORE_NOT_FOUND', '店舗が見つかりません。');
  }

  const { data: catalog, error: catalogError } = await supabaseAdmin
    .from('provider_catalog')
    .select('id, provider_key, auth_kind, is_active')
    .eq('org_id', store.org_id)
    .eq('provider_key', providerKey)
    .eq('auth_kind', 'OAUTH2')
    .eq('is_active', true)
    .maybeSingle();
  if (catalogError || !catalog) {
    return failAndRedirect('OAUTH_PROVIDER_NOT_CONFIGURED', 'OAuth provider が設定されていません。');
  }

  const { data: configuredById, error: configurationError } = await supabaseAdmin
    .from('provider_configurations')
    .select('id, config, has_gui_config')
    .eq('id', providerConfigurationId)
    .maybeSingle();
  let configuration = configuredById;

  if (configurationError || !configuration) {
    const { data: fallbackConfiguration, error: fallbackConfigurationError } = await supabaseAdmin
      .from('provider_configurations')
      .select('id, config, has_gui_config')
      .eq('store_id', sessionRow.store_id)
      .eq('provider_catalog_id', catalog.id)
      .maybeSingle();
    if (fallbackConfigurationError || !fallbackConfiguration) {
      return failAndRedirect('PROVIDER_CONFIGURATION_NOT_FOUND', 'provider configuration が見つかりません。');
    }
    configuration = fallbackConfiguration;
  }

  if (!configuration) {
    return failAndRedirect('PROVIDER_CONFIGURATION_NOT_FOUND', 'provider configuration が見つかりません。');
  }
  providerConfigurationId = configuration.id;

  const config = configuration.config && typeof configuration.config === 'object' ? configuration.config : {};
  const configObject = config as Record<string, unknown>;
  const clientId = readString(configObject, ['client_id', 'google_client_id', 'meta_app_id', 'app_id']);
  if (!clientId) {
    return failAndRedirect('CLIENT_ID_REQUIRED', 'client_id が provider config に設定されていません。');
  }

  const { data: providerSecret, error: providerSecretError } = await supabaseAdmin
    .from('provider_secrets')
    .select('encrypted_secret')
    .eq('provider_configuration_id', configuration.id)
    .maybeSingle();
  if (providerSecretError || !providerSecret?.encrypted_secret) {
    return failAndRedirect('CLIENT_SECRET_REQUIRED', 'client secret（provider secret）が未設定です。');
  }

  let clientSecret = '';
  try {
    clientSecret = await decryptAesGcm(String(providerSecret.encrypted_secret || ''), encryptionKey);
  } catch {
    return failAndRedirect('CLIENT_SECRET_DECRYPT_FAILED', 'client secret の復号に失敗しました。');
  }
  if (!clientSecret.trim()) {
    return failAndRedirect('CLIENT_SECRET_REQUIRED', 'client secret が空です。');
  }

  const graphApiVersion = readString(configObject, ['graph_api_version']) || 'v20.0';

  let tokenResult: TokenExchangeResult | null = null;
  if (providerKey === 'GBP') {
    tokenResult = await exchangeGoogleToken({ code, clientId, clientSecret, redirectUri });
  } else if (providerKey === 'FACEBOOK' || providerKey === 'INSTAGRAM') {
    tokenResult = await exchangeMetaToken({
      code,
      clientId,
      clientSecret,
      redirectUri,
      graphApiVersion,
    });
  } else {
    tokenResult = { ok: false, error: 'Unsupported provider' };
  }

  if (!tokenResult.ok || !tokenResult.credentialPayload) {
    return failAndRedirect('TOKEN_EXCHANGE_FAILED', tokenResult.error || 'token交換に失敗しました。');
  }

  const { data: integration, error: integrationError } = await supabaseAdmin
    .from('integrations')
    .upsert(
      {
        store_id: sessionRow.store_id,
        provider: providerKey,
        status: 'CONNECTED',
        last_sync_at: nowIso,
        last_error: null,
      },
      { onConflict: 'store_id,provider' }
    )
    .select('id')
    .single();
  if (integrationError || !integration?.id) {
    return failAndRedirect('INTEGRATION_UPSERT_FAILED', integrationError?.message || 'integration更新に失敗しました。');
  }

  // 既存refresh_tokenを失わないためのマージ（Googleのみ）
  let mergedCredentialPayload = { ...tokenResult.credentialPayload };
  if (providerKey === 'GBP' && !readString(mergedCredentialPayload, ['refresh_token'])) {
    const { data: existingCredential } = await supabaseAdmin
      .from('integration_credentials')
      .select('encrypted_payload')
      .eq('integration_id', integration.id)
      .maybeSingle();
    if (existingCredential?.encrypted_payload) {
      try {
        const decoded = await decodeMaybeEncryptedPayload(String(existingCredential.encrypted_payload), encryptionKey);
        const parsed = JSON.parse(decoded) as { credential_payload?: unknown };
        const existingPayload =
          parsed?.credential_payload && typeof parsed.credential_payload === 'object'
            ? (parsed.credential_payload as Record<string, unknown>)
            : {};
        const existingRefresh = readString(existingPayload, ['refresh_token']);
        if (existingRefresh) {
          mergedCredentialPayload = { ...mergedCredentialPayload, refresh_token: existingRefresh };
        }
      } catch {
        // ignore merge failure
      }
    }
  }

  const credentialWrapper = {
    credential_payload: mergedCredentialPayload,
    updated_at: nowIso,
    mode: 'REAL',
  };

  const encryptedPayload = await encryptAesGcm(JSON.stringify(credentialWrapper), encryptionKey);

  const { error: credentialUpsertError } = await supabaseAdmin.from('integration_credentials').upsert(
    {
      integration_id: integration.id,
      encrypted_payload: encryptedPayload,
    },
    { onConflict: 'integration_id' }
  );
  if (credentialUpsertError) {
    return failAndRedirect('CREDENTIAL_UPSERT_FAILED', credentialUpsertError.message);
  }

  await supabaseAdmin
    .from('provider_configurations')
    .update({
      connection_status: 'CONNECTED',
      last_tested_at: nowIso,
      last_error: null,
      has_gui_config: true,
      updated_by: sessionRow.actor_user_id,
    })
    .eq('id', configuration.id);

  await supabaseAdmin
    .from('oauth_sessions')
    .update({
      status: 'COMPLETED',
      completed_at: nowIso,
      last_error: null,
      metadata: {
        ...(sessionRow.metadata || {}),
        integration_id: integration.id,
        mode: 'REAL',
      },
    })
    .eq('id', sessionRow.id);

  await supabaseAdmin.from('audit_logs').insert({
    org_id: store.org_id,
    store_id: sessionRow.store_id,
    actor_user_id: sessionRow.actor_user_id,
    action: 'oauth_complete',
    target_type: 'integration',
    target_id: providerKey,
    payload: {
      integration_id: integration.id,
      mode: 'REAL',
    },
  });

  if (safeReturnTo && shouldRedirect) {
    return redirectTo(safeReturnTo, {
      oauthStatus: 'success',
      oauthProvider: providerKey,
    });
  }

  return new Response('OAuth completed', { status: 200, headers: corsHeaders });
});
