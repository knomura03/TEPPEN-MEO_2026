import { OAuthCompleteResult, OAuthDisconnectResult, OAuthStartResult } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';

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
  async start(params: { storeId: string; providerKey: string }): Promise<OAuthStartResult> {
    const client = requireSupabase();
    const { data, error } = await client.rpc('oauth_start_session', {
      target_store_id: params.storeId,
      target_provider: params.providerKey,
    });
    if (error) throw error;
    const body = normalizeJsonObject(data);
    const stateToken = String(body.state_token || '').trim();
    const authorizationUrl = String(body.authorization_url || '').trim();
    const providerKey = String(body.provider || params.providerKey).trim().toUpperCase();
    if (!stateToken || !authorizationUrl) {
      throw new Error('OAuth開始情報の取得に失敗しました。');
    }
    return {
      stateToken,
      authorizationUrl,
      providerKey,
      expiresAt: toDate(body.expires_at),
    };
  },

  async complete(params: { stateToken: string; authCode: string }): Promise<OAuthCompleteResult> {
    const client = requireSupabase();
    const { data, error } = await client.rpc('oauth_complete_session', {
      target_state_token: params.stateToken,
      auth_code: params.authCode,
      credential_payload: {},
    });
    if (error) throw error;
    const body = normalizeJsonObject(data);
    const ok = Boolean(body.ok);
    const providerKey = String(body.provider || '').trim().toUpperCase();
    const storeId = String(body.store_id || '').trim();
    const integrationId = String(body.integration_id || '').trim();
    if (!ok || !providerKey || !storeId || !integrationId) {
      throw new Error('OAuth完了レスポンスが不正です。');
    }
    return {
      ok,
      providerKey,
      storeId,
      integrationId,
    };
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

