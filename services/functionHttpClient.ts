import { isSupabaseConfigured, supabase } from './supabaseClient';

export type FunctionInvokeResult = {
  ok: boolean;
  status: number;
  body: unknown;
  text: string;
};

export const requireSupabaseClient = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定です。');
  }
  return supabase;
};

const nowEpochMs = () => Date.now();

const normalizeJwt = (token: string | null | undefined): string => (token || '').trim();

const isJwtLike = (value: string): boolean => {
  if (!value) return false;
  return value.split('.').length === 3 && value.length > 30;
};

const resolveBodyMessage = (body: unknown, fallbackText: string): string => {
  if (body && typeof body === 'object') {
    const typed = body as Record<string, unknown>;
    const candidates = ['error', 'message', 'error_description', 'errorMessage', 'statusText'];

    for (const key of candidates) {
      const raw = typed[key];
      if (typeof raw === 'string' && raw.trim().length > 0) {
        return raw.trim();
      }
      if (raw && typeof raw === 'object') {
        const nested = (raw as Record<string, unknown>).message;
        if (typeof nested === 'string' && nested.trim().length > 0) {
          return nested.trim();
        }
      }
    }
  }
  return (fallbackText || '').trim();
};

const isSessionAuthError = (status: number, body: unknown, text: string): boolean => {
  if (status !== 401) return false;
  const message = resolveBodyMessage(body, text).toLowerCase();
  if (!message) return true;

  return (
    message.includes('invalid auth token') ||
    message.includes('invalid token') ||
    message.includes('expired') ||
    message.includes('jwt') ||
    message.includes('missing auth token') ||
    message.includes('auth session missing') ||
    message.includes('missing authorization') ||
    message.includes('auth token') ||
    message.includes('unauthorized')
  );
};

const resolveValidSessionToken = async (client: ReturnType<typeof requireSupabaseClient>): Promise<string> => {
  const validateToken = async (token: string) => {
    if (!isJwtLike(token)) return false;
    const userResult = await client.auth.getUser(token);
    return !userResult.error && Boolean(userResult.data?.user?.id);
  };

  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  const currentToken = normalizeJwt(sessionData.session?.access_token);
  const expiresAt = Number(sessionData.session?.expires_at || 0);
  const refreshMarginMs = 120_000;

  if (await validateToken(currentToken)) {
    if (!Number.isFinite(expiresAt) || expiresAt <= 0 || expiresAt * 1000 - nowEpochMs() > refreshMarginMs) {
      return currentToken;
    }
  }

  const { data: refreshedData, error: refreshError } = await client.auth.refreshSession();
  const refreshedToken = normalizeJwt(refreshedData.session?.access_token);
  if (await validateToken(refreshedToken)) {
    return refreshedToken;
  }

  if (await validateToken(currentToken)) {
    return currentToken;
  }

  const reason = refreshError?.message || sessionError?.message || 'Auth session missing';
  throw new Error(`ログインセッションが無効です。いったんログインし直してください。（${reason}）`);
};

const resolveSupabaseFunctionAuthState = async (client: ReturnType<typeof requireSupabaseClient>) => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase環境変数が不足しています。VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を確認してください。');
  }

  const accessToken = await resolveValidSessionToken(client);

  return {
    client,
    supabaseUrl,
    anonKey,
    accessToken,
  };
};

const executeFunction = async (
  requestUrl: string,
  anonKey: string,
  token: string,
  payload: Record<string, unknown>
): Promise<FunctionInvokeResult> => {
  if (!isJwtLike(token)) {
    return {
      ok: false,
      status: 401,
      body: { error: 'Missing authorization header' },
      text: 'Missing authorization header',
    };
  }

  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
    text,
  };
};

const refreshToken = async (client: ReturnType<typeof requireSupabaseClient>): Promise<string | null> => {
  const { data: refreshedData } = await client.auth.refreshSession();
  const refreshedToken = normalizeJwt(refreshedData.session?.access_token);
  if (!refreshedToken) return null;
  return refreshedToken;
};

const parseResponseText = (text: string): unknown => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

const invokeFunctionBySdk = async (
  client: ReturnType<typeof requireSupabaseClient>,
  functionName: string,
  payload: Record<string, unknown>
): Promise<FunctionInvokeResult> => {
  try {
    const { data, error } = await client.functions.invoke(functionName, { body: payload });
    if (!error) {
      const text = data === null || data === undefined ? '' : JSON.stringify(data);
      return {
        ok: true,
        status: 200,
        body: data,
        text,
      };
    }

    const context = (error as { context?: Response }).context;
    if (context) {
      const text = await context.text();
      return {
        ok: context.ok,
        status: context.status,
        body: parseResponseText(text),
        text,
      };
    }

    const message = error.message || 'Function invoke failed';
    return {
      ok: false,
      status: 500,
      body: { error: message },
      text: message,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Function invoke failed';
    return {
      ok: false,
      status: 500,
      body: { error: message },
      text: message,
    };
  }
};

export const invokeFunctionByHttp = async (
  functionName: string,
  payload: Record<string, unknown>
): Promise<FunctionInvokeResult> => {
  const client = requireSupabaseClient();
  const { supabaseUrl, anonKey, accessToken } = await resolveSupabaseFunctionAuthState(client);
  const requestUrl = `${supabaseUrl}/functions/v1/${functionName}?client=direct-http-v3`;

  const initialResult = await executeFunction(requestUrl, anonKey, accessToken, payload);
  if (!isSessionAuthError(initialResult.status, initialResult.body, initialResult.text)) {
    return initialResult;
  }

  const latestToken = await refreshToken(client);
  if (latestToken) {
    const retriedResult = await executeFunction(requestUrl, anonKey, latestToken, payload);
    if (!isSessionAuthError(retriedResult.status, retriedResult.body, retriedResult.text)) {
      return retriedResult;
    }
  }

  const sdkResult = await invokeFunctionBySdk(client, functionName, payload);
  if (!isSessionAuthError(sdkResult.status, sdkResult.body, sdkResult.text)) {
    return sdkResult;
  }

  throw new Error(
    `ログインセッションが無効です。いったん再ログインしてください。（${sdkResult.status || initialResult.status} / ${resolveBodyMessage(sdkResult.body, sdkResult.text) || resolveBodyMessage(initialResult.body, initialResult.text)}）`
  );
};

export const getFunctionErrorMessage = (result: FunctionInvokeResult, fallback: string): string => {
  const bodyError = resolveBodyMessage(result.body, result.text);
  if (bodyError) {
    return `${fallback}（${bodyError} / status=${result.status}）`;
  }
  return `${fallback}（status=${result.status}）`;
};
