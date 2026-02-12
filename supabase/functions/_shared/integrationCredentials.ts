import { decodeMaybeEncryptedPayload, encryptAesGcm } from './crypto.ts';
import { readString } from './http.ts';

export type CredentialEnvelope = {
  credentialPayload: Record<string, unknown>;
  accessToken: string;
  updatedAt?: string;
};

export const parseCredentialEnvelope = async (
  encryptedPayload: string,
  encryptionKey: string
): Promise<CredentialEnvelope> => {
  if (!encryptedPayload || !encryptedPayload.trim()) {
    return { credentialPayload: {}, accessToken: '' };
  }

  try {
    const decodedText = await decodeMaybeEncryptedPayload(encryptedPayload, encryptionKey);
    const parsed = JSON.parse(decodedText) as {
      auth_code?: unknown;
      credential_payload?: unknown;
      updated_at?: unknown;
    };

    const credentialPayload =
      parsed.credential_payload && typeof parsed.credential_payload === 'object'
        ? (parsed.credential_payload as Record<string, unknown>)
        : {};

    const accessToken = readString(credentialPayload, ['access_token']) || (typeof parsed.auth_code === 'string' ? parsed.auth_code.trim() : '');

    return {
      credentialPayload,
      accessToken,
      updatedAt: typeof parsed.updated_at === 'string' ? parsed.updated_at : undefined,
    };
  } catch {
    return { credentialPayload: {}, accessToken: '' };
  }
};

export const buildEncryptedCredentialEnvelope = async (
  credentialPayload: Record<string, unknown>,
  encryptionKey: string
): Promise<string> => {
  const wrapper = {
    credential_payload: credentialPayload,
    updated_at: new Date().toISOString(),
    mode: 'REAL',
  };
  return encryptAesGcm(JSON.stringify(wrapper), encryptionKey);
};
