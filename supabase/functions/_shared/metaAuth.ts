import { parseCredentialEnvelope } from './integrationCredentials.ts';
import { extractProviderErrorMessage, fetchJson } from './http.ts';

export type MetaPageTokenResult = {
  ok: boolean;
  pageId?: string;
  pageName?: string;
  pageAccessToken?: string;
  instagramUserId?: string;
  error?: string;
  pages?: Array<{ id: string; name: string; pageAccessToken?: string; instagramUserId?: string }>;
};

export const resolveMetaUserAccessToken = async (params: {
  encryptedPayload: string;
  encryptionKey: string;
}): Promise<{ accessToken: string; credentialPayload: Record<string, unknown> }> => {
  const envelope = await parseCredentialEnvelope(params.encryptedPayload, params.encryptionKey);
  return {
    accessToken:
      typeof envelope.credentialPayload.access_token === 'string'
        ? envelope.credentialPayload.access_token.trim()
        : envelope.accessToken,
    credentialPayload: envelope.credentialPayload,
  };
};

const mapPageRows = (body: unknown) => {
  const typedBody = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const rows = Array.isArray(typedBody.data) ? typedBody.data : [];
  return rows
    .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>) : null))
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .map((row) => {
      const instagramBusiness =
        row.instagram_business_account && typeof row.instagram_business_account === 'object'
          ? (row.instagram_business_account as Record<string, unknown>)
          : null;
      const connectedInstagram =
        row.connected_instagram_account && typeof row.connected_instagram_account === 'object'
          ? (row.connected_instagram_account as Record<string, unknown>)
          : null;
      const instagramId =
        (instagramBusiness && typeof instagramBusiness.id === 'string' && instagramBusiness.id.trim()) ||
        (connectedInstagram && typeof connectedInstagram.id === 'string' && connectedInstagram.id.trim()) ||
        '';

      return {
        id: typeof row.id === 'string' ? row.id.trim() : '',
        name: typeof row.name === 'string' ? row.name.trim() : '',
        pageAccessToken: typeof row.access_token === 'string' ? row.access_token.trim() : '',
        instagramUserId: instagramId,
      };
    })
    .filter((row) => row.id.length > 0);
};

export const resolveMetaPageAccessToken = async (params: {
  userAccessToken: string;
  graphApiVersion: string;
  preferredPageId?: string;
}): Promise<MetaPageTokenResult> => {
  const fields = 'id,name,access_token,instagram_business_account{id,username},connected_instagram_account{id,username}';
  const endpoint = `https://graph.facebook.com/${params.graphApiVersion}/me/accounts?fields=${encodeURIComponent(fields)}`;
  const response = await fetchJson(endpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${params.userAccessToken}` },
  });

  if (!response.ok) {
    return {
      ok: false,
      error: extractProviderErrorMessage(response.body) || `Meta ページ一覧取得に失敗しました。（status=${response.status}）`,
    };
  }

  const pages = mapPageRows(response.body);
  if (pages.length === 0) {
    return { ok: false, error: 'Meta ページ一覧が0件でした。' };
  }

  const selected =
    (params.preferredPageId ? pages.find((page) => page.id === params.preferredPageId) : null) || pages[0];

  return {
    ok: true,
    pageId: selected.id,
    pageName: selected.name,
    pageAccessToken: selected.pageAccessToken || params.userAccessToken,
    instagramUserId: selected.instagramUserId || undefined,
    pages,
  };
};
