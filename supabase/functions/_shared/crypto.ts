const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const fromBase64 = (input: string): Uint8Array => {
  const binary = atob(input);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const importAesGcmKey = async (rawKey: string, usages: KeyUsage[]): Promise<CryptoKey> => {
  const encoder = new TextEncoder();
  const keyHash = await crypto.subtle.digest('SHA-256', encoder.encode(rawKey));
  return crypto.subtle.importKey('raw', keyHash, { name: 'AES-GCM' }, false, usages);
};

export const encodeBase64Text = (text: string): string => {
  return toBase64(new TextEncoder().encode(text));
};

export const decodeBase64Text = (input: string): string => {
  return new TextDecoder().decode(fromBase64(input));
};

export const isAesGcmPayload = (payload: string): boolean => {
  const idx = payload.indexOf(':');
  return idx > 0 && idx < payload.length - 1;
};

export const encryptAesGcm = async (plaintext: string, encryptionKey: string): Promise<string> => {
  const encoder = new TextEncoder();
  const key = await importAesGcmKey(encryptionKey, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext));
  return `${toBase64(iv)}:${toBase64(new Uint8Array(encrypted))}`;
};

export const decryptAesGcm = async (payload: string, encryptionKey: string): Promise<string> => {
  const idx = payload.indexOf(':');
  if (idx <= 0 || idx >= payload.length - 1) {
    throw new Error('Invalid encrypted payload format');
  }
  const ivBase64 = payload.slice(0, idx);
  const cipherBase64 = payload.slice(idx + 1);

  const iv = fromBase64(ivBase64);
  const ciphertext = fromBase64(cipherBase64);
  const key = await importAesGcmKey(encryptionKey, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(new Uint8Array(decrypted));
};

export const decodeMaybeEncryptedPayload = async (payload: string, encryptionKey: string): Promise<string> => {
  const trimmed = (payload || '').trim();
  if (!trimmed) return '';
  if (isAesGcmPayload(trimmed)) {
    return decryptAesGcm(trimmed, encryptionKey);
  }
  return decodeBase64Text(trimmed);
};

