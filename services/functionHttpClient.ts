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

const requireFunctionRequestContext = async () => {
  const client = requireSupabaseClient();
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase環境変数が不足しています。VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を確認してください。');
  }

  const { data, error } = await client.auth.getSession();
  let accessToken = data.session?.access_token?.trim() || '';

  if (!accessToken) {
    const { data: refreshedData, error: refreshError } = await client.auth.refreshSession();
    accessToken = refreshedData.session?.access_token?.trim() || '';
    if (!accessToken) {
      const reason = refreshError?.message || error?.message || 'Auth session missing';
      throw new Error(`ログインセッションが無効です。いったんログアウトして再ログインしてください。（${reason}）`);
    }
  }

  return {
    client,
    supabaseUrl,
    anonKey,
    accessToken,
  };
};

const isSessionAuthError = (status: number, body: unknown, text: string): boolean => {
  if (status !== 401) return false;
  const message =
    body && typeof body === 'object'
      ? String((body as Record<string, unknown>).error || (body as Record<string, unknown>).message || '')
      : text || '';
  const normalized = message.toLowerCase();
  return (
    normalized.includes('auth session missing') ||
    normalized.includes('missing authorization') ||
    normalized.includes('invalid jwt')
  );
};

export const invokeFunctionByHttp = async (
  functionName: string,
  payload: Record<string, unknown>
): Promise<FunctionInvokeResult> => {
  const { client, supabaseUrl, anonKey, accessToken } = await requireFunctionRequestContext();
  const requestUrl = `${supabaseUrl}/functions/v1/${functionName}?client=direct-http-v3`;

  const execute = async (token: string): Promise<FunctionInvokeResult> => {
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

  const initialResult = await execute(accessToken);
  if (!isSessionAuthError(initialResult.status, initialResult.body, initialResult.text)) {
    return initialResult;
  }

  const { data: refreshedData } = await client.auth.refreshSession();
  const refreshedToken = refreshedData.session?.access_token?.trim() || '';
  if (!refreshedToken || refreshedToken === accessToken) {
    return initialResult;
  }

  return execute(refreshedToken);
};

export const getFunctionErrorMessage = (result: FunctionInvokeResult, fallback: string): string => {
  const bodyError =
    result.body && typeof result.body === 'object'
      ? String((result.body as Record<string, unknown>).error || (result.body as Record<string, unknown>).message || '')
      : '';
  if (bodyError) {
    return `${fallback}（${bodyError} / status=${result.status}）`;
  }
  return `${fallback}（status=${result.status}）`;
};
