import { extractProviderErrorMessage, fetchJson, readString } from './http.ts';

export type GbpLocationResolution = {
  ok: boolean;
  accountId?: string;
  locationId?: string;
  locationName?: string;
  source?: 'CONFIG' | 'AUTO';
  error?: string;
};

const normalizeLocationName = (raw: string): string => {
  const value = (raw || '').trim();
  if (!value) return '';
  if (value.startsWith('locations/')) return value;

  const locationMatch = value.match(/locations\/([^/]+)/);
  if (locationMatch?.[1]) {
    return `locations/${locationMatch[1]}`;
  }
  return '';
};

const parseAccountId = (raw: string): string => {
  const value = (raw || '').trim();
  if (!value) return '';
  const matched = value.match(/accounts\/([^/]+)/);
  return matched?.[1] || '';
};

const parseLocationId = (raw: string): string => {
  const value = (raw || '').trim();
  if (!value) return '';
  const matched = value.match(/locations\/([^/]+)/);
  return matched?.[1] || '';
};

export const resolveGbpLocationFromConfig = (config: Record<string, unknown>): GbpLocationResolution => {
  const accountIdFromConfig = readString(config, ['gbp_account_id', 'account_id']);
  const locationIdFromConfig = readString(config, ['gbp_location_id', 'location_id']);
  const locationNameFromConfig = readString(config, ['location_name', 'gbp_location_name']);

  const normalizedLocationName = normalizeLocationName(
    locationNameFromConfig || (locationIdFromConfig ? `locations/${locationIdFromConfig}` : '')
  );
  const parsedAccountIdFromLocationName = parseAccountId(locationNameFromConfig);
  const parsedLocationIdFromLocationName = parseLocationId(locationNameFromConfig || normalizedLocationName);

  const accountId = accountIdFromConfig || parsedAccountIdFromLocationName;
  const locationId = locationIdFromConfig || parsedLocationIdFromLocationName;
  const locationName = normalizedLocationName || (locationId ? `locations/${locationId}` : '');

  if (!locationName) {
    return { ok: false, error: 'GBPの店舗ID（location_id）が未設定です。' };
  }

  return {
    ok: true,
    accountId: accountId || undefined,
    locationId: locationId || undefined,
    locationName,
    source: 'CONFIG',
  };
};

const discoverGbpPrimaryLocation = async (accessToken: string): Promise<GbpLocationResolution> => {
  const accountsResponse = await fetchJson('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!accountsResponse.ok) {
    return {
      ok: false,
      error:
        extractProviderErrorMessage(accountsResponse.body) ||
        `GBPアカウント一覧取得に失敗しました。（status=${accountsResponse.status}）`,
    };
  }

  const accountsBody =
    accountsResponse.body && typeof accountsResponse.body === 'object'
      ? (accountsResponse.body as Record<string, unknown>)
      : {};
  const accounts = Array.isArray(accountsBody.accounts) ? accountsBody.accounts : [];
  if (accounts.length === 0) {
    return { ok: false, error: 'GBPアカウントが見つかりません。' };
  }

  const firstAccount =
    accounts
      .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>) : null))
      .find((row) => Boolean(readString(row || {}, ['name']))) || null;

  if (!firstAccount) {
    return { ok: false, error: 'GBPアカウントの解析に失敗しました。' };
  }

  const accountName = readString(firstAccount, ['name']);
  const accountId = parseAccountId(accountName);
  if (!accountName || !accountId) {
    return { ok: false, error: 'GBPアカウントIDの解析に失敗しました。' };
  }

  const locationsEndpoint = `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?pageSize=100&readMask=name,title`;
  const locationsResponse = await fetchJson(locationsEndpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!locationsResponse.ok) {
    return {
      ok: false,
      error:
        extractProviderErrorMessage(locationsResponse.body) ||
        `GBP店舗一覧取得に失敗しました。（status=${locationsResponse.status}）`,
    };
  }

  const locationsBody =
    locationsResponse.body && typeof locationsResponse.body === 'object'
      ? (locationsResponse.body as Record<string, unknown>)
      : {};
  const locations = Array.isArray(locationsBody.locations) ? locationsBody.locations : [];
  const firstLocation =
    locations
      .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>) : null))
      .find((row) => Boolean(readString(row || {}, ['name']))) || null;

  if (!firstLocation) {
    return { ok: false, error: 'GBP店舗が見つかりません。' };
  }

  const rawLocationName = readString(firstLocation, ['name']);
  const locationName = normalizeLocationName(rawLocationName);
  const locationId = parseLocationId(rawLocationName || locationName);

  if (!locationName || !locationId) {
    return { ok: false, error: 'GBP店舗ID（location_id）の解析に失敗しました。' };
  }

  return {
    ok: true,
    accountId,
    locationId,
    locationName,
    source: 'AUTO',
  };
};

const discoverAccountForLocation = async (
  accessToken: string,
  locationId: string
): Promise<{ ok: boolean; accountId?: string; locationName?: string; error?: string }> => {
  const targetLocationName = `locations/${locationId}`;
  const accountsResponse = await fetchJson('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!accountsResponse.ok) {
    return {
      ok: false,
      error:
        extractProviderErrorMessage(accountsResponse.body) ||
        `GBPアカウント一覧取得に失敗しました。（status=${accountsResponse.status}）`,
    };
  }

  const accountsBody =
    accountsResponse.body && typeof accountsResponse.body === 'object'
      ? (accountsResponse.body as Record<string, unknown>)
      : {};
  const accounts = Array.isArray(accountsBody.accounts) ? accountsBody.accounts : [];
  for (const accountRaw of accounts) {
    if (!accountRaw || typeof accountRaw !== 'object') continue;
    const account = accountRaw as Record<string, unknown>;
    const accountName = readString(account, ['name']);
    const accountId = parseAccountId(accountName);
    if (!accountName || !accountId) continue;

    const locationsEndpoint = `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?pageSize=100&readMask=name`;
    const locationsResponse = await fetchJson(locationsEndpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!locationsResponse.ok || !locationsResponse.body || typeof locationsResponse.body !== 'object') {
      continue;
    }

    const locationsBody = locationsResponse.body as Record<string, unknown>;
    const locations = Array.isArray(locationsBody.locations) ? locationsBody.locations : [];
    const matched = locations
      .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>) : null))
      .find((row) => normalizeLocationName(readString(row || {}, ['name'])) === targetLocationName);

    if (matched) {
      return {
        ok: true,
        accountId,
        locationName: normalizeLocationName(readString(matched, ['name'])) || targetLocationName,
      };
    }
  }

  return { ok: false, error: 'GBPアカウントIDの自動特定に失敗しました。' };
};

const patchGbpLocationConfig = async (params: {
  supabaseAdmin: any;
  providerConfigurationId: string;
  currentConfig: Record<string, unknown>;
  location: GbpLocationResolution;
}) => {
  const current = params.currentConfig;
  const next: Record<string, unknown> = { ...current };

  if (params.location.accountId) {
    next.gbp_account_id = params.location.accountId;
    if (!readString(current, ['account_id'])) {
      next.account_id = params.location.accountId;
    }
  }
  if (params.location.locationId) {
    next.gbp_location_id = params.location.locationId;
    next.location_id = params.location.locationId;
  }
  if (params.location.locationName) {
    next.location_name = params.location.locationName;
  }

  if (JSON.stringify(current) === JSON.stringify(next)) {
    return;
  }

  await params.supabaseAdmin
    .from('provider_configurations')
    .update({
      config: next,
      has_gui_config: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.providerConfigurationId);
};

export const resolveAndPersistGbpLocation = async (params: {
  supabaseAdmin: any;
  providerConfigurationId: string;
  config: Record<string, unknown>;
  accessToken: string;
}): Promise<GbpLocationResolution> => {
  const fromConfig = resolveGbpLocationFromConfig(params.config);
  if (fromConfig.ok) {
    if (fromConfig.accountId || !fromConfig.locationId) {
      return fromConfig;
    }

    const accountDiscovery = await discoverAccountForLocation(params.accessToken, fromConfig.locationId);
    if (!accountDiscovery.ok || !accountDiscovery.accountId) {
      return fromConfig;
    }

    const enriched: GbpLocationResolution = {
      ...fromConfig,
      accountId: accountDiscovery.accountId,
      locationName: fromConfig.locationName || accountDiscovery.locationName,
      source: 'AUTO',
    };
    await patchGbpLocationConfig({
      supabaseAdmin: params.supabaseAdmin,
      providerConfigurationId: params.providerConfigurationId,
      currentConfig: params.config,
      location: enriched,
    });
    return enriched;
  }

  const discovered = await discoverGbpPrimaryLocation(params.accessToken);
  if (!discovered.ok) {
    return discovered;
  }

  await patchGbpLocationConfig({
    supabaseAdmin: params.supabaseAdmin,
    providerConfigurationId: params.providerConfigurationId,
    currentConfig: params.config,
    location: discovered,
  });

  return discovered;
};
