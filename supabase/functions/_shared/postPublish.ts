import { decryptAesGcm } from './crypto.ts';
import { ensureGoogleAccessToken } from './googleAuth.ts';
import { resolveAndPersistGbpLocation } from './googleLocation.ts';
import { resolveMetaPageAccessToken, resolveMetaUserAccessToken } from './metaAuth.ts';
import { extractProviderErrorMessage, fetchJson, readString, toFormBody } from './http.ts';

type PublishProvider = 'FACEBOOK' | 'INSTAGRAM' | 'GBP';

type PostRow = {
  id: string;
  store_id: string;
  content: string;
  platforms: string[];
  scheduled_at: string | null;
  approval_status: string;
};

type ProviderContext = {
  providerKey: PublishProvider;
  configurationId: string;
  config: Record<string, unknown>;
  connectionStatus: string;
  integrationStatus: string;
  integrationId: string;
  encryptedCredential: string;
  providerSecret?: string;
  graphApiVersion?: string;
};

export type ProviderPublishResult = {
  provider: PublishProvider;
  mode: 'REAL' | 'MOCK';
  status: 'SUCCESS' | 'FAILED';
  message?: string;
  externalPostId?: string;
};

const PLATFORM_TO_PROVIDER: Record<string, PublishProvider> = {
  FACEBOOK: 'FACEBOOK',
  INSTAGRAM: 'INSTAGRAM',
  GOOGLE_BUSINESS: 'GBP',
  GBP: 'GBP',
};

const mapPlatformToProvider = (platform: string): PublishProvider | null => {
  const normalized = String(platform || '').toUpperCase();
  return PLATFORM_TO_PROVIDER[normalized] || null;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const resolvePostProviders = (post: PostRow, forcedProviders?: string[]): PublishProvider[] => {
  const fromPost = Array.isArray(post.platforms) ? post.platforms : [];
  const source = forcedProviders && forcedProviders.length > 0 ? forcedProviders : fromPost;
  const providers = source
    .map((item) => mapPlatformToProvider(item))
    .filter((item): item is PublishProvider => Boolean(item));
  return Array.from(new Set(providers));
};

const resolveProviderContext = async (params: {
  supabaseAdmin: any;
  encryptionKey: string;
  storeId: string;
  orgId: string;
  provider: PublishProvider;
}): Promise<ProviderContext | null> => {
  const { data: catalog } = await params.supabaseAdmin
    .from('provider_catalog')
    .select('id')
    .eq('org_id', params.orgId)
    .eq('provider_key', params.provider)
    .eq('is_active', true)
    .maybeSingle();
  if (!catalog?.id) return null;

  const { data: configuration } = await params.supabaseAdmin
    .from('provider_configurations')
    .select('id, config, connection_status')
    .eq('store_id', params.storeId)
    .eq('provider_catalog_id', catalog.id)
    .maybeSingle();

  if (!configuration?.id) return null;

  const { data: integration } = await params.supabaseAdmin
    .from('integrations')
    .select('id, status')
    .eq('store_id', params.storeId)
    .eq('provider', params.provider)
    .maybeSingle();
  const integrationId = integration?.id ? String(integration.id) : '';
  const integrationStatus = integration?.status ? String(integration.status) : 'DISCONNECTED';
  let encryptedCredential = '';
  if (integrationId) {
    const { data: credential } = await params.supabaseAdmin
      .from('integration_credentials')
      .select('encrypted_payload')
      .eq('integration_id', integrationId)
      .maybeSingle();
    if (credential?.encrypted_payload) {
      encryptedCredential = String(credential.encrypted_payload);
    }
  }

  let providerSecret = '';
  if (params.provider === 'GBP') {
    const { data: secretRow } = await params.supabaseAdmin
      .from('provider_secrets')
      .select('encrypted_secret')
      .eq('provider_configuration_id', configuration.id)
      .maybeSingle();

    if (secretRow?.encrypted_secret) {
      try {
        providerSecret = await decryptAesGcm(String(secretRow.encrypted_secret), params.encryptionKey);
      } catch {
        providerSecret = '';
      }
    }
  }

  const config = configuration.config && typeof configuration.config === 'object' ? (configuration.config as Record<string, unknown>) : {};
  return {
    providerKey: params.provider,
    configurationId: configuration.id,
    config,
    connectionStatus: String(configuration.connection_status || 'DISCONNECTED'),
    integrationStatus,
    integrationId,
    encryptedCredential,
    providerSecret: providerSecret || undefined,
    graphApiVersion: readString(config, ['graph_api_version']) || 'v20.0',
  };
};

const publishToFacebook = async (params: {
  context: ProviderContext;
  post: PostRow;
  encryptionKey: string;
}): Promise<ProviderPublishResult> => {
  const { accessToken } = await resolveMetaUserAccessToken({
    encryptedPayload: params.context.encryptedCredential,
    encryptionKey: params.encryptionKey,
  });
  if (!accessToken) {
    return { provider: 'FACEBOOK', mode: 'REAL', status: 'FAILED', message: 'Facebook access_token が見つかりません。再連携してください。' };
  }

  const configuredPageId = readString(params.context.config, ['facebook_page_id', 'fb_page_id', 'page_id']);
  const pageTokenResult = await resolveMetaPageAccessToken({
    userAccessToken: accessToken,
    graphApiVersion: params.context.graphApiVersion || 'v20.0',
    preferredPageId: configuredPageId || undefined,
  });

  if (!pageTokenResult.ok || !pageTokenResult.pageId || !pageTokenResult.pageAccessToken) {
    return {
      provider: 'FACEBOOK',
      mode: 'REAL',
      status: 'FAILED',
      message: pageTokenResult.error || 'Facebookページトークンの取得に失敗しました。',
    };
  }

  const publishResponse = await fetchJson(
    `https://graph.facebook.com/${params.context.graphApiVersion || 'v20.0'}/${encodeURIComponent(pageTokenResult.pageId)}/feed`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: toFormBody({
        message: String(params.post.content || ''),
        access_token: pageTokenResult.pageAccessToken,
      }),
    }
  );

  if (!publishResponse.ok || !publishResponse.body || typeof publishResponse.body !== 'object') {
    return {
      provider: 'FACEBOOK',
      mode: 'REAL',
      status: 'FAILED',
      message:
        extractProviderErrorMessage(publishResponse.body) || `Facebook投稿に失敗しました。（status=${publishResponse.status}）`,
    };
  }

  const body = publishResponse.body as Record<string, unknown>;
  const externalPostId = typeof body.id === 'string' ? body.id : '';
  if (!externalPostId) {
    return { provider: 'FACEBOOK', mode: 'REAL', status: 'FAILED', message: 'Facebook投稿IDの取得に失敗しました。' };
  }

  return {
    provider: 'FACEBOOK',
    mode: 'REAL',
    status: 'SUCCESS',
    externalPostId,
    message: 'Facebookへ投稿しました。',
  };
};

const loadFirstPostMediaUrl = async (params: {
  supabaseAdmin: any;
  postId: string;
  transformSquare?: boolean;
}): Promise<string> => {
  const { data: mediaRows } = await params.supabaseAdmin
    .from('post_media')
    .select('storage_path')
    .eq('post_id', params.postId)
    .order('created_at', { ascending: true })
    .limit(1);

  const firstPath = mediaRows?.[0]?.storage_path;
  if (!firstPath) return '';

  const signed = await params.supabaseAdmin.storage.from('post-media').createSignedUrl(
    firstPath,
    10 * 60,
    params.transformSquare
      ? {
          transform: {
            width: 1080,
            height: 1080,
            resize: 'fill',
            format: 'origin',
          },
        }
      : undefined
  );
  if (signed.error || !signed.data?.signedUrl) return '';
  return signed.data.signedUrl;
};

const publishToInstagram = async (params: {
  supabaseAdmin: any;
  context: ProviderContext;
  post: PostRow;
  encryptionKey: string;
}): Promise<ProviderPublishResult> => {
  const imageUrl = await loadFirstPostMediaUrl({
    supabaseAdmin: params.supabaseAdmin,
    postId: params.post.id,
    transformSquare: true,
  });
  if (!imageUrl) {
    return {
      provider: 'INSTAGRAM',
      mode: 'REAL',
      status: 'FAILED',
      message: 'Instagram投稿には画像が必要です（post_media が未設定）。',
    };
  }

  const { accessToken } = await resolveMetaUserAccessToken({
    encryptedPayload: params.context.encryptedCredential,
    encryptionKey: params.encryptionKey,
  });
  if (!accessToken) {
    return { provider: 'INSTAGRAM', mode: 'REAL', status: 'FAILED', message: 'Instagram access_token が見つかりません。再連携してください。' };
  }

  const configuredPageId = readString(params.context.config, ['facebook_page_id', 'fb_page_id', 'page_id']);
  const configuredInstagramUserId = readString(params.context.config, ['instagram_user_id', 'ig_user_id']);
  const pageTokenResult = await resolveMetaPageAccessToken({
    userAccessToken: accessToken,
    graphApiVersion: params.context.graphApiVersion || 'v20.0',
    preferredPageId: configuredPageId || undefined,
  });

  if (!pageTokenResult.ok) {
    return {
      provider: 'INSTAGRAM',
      mode: 'REAL',
      status: 'FAILED',
      message: pageTokenResult.error || 'Metaページ情報の取得に失敗しました。',
    };
  }

  const instagramUserId = configuredInstagramUserId || pageTokenResult.instagramUserId || '';
  if (!instagramUserId) {
    return {
      provider: 'INSTAGRAM',
      mode: 'REAL',
      status: 'FAILED',
      message: 'instagram_user_id が未設定です。ID自動取得を実行してください。',
    };
  }

  const usableToken = pageTokenResult.pageAccessToken || accessToken;
  const graphVersion = params.context.graphApiVersion || 'v20.0';

  const createMedia = await fetchJson(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(instagramUserId)}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: toFormBody({
      image_url: imageUrl,
      caption: String(params.post.content || '').slice(0, 2200),
      access_token: usableToken,
    }),
  });

  if (!createMedia.ok || !createMedia.body || typeof createMedia.body !== 'object') {
    return {
      provider: 'INSTAGRAM',
      mode: 'REAL',
      status: 'FAILED',
      message:
        extractProviderErrorMessage(createMedia.body) || `Instagram media作成に失敗しました。（status=${createMedia.status}）`,
    };
  }

  const creationId = typeof (createMedia.body as Record<string, unknown>).id === 'string'
    ? String((createMedia.body as Record<string, unknown>).id)
    : '';
  if (!creationId) {
    return { provider: 'INSTAGRAM', mode: 'REAL', status: 'FAILED', message: 'Instagram media creation_id が取得できませんでした。' };
  }

  let publishBody: Record<string, unknown> | null = null;
  let publishErrorMessage = '';
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const publishResult = await fetchJson(
      `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(instagramUserId)}/media_publish`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: toFormBody({
          creation_id: creationId,
          access_token: usableToken,
        }),
      }
    );

    if (publishResult.ok && publishResult.body && typeof publishResult.body === 'object') {
      publishBody = publishResult.body as Record<string, unknown>;
      break;
    }

    publishErrorMessage =
      extractProviderErrorMessage(publishResult.body) || `Instagram publishに失敗しました。（status=${publishResult.status}）`;
    const normalized = publishErrorMessage.toLowerCase();
    const isRetryable =
      normalized.includes('media id is not available') ||
      normalized.includes('media is not ready') ||
      normalized.includes('temporarily unavailable');

    if (!isRetryable || attempt === maxAttempts) {
      break;
    }

    await sleep(attempt * 1500);
  }

  if (!publishBody) {
    return {
      provider: 'INSTAGRAM',
      mode: 'REAL',
      status: 'FAILED',
      message: publishErrorMessage || 'Instagram publishに失敗しました。',
    };
  }

  const externalPostId = typeof publishBody.id === 'string' ? String(publishBody.id) : '';
  if (!externalPostId) {
    return { provider: 'INSTAGRAM', mode: 'REAL', status: 'FAILED', message: 'Instagram投稿IDの取得に失敗しました。' };
  }

  return {
    provider: 'INSTAGRAM',
    mode: 'REAL',
    status: 'SUCCESS',
    externalPostId,
    message: 'Instagramへ投稿しました。',
  };
};

const publishToGbp = async (params: {
  supabaseAdmin: any;
  context: ProviderContext;
  post: PostRow;
  encryptionKey: string;
}): Promise<ProviderPublishResult> => {
  const clientId = readString(params.context.config, ['client_id', 'google_client_id']);
  if (!clientId || !params.context.providerSecret) {
    return {
      provider: 'GBP',
      mode: 'REAL',
      status: 'FAILED',
      message: 'GBPの client_id または client_secret が不足しています。',
    };
  }

  const tokenResolution = await ensureGoogleAccessToken({
    supabaseAdmin: params.supabaseAdmin,
    integrationId: params.context.integrationId,
    encryptedPayload: params.context.encryptedCredential,
    encryptionKey: params.encryptionKey,
    clientId,
    clientSecret: params.context.providerSecret,
  });

  if (!tokenResolution.ok || !tokenResolution.accessToken) {
    return {
      provider: 'GBP',
      mode: 'REAL',
      status: 'FAILED',
      message: tokenResolution.error || 'GBP access_token の取得に失敗しました。',
    };
  }

  const location = await resolveAndPersistGbpLocation({
    supabaseAdmin: params.supabaseAdmin,
    providerConfigurationId: params.context.configurationId,
    config: params.context.config,
    accessToken: tokenResolution.accessToken,
  });
  if (!location.ok || !location.accountId || !location.locationId) {
    return {
      provider: 'GBP',
      mode: 'REAL',
      status: 'FAILED',
      message: location.error || 'GBPの店舗ID（location_id）が未設定です。',
    };
  }

  const endpoint = `https://mybusiness.googleapis.com/v4/accounts/${encodeURIComponent(
    location.accountId
  )}/locations/${encodeURIComponent(location.locationId)}/localPosts`;

  const imageUrl = await loadFirstPostMediaUrl({ supabaseAdmin: params.supabaseAdmin, postId: params.post.id });

  const body: Record<string, unknown> = {
    languageCode: 'ja',
    summary: String(params.post.content || '').slice(0, 1500),
    topicType: 'STANDARD',
  };
  if (imageUrl) {
    body.media = [
      {
        mediaFormat: 'PHOTO',
        sourceUrl: imageUrl,
      },
    ];
  }

  const publishResponse = await fetchJson(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenResolution.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!publishResponse.ok || !publishResponse.body || typeof publishResponse.body !== 'object') {
    return {
      provider: 'GBP',
      mode: 'REAL',
      status: 'FAILED',
      message: extractProviderErrorMessage(publishResponse.body) || `GBP投稿に失敗しました。（status=${publishResponse.status}）`,
    };
  }

  const responseBody = publishResponse.body as Record<string, unknown>;
  const externalPostId =
    (typeof responseBody.name === 'string' && responseBody.name) ||
    (typeof responseBody.localPostId === 'string' && responseBody.localPostId) ||
    '';

  if (!externalPostId) {
    return {
      provider: 'GBP',
      mode: 'REAL',
      status: 'FAILED',
      message: 'GBP投稿IDの取得に失敗しました。',
    };
  }

  return {
    provider: 'GBP',
    mode: 'REAL',
    status: 'SUCCESS',
    externalPostId,
    message: 'Googleビジネスプロフィールへ投稿しました。',
  };
};

const executeProviderPublish = async (params: {
  supabaseAdmin: any;
  encryptionKey: string;
  storeId: string;
  orgId: string;
  post: PostRow;
  provider: PublishProvider;
}): Promise<ProviderPublishResult> => {
  const context = await resolveProviderContext({
    supabaseAdmin: params.supabaseAdmin,
    encryptionKey: params.encryptionKey,
    storeId: params.storeId,
    orgId: params.orgId,
    provider: params.provider,
  });

  if (!context) {
    return {
      provider: params.provider,
      mode: 'REAL',
      status: 'FAILED',
      message: `${params.provider} の連携設定が見つかりません。`,
    };
  }

  if (context.connectionStatus !== 'CONNECTED' || context.integrationStatus !== 'CONNECTED') {
    return {
      provider: params.provider,
      mode: 'REAL',
      status: 'FAILED',
      message: `${params.provider} は未接続です。接続テストを実行してください。`,
    };
  }

  if (!context.integrationId || !context.encryptedCredential) {
    return {
      provider: params.provider,
      mode: 'REAL',
      status: 'FAILED',
      message: `${params.provider} のOAuthトークンが未設定です。連携をやり直してください。`,
    };
  }

  if (params.provider === 'FACEBOOK') {
    return publishToFacebook({
      context,
      post: params.post,
      encryptionKey: params.encryptionKey,
    });
  }

  if (params.provider === 'INSTAGRAM') {
    return publishToInstagram({
      supabaseAdmin: params.supabaseAdmin,
      context,
      post: params.post,
      encryptionKey: params.encryptionKey,
    });
  }

  return publishToGbp({
    supabaseAdmin: params.supabaseAdmin,
    context,
    post: params.post,
    encryptionKey: params.encryptionKey,
  });
};

export const loadPostForPublish = async (supabaseAdmin: any, postId: string): Promise<(PostRow & { org_id: string }) | null> => {
  const { data: post } = await supabaseAdmin
    .from('posts')
    .select('id, store_id, content, platforms, scheduled_at, approval_status')
    .eq('id', postId)
    .maybeSingle();

  if (!post) return null;

  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id, org_id')
    .eq('id', post.store_id)
    .maybeSingle();
  if (!store?.org_id) return null;

  return {
    id: post.id,
    store_id: post.store_id,
    content: String(post.content || ''),
    platforms: Array.isArray(post.platforms) ? post.platforms.map((item: unknown) => String(item)) : [],
    scheduled_at: post.scheduled_at,
    approval_status: String(post.approval_status || 'NONE'),
    org_id: store.org_id,
  };
};

export const runPostPublish = async (params: {
  supabaseAdmin: any;
  encryptionKey: string;
  post: PostRow & { org_id: string };
  requestedByUserId?: string | null;
  providers?: string[];
}): Promise<{ ok: boolean; results: ProviderPublishResult[] }> => {
  const providers = resolvePostProviders(params.post, params.providers);
  const fallbackProvider: PublishProvider = providers[0] || 'FACEBOOK';
  const now = Date.now();
  const scheduledAtMs = params.post.scheduled_at ? new Date(params.post.scheduled_at).getTime() : 0;
  if (params.post.approval_status !== 'APPROVED') {
    return {
      ok: false,
      results: [
        {
          provider: fallbackProvider,
          mode: 'REAL',
          status: 'FAILED',
          message: '承認済み投稿のみ公開できます。',
        },
      ],
    };
  }
  if (scheduledAtMs && !Number.isNaN(scheduledAtMs) && scheduledAtMs > now) {
    return {
      ok: false,
      results: [
        {
          provider: fallbackProvider,
          mode: 'REAL',
          status: 'FAILED',
          message: '予約時刻前のため公開できません。',
        },
      ],
    };
  }

  if (providers.length === 0) {
    return {
      ok: false,
      results: [
        {
          provider: 'FACEBOOK',
          mode: 'REAL',
          status: 'FAILED',
          message: '投稿先プラットフォームが選択されていません。',
        },
      ],
    };
  }

  const results: ProviderPublishResult[] = [];
  for (const provider of providers) {
    const result = await executeProviderPublish({
      supabaseAdmin: params.supabaseAdmin,
      encryptionKey: params.encryptionKey,
      storeId: params.post.store_id,
      orgId: params.post.org_id,
      post: params.post,
      provider,
    });
    results.push(result);

    const { error: logError } = await params.supabaseAdmin.from('post_publish_logs').insert({
      post_id: params.post.id,
      store_id: params.post.store_id,
      provider,
      mode: result.mode,
      status: result.status,
      message: result.message || null,
      external_post_id: result.externalPostId || null,
      requested_by_user_id: params.requestedByUserId || null,
    });

    if (logError) {
      results.push({
        provider,
        mode: 'REAL',
        status: 'FAILED',
        message: `publishログの保存に失敗しました。${logError.message}`,
      });
    }
  }

  const allSuccess = results.every((result) => result.status === 'SUCCESS');
  await params.supabaseAdmin
    .from('posts')
    .update({
      status: allSuccess ? 'PUBLISHED' : 'FAILED',
      published_at: allSuccess ? new Date().toISOString() : null,
    })
    .eq('id', params.post.id);

  return {
    ok: allSuccess,
    results,
  };
};
