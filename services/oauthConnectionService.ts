import { OAuthCompleteResult, OAuthDisconnectResult, OAuthStartResult } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、OAuth連携を実行できません。');
  }
  return supabase;
};

type FunctionInvokeResult = {
  ok: boolean;
  status: number;
  body: unknown;
  text: string;
};

const requireFunctionRequestContext = async (client: ReturnType<typeof requireSupabase>) => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase環境変数が不足しています。VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を確認してください。');
  }

  const { data, error } = await client.auth.getSession();
  if (error) {
    throw new Error(`ログインセッションの取得に失敗しました。（${error.message}）`);
  }
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new Error('ログインセッションが無効です。いったんログアウトして再ログインしてください。');
  }

  return { supabaseUrl, anonKey, accessToken };
};

const invokeFunctionByHttp = async (
  client: ReturnType<typeof requireSupabase>,
  functionName: string,
  payload: Record<string, unknown>
): Promise<FunctionInvokeResult> => {
  const { supabaseUrl, anonKey, accessToken } = await requireFunctionRequestContext(client);
  const requestUrl = `${supabaseUrl}/functions/v1/${functionName}?client=direct-http-v3`;
  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
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
  return { ok: response.ok, status: response.status, body, text };
};

const normalizeJsonObject = (value: unknown): Record<string, unknown> => {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' ? (value as Record<string, unknown>) : {};
};

const toDate = (value: unknown): Date | undefined => {
  if (!value || typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

export const oauthConnectionService = {
  async start(params: { storeId: string; providerKey: string; returnTo?: string }): Promise<OAuthStartResult> {
    const client = requireSupabase();
    const returnTo =
      params.returnTo && params.returnTo.trim().length > 0
        ? params.returnTo.trim()
        : typeof window !== 'undefined'
          ? `${window.location.origin}/?view=SETTINGS&tab=INTEGRATIONS`
          : undefined;

    const result = await invokeFunctionByHttp(client, 'oauth-start', {
      storeId: params.storeId,
      providerKey: params.providerKey,
      returnTo,
    });
    if (!result.ok) {
      const bodyError =
        result.body && typeof result.body === 'object'
          ? String((result.body as Record<string, unknown>).error || (result.body as Record<string, unknown>).message || '')
          : '';
      throw new Error(`OAuth開始に失敗しました。${bodyError ? `（${bodyError} / status=${result.status}）` : `（status=${result.status}）`}`);
    }

    const body = normalizeJsonObject(result.body);
    const stateToken = String(body.stateToken || '').trim();
    const authorizationUrl = String(body.authorizationUrl || '').trim();
    const providerKey = String(body.providerKey || params.providerKey).trim().toUpperCase();
    if (!stateToken || !authorizationUrl) {
      throw new Error('OAuth開始情報の取得に失敗しました。');
    }
    return { stateToken, authorizationUrl, providerKey, expiresAt: toDate(body.expiresAt) };
  },

  async complete(_params: { stateToken: string; authCode: string }): Promise<OAuthCompleteResult> {
    throw new Error('この環境では認可コード貼り付けによるOAuth完了は使用しません。');
  },

  async disconnect(params: { storeId: string; providerKey: string }): Promise<OAuthDisconnectResult> {
    const client = requireSupabase();
    const { data, error } = await client.rpc('oauth_disconnect_session', {
      target_store_id: params.storeId,
      target_provider: params.providerKey,
    });
    if (error) throw error;
    const body = normalizeJsonObject(data);
    const ok = Boolean(body.ok);
    const providerKey = String(body.provider || params.providerKey).trim().toUpperCase();
    const storeId = String(body.store_id || params.storeId).trim();
    if (!ok || !storeId) {
      throw new Error('OAuth切断レスポンスが不正です。');
    }
    return {
      ok,
      providerKey,
      storeId,
    };
  },
};
