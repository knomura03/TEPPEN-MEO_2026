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
  const matched = headerValue.match(/Bearer\\s+([^,\\s]+)/i);
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

const readString = (source: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return '';
};

const parseAllowedOrigins = (input: string | undefined): string[] => {
  if (!input) return [];
  return input
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const resolveReturnTo = (req: Request, returnToRaw: string | undefined): { ok: boolean; value?: string; error?: string } => {
  const requestOrigin = req.headers.get('Origin')?.trim() || '';
  const allowlist = parseAllowedOrigins(Deno.env.get('OAUTH_RETURNTO_ALLOWLIST'));
  const defaultReturnToRaw = Deno.env.get('OAUTH_DEFAULT_RETURNTO')?.trim() || '';

  const normalize = (candidate: string): { ok: boolean; value?: string; error?: string } => {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      return { ok: false, error: 'returnTo がURLとして不正です。' };
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      return { ok: false, error: 'returnTo は http/https のみ許可されています。' };
    }

    const isAllowedByOrigin = requestOrigin && url.origin === requestOrigin;
    const isAllowedByAllowlist = allowlist.includes('*') || allowlist.includes(url.origin);
    if (!isAllowedByOrigin && !isAllowedByAllowlist) {
      return { ok: false, error: `returnTo の origin が許可されていません。（origin=${url.origin}）` };
    }

    url.hash = '';
    return { ok: true, value: url.toString() };
  };

  if (returnToRaw && returnToRaw.trim().length > 0) {
    return normalize(returnToRaw.trim());
  }

  if (defaultReturnToRaw) {
    const normalizedDefault = normalize(defaultReturnToRaw);
    if (normalizedDefault.ok) return normalizedDefault;
  }

  if (requestOrigin) {
    return normalize(`${requestOrigin}/?view=SETTINGS&tab=INTEGRATIONS`);
  }

  return { ok: false, error: 'returnTo が未指定で、デフォルトURLも設定されていません。' };
};

type ProviderSpec = {
  kind: 'GOOGLE' | 'META';
  scopes: string[];
  version?: string;
};

const resolveProviderSpec = (providerKey: string, config: Record<string, unknown>): ProviderSpec | null => {
  const normalized = providerKey.toUpperCase();
  const configuredVersion = readString(config, ['graph_api_version']);
  const version = configuredVersion || 'v20.0';

  if (normalized === 'GBP') {
    return {
      kind: 'GOOGLE',
      scopes: ['https://www.googleapis.com/auth/business.manage'],
    };
  }
  if (normalized === 'FACEBOOK') {
    return {
      kind: 'META',
      scopes: ['pages_show_list'],
      version,
    };
  }
  if (normalized === 'INSTAGRAM') {
    return {
      kind: 'META',
      scopes: ['instagram_basic', 'pages_show_list'],
      version,
    };
  }
  return null;
};

const buildAuthorizationUrl = (params: {
  providerKey: string;
  clientId: string;
  redirectUri: string;
  stateToken: string;
  spec: ProviderSpec;
}): string => {
  if (params.spec.kind === 'GOOGLE') {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', params.spec.scopes.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('state', params.stateToken);
    return url.toString();
  }

  const version = params.spec.version || 'v20.0';
  const url = new URL(`https://www.facebook.com/${version}/dialog/oauth`);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', params.spec.scopes.join(','));
  url.searchParams.set('state', params.stateToken);
  url.searchParams.set('auth_type', 'rerequest');
  return url.toString();
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

  let payload: { storeId?: string; providerKey?: string; returnTo?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const storeId = payload.storeId?.trim();
  const providerKey = payload.providerKey?.trim().toUpperCase();
  if (!storeId || !providerKey) {
    return jsonResponse(400, { error: 'Missing storeId/providerKey' });
  }

  const returnToResult = resolveReturnTo(req, payload.returnTo);
  if (!returnToResult.ok || !returnToResult.value) {
    return jsonResponse(400, { error: returnToResult.error || 'Invalid returnTo', code: 'RETURN_TO_NOT_ALLOWED' });
  }

  const redirectUri = `${supabaseUrl}/functions/v1/oauth-callback`;

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: store, error: storeError } = await supabaseAdmin
    .from('stores')
    .select('id, org_id')
    .eq('id', storeId)
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

  const canManage = memberships.some((row: { role: string }) => {
    const role = (row.role || '').toUpperCase();
    return role === 'ADMIN' || role === 'SUPERVISOR' || role === 'MANAGER';
  });
  if (!canManage) {
    return jsonResponse(403, { error: 'Not allowed' });
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
    return jsonResponse(400, { error: 'OAuth provider is not configured', code: 'OAUTH_PROVIDER_NOT_CONFIGURED' });
  }

  const { data: configuration, error: configurationError } = await supabaseAdmin
    .from('provider_configurations')
    .select('id, config, has_gui_config')
    .eq('store_id', storeId)
    .eq('provider_catalog_id', catalog.id)
    .maybeSingle();
  if (configurationError || !configuration) {
    return jsonResponse(400, { error: 'provider configuration not found', code: 'PROVIDER_CONFIGURATION_NOT_FOUND' });
  }

  const config = configuration.config && typeof configuration.config === 'object' ? configuration.config : {};
  const configObject = config as Record<string, unknown>;

  const spec = resolveProviderSpec(providerKey, configObject);
  if (!spec) {
    return jsonResponse(400, { error: 'Unsupported provider', code: 'UNSUPPORTED_PROVIDER' });
  }

  const clientId = readString(configObject, ['client_id', 'google_client_id', 'meta_app_id', 'app_id']);
  if (!clientId) {
    return jsonResponse(400, { error: 'client_id が provider config に設定されていません。', code: 'CLIENT_ID_REQUIRED' });
  }

  const stateToken = crypto.randomUUID().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const authorizationUrl = buildAuthorizationUrl({
    providerKey,
    clientId,
    redirectUri,
    stateToken,
    spec,
  });

  const { error: insertSessionError } = await supabaseAdmin.from('oauth_sessions').insert({
    store_id: storeId,
    provider: providerKey,
    actor_user_id: actorUserId,
    state_token: stateToken,
    status: 'PENDING',
    authorization_url: authorizationUrl,
    expires_at: expiresAt,
    metadata: {
      mode: 'REAL',
      return_to: returnToResult.value,
      provider_configuration_id: configuration.id,
      redirect_uri: redirectUri,
      scopes: spec.scopes,
    },
  });
  if (insertSessionError) {
    return jsonResponse(400, { error: insertSessionError.message });
  }

  await supabaseAdmin.from('audit_logs').insert({
    org_id: store.org_id,
    store_id: storeId,
    actor_user_id: actorUserId,
    action: 'oauth_start',
    target_type: 'integration',
    target_id: providerKey,
    payload: {
      state_token: stateToken,
      mode: 'REAL',
    },
  });

  return jsonResponse(200, {
    ok: true,
    providerKey,
    stateToken,
    authorizationUrl,
    expiresAt,
  });
});

