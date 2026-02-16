import { OAuthCompleteResult, OAuthDisconnectResult, OAuthStartResult } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import { getFunctionErrorMessage, invokeFunctionByHttp } from './functionHttpClient';

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、OAuth連携を実行できません。');
  }
  return supabase;
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
    const returnTo =
      params.returnTo && params.returnTo.trim().length > 0
        ? params.returnTo.trim()
        : typeof window !== 'undefined'
          ? `${window.location.origin}/?view=PLATFORM_MANAGEMENT`
          : undefined;

    const result = await invokeFunctionByHttp('oauth-start', {
      storeId: params.storeId,
      providerKey: params.providerKey,
      returnTo,
    });
    if (!result.ok) {
      throw new Error(getFunctionErrorMessage(result, 'OAuth開始に失敗しました。'));
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
