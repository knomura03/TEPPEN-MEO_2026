import { ProviderConfiguration, ProviderConnectionStatus, ProviderTargetDiscoveryResult } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';

type DbProviderConfigurationRow = {
  id: string;
  store_id: string;
  provider_catalog_id: string;
  config: Record<string, unknown> | null;
  has_gui_config: boolean;
  connection_status: ProviderConnectionStatus;
  last_tested_at: string | null;
  last_error: string | null;
  secret_updated_at: string | null;
};

type InvokeErrorContextLike = {
  status?: number;
  statusText?: string;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
  clone?: () => InvokeErrorContextLike;
};

type InvokeErrorLike = {
  message?: string;
  context?: InvokeErrorContextLike;
};

type FunctionInvokeResult = {
  ok: boolean;
  status: number;
  body: unknown;
  text: string;
};

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、provider設定を取得できません。');
  }
  return supabase;
};

const requireFunctionRequestContext = async (client: ReturnType<typeof requireSupabase>) => {
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

  return { supabaseUrl, anonKey, accessToken };
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

const invokeFunctionByHttp = async (
  client: ReturnType<typeof requireSupabase>,
  functionName: string,
  payload: Record<string, unknown>
): Promise<FunctionInvokeResult> => {
  const { supabaseUrl, anonKey, accessToken } = await requireFunctionRequestContext(client);
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
    return { ok: response.ok, status: response.status, body, text };
  };

  const initialResult = await execute(accessToken);
  if (isSessionAuthError(initialResult.status, initialResult.body, initialResult.text)) {
    const { data: refreshedData } = await client.auth.refreshSession();
    const refreshedToken = refreshedData.session?.access_token?.trim() || '';
    if (refreshedToken && refreshedToken !== accessToken) {
      return execute(refreshedToken);
    }
  }
  return initialResult;
};

const mapConfiguration = (row: DbProviderConfigurationRow): ProviderConfiguration => ({
  id: row.id,
  storeId: row.store_id,
  providerCatalogId: row.provider_catalog_id,
  config: row.config || {},
  hasGuiConfig: row.has_gui_config,
  connectionStatus: row.connection_status,
  lastTestedAt: row.last_tested_at ? new Date(row.last_tested_at) : undefined,
  lastError: row.last_error || undefined,
  secretUpdatedAt: row.secret_updated_at ? new Date(row.secret_updated_at) : undefined,
});

const extractInvokeErrorMessage = async (action: string, error: unknown): Promise<string> => {
  const fallback = `${action}に失敗しました。`;
  if (!error || typeof error !== 'object') {
    return `${fallback}${error ? `（${String(error)}）` : ''}`;
  }

  const typed = error as InvokeErrorLike;
  const context = typed.context;
  if (context) {
    try {
      const reader = context.clone ? context.clone() : context;
      if (typeof reader.json === 'function') {
        const body = await reader.json();
        if (body && typeof body === 'object') {
          const mappedBody = body as Record<string, unknown>;
          const bodyError = String(mappedBody.error || mappedBody.message || '').trim();
          const bodyCode = mappedBody.code ? String(mappedBody.code).trim() : '';
          if (bodyError) {
            return `${fallback}（${bodyCode ? `${bodyCode}: ` : ''}${bodyError}）`;
          }
        }
      } else if (typeof reader.text === 'function') {
        const text = (await reader.text()).trim();
        if (text) {
          return `${fallback}（${text}）`;
        }
      }
    } catch {
      // ignore body parse error and use fallback message
    }
    if (typeof context.status === 'number') {
      return `${fallback}（status=${context.status}${context.statusText ? ` ${context.statusText}` : ''}）`;
    }
  }

  if (typed.message && typed.message.trim().length > 0) {
    return `${fallback}（${typed.message.trim()}）`;
  }
  return fallback;
};

export const providerConfigurationService = {
  async listByStore(storeId: string): Promise<ProviderConfiguration[]> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('provider_configurations')
      .select(
        'id, store_id, provider_catalog_id, config, has_gui_config, connection_status, last_tested_at, last_error, secret_updated_at'
      )
      .eq('store_id', storeId);
    if (error) throw error;
    return ((data || []) as DbProviderConfigurationRow[]).map(mapConfiguration);
  },

  async upsertConfiguration(params: {
    storeId: string;
    providerCatalogId: string;
    config: Record<string, unknown>;
    updatedBy?: string;
  }): Promise<ProviderConfiguration> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('provider_configurations')
      .upsert(
        {
          store_id: params.storeId,
          provider_catalog_id: params.providerCatalogId,
          config: params.config,
          has_gui_config: true,
          created_by: params.updatedBy ?? null,
          updated_by: params.updatedBy ?? null,
        },
        {
          onConflict: 'store_id,provider_catalog_id',
        }
      )
      .select(
        'id, store_id, provider_catalog_id, config, has_gui_config, connection_status, last_tested_at, last_error, secret_updated_at'
      )
      .single();
    if (error) throw error;
    return mapConfiguration(data as DbProviderConfigurationRow);
  },

  async upsertSecret(params: { providerConfigurationId: string; secret: string }): Promise<void> {
    const client = requireSupabase();
    const result = await invokeFunctionByHttp(client, 'admin-provider-secret-upsert', params);
    if (!result.ok) {
      const bodyError =
        result.body && typeof result.body === 'object'
          ? String((result.body as Record<string, unknown>).error || (result.body as Record<string, unknown>).message || '')
          : '';
      throw new Error(
        `Providerシークレットの保存に失敗しました。${
          bodyError ? `（${bodyError} / status=${result.status}）` : `（status=${result.status}）`
        }`
      );
    }
    if (
      result.body &&
      typeof result.body === 'object' &&
      'error' in (result.body as Record<string, unknown>) &&
      (result.body as Record<string, unknown>).error
    ) {
      throw new Error(String((result.body as Record<string, unknown>).error));
    }
  },

  async testConnection(params: { providerConfigurationId: string }): Promise<ProviderConnectionStatus> {
    const client = requireSupabase();
    const result = await invokeFunctionByHttp(client, 'admin-provider-connection-test', params);
    if (!result.ok) {
      const bodyError =
        result.body && typeof result.body === 'object'
          ? String((result.body as Record<string, unknown>).error || (result.body as Record<string, unknown>).message || '')
          : '';
      throw new Error(
        `接続テストに失敗しました。${
          bodyError ? `（${bodyError} / status=${result.status}）` : `（status=${result.status}）`
        }`
      );
    }
    if (
      result.body &&
      typeof result.body === 'object' &&
      'error' in (result.body as Record<string, unknown>) &&
      (result.body as Record<string, unknown>).error
    ) {
      throw new Error(String((result.body as Record<string, unknown>).error));
    }
    const status =
      result.body && typeof result.body === 'object'
        ? ((result.body as Record<string, unknown>).connectionStatus as ProviderConnectionStatus)
        : undefined;
    return status || 'ERROR';
  },

  async discoverTargets(params: { providerConfigurationId: string }): Promise<ProviderTargetDiscoveryResult> {
    const client = requireSupabase();
    const result = await invokeFunctionByHttp(client, 'admin-provider-discover-targets', params);
    if (!result.ok) {
      const bodyError =
        result.body && typeof result.body === 'object'
          ? String((result.body as Record<string, unknown>).error || (result.body as Record<string, unknown>).message || '')
          : '';
      throw new Error(
        `ID自動取得に失敗しました。${
          bodyError ? `（${bodyError} / status=${result.status}）` : `（status=${result.status}）`
        }`
      );
    }
    if (!result.body || typeof result.body !== 'object') {
      throw new Error('ID自動取得のレスポンス形式が不正です。');
    }
    const body = result.body as Record<string, unknown>;
    const providerKey = String(body.providerKey || '').trim().toUpperCase();
    const facebookPagesRaw = Array.isArray(body.facebookPages) ? body.facebookPages : [];
    const instagramAccountsRaw = Array.isArray(body.instagramAccounts) ? body.instagramAccounts : [];
    const facebookPages = facebookPagesRaw
      .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : null))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item) => ({
        id: String(item.id || '').trim(),
        name: String(item.name || '').trim(),
      }))
      .filter((item) => item.id.length > 0);
    const instagramAccounts = instagramAccountsRaw
      .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : null))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item) => ({
        instagramUserId: String(item.instagramUserId || item.instagram_user_id || '').trim(),
        username: String(item.username || '').trim() || undefined,
        facebookPageId: String(item.facebookPageId || item.facebook_page_id || '').trim() || undefined,
        facebookPageName: String(item.facebookPageName || item.facebook_page_name || '').trim() || undefined,
      }))
      .filter((item) => item.instagramUserId.length > 0);

    return {
      providerKey,
      facebookPages,
      instagramAccounts,
      autoApplied: Boolean(body.autoApplied),
      appliedConfig:
        body.appliedConfig && typeof body.appliedConfig === 'object'
          ? (body.appliedConfig as Record<string, unknown>)
          : {},
      message: typeof body.message === 'string' ? body.message : undefined,
    };
  },
};
