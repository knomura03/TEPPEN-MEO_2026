import { buildEncryptedCredentialEnvelope, parseCredentialEnvelope } from './integrationCredentials.ts';
import { extractProviderErrorMessage, fetchJson, toFormBody } from './http.ts';

export type GoogleTokenResolution = {
  ok: boolean;
  accessToken?: string;
  credentialPayload?: Record<string, unknown>;
  refreshed?: boolean;
  error?: string;
};

const parseExpiresAt = (value: unknown): number => {
  if (typeof value === 'string') {
    const ts = new Date(value).getTime();
    if (!Number.isNaN(ts)) return ts;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return 0;
};

export const ensureGoogleAccessToken = async (params: {
  supabaseAdmin: any;
  integrationId: string;
  encryptedPayload: string;
  encryptionKey: string;
  clientId: string;
  clientSecret: string;
}): Promise<GoogleTokenResolution> => {
  const envelope = await parseCredentialEnvelope(params.encryptedPayload, params.encryptionKey);
  const credentialPayload = { ...envelope.credentialPayload };
  const accessToken = typeof credentialPayload.access_token === 'string' ? credentialPayload.access_token.trim() : envelope.accessToken;
  const refreshToken = typeof credentialPayload.refresh_token === 'string' ? credentialPayload.refresh_token.trim() : '';
  const expiresAtMs = parseExpiresAt(credentialPayload.expires_at);
  const nowMs = Date.now();

  if (accessToken && expiresAtMs && expiresAtMs > nowMs + 60_000) {
    return {
      ok: true,
      accessToken,
      credentialPayload,
      refreshed: false,
    };
  }

  if (accessToken && !expiresAtMs) {
    return {
      ok: true,
      accessToken,
      credentialPayload,
      refreshed: false,
    };
  }

  if (!refreshToken) {
    return { ok: false, error: 'Google refresh_token が見つかりません。再連携が必要です。' };
  }

  const refreshResponse = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: toFormBody({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!refreshResponse.ok || typeof refreshResponse.body !== 'object' || !refreshResponse.body) {
    return {
      ok: false,
      error: extractProviderErrorMessage(refreshResponse.body) || `Google token refresh に失敗しました。（status=${refreshResponse.status}）`,
    };
  }

  const body = refreshResponse.body as Record<string, unknown>;
  const nextAccessToken = typeof body.access_token === 'string' ? body.access_token.trim() : '';
  if (!nextAccessToken) {
    return { ok: false, error: 'Google token refresh 後の access_token が空です。' };
  }

  const expiresInRaw = body.expires_in;
  const expiresIn =
    typeof expiresInRaw === 'number'
      ? expiresInRaw
      : typeof expiresInRaw === 'string'
        ? Number(expiresInRaw)
        : 0;
  const nextPayload: Record<string, unknown> = {
    ...credentialPayload,
    access_token: nextAccessToken,
    refresh_token: refreshToken,
    token_type: typeof body.token_type === 'string' ? body.token_type : credentialPayload.token_type,
    scope: typeof body.scope === 'string' ? body.scope : credentialPayload.scope,
    expires_in: expiresIn || credentialPayload.expires_in,
    expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : credentialPayload.expires_at,
    obtained_at: new Date().toISOString(),
  };

  const encryptedPayload = await buildEncryptedCredentialEnvelope(nextPayload, params.encryptionKey);
  const { error: upsertError } = await params.supabaseAdmin.from('integration_credentials').upsert(
    {
      integration_id: params.integrationId,
      encrypted_payload: encryptedPayload,
    },
    { onConflict: 'integration_id' }
  );

  if (upsertError) {
    return { ok: false, error: `Google token refresh の保存に失敗しました。${upsertError.message}` };
  }

  return {
    ok: true,
    accessToken: nextAccessToken,
    credentialPayload: nextPayload,
    refreshed: true,
  };
};
