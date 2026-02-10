import {
  NapConsistencyExecutionResult,
  NapConsistencyResult,
  NapConsistencyResultStatus,
  NapConsistencyRun,
  NapConsistencySummary,
} from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import { providerCatalogService } from './providerCatalogService';
import { storesService } from './storesService';
import { napAlertService } from './napAlertService';
import { migrationRequiredMessage } from './migrationRequiredMessage';

type DbNapRunRow = {
  id: string;
  store_id: string;
  trigger_type: 'MANUAL' | 'SCHEDULED';
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  message: string | null;
  summary: Record<string, unknown> | null;
  requested_by_user_id: string | null;
  started_at: string;
  finished_at: string | null;
  created_at: string;
};

type DbNapResultRow = {
  id: string;
  run_id: string;
  store_id: string;
  provider_catalog_id: string | null;
  provider_key: string;
  provider_name: string;
  expected_name: string | null;
  expected_address: string | null;
  expected_phone: string | null;
  observed_name: string | null;
  observed_address: string | null;
  observed_phone: string | null;
  name_match: boolean | null;
  address_match: boolean | null;
  phone_match: boolean | null;
  status: NapConsistencyResultStatus;
  mismatch_fields: string[] | null;
  message: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

type DbProviderConfigurationRow = {
  provider_catalog_id: string;
  config: Record<string, unknown> | null;
  has_gui_config: boolean;
  connection_status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
};

type ExtractedNapValue = {
  value: string;
  sourceKey: string;
};

const MIGRATION_ERROR_MESSAGE = migrationRequiredMessage('店舗情報チェック');

const NAP_KEY_CANDIDATES = {
  name: ['name', 'store_name', 'storeName', 'business_name', 'businessName', 'location_name', 'locationName', 'nap_name'],
  address: ['address', 'store_address', 'storeAddress', 'business_address', 'businessAddress', 'nap_address'],
  phone: ['phone', 'phone_number', 'phoneNumber', 'store_phone', 'storePhone', 'business_phone', 'businessPhone', 'nap_phone'],
};

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、店舗情報チェックを実行できません。');
  }
  return supabase;
};

const isMissingRelationError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: string }).code || '') : '';
  const message = 'message' in error ? String((error as { message?: string }).message || '') : '';
  return code === '42P01' || message.includes('does not exist');
};

const normalizeKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const normalizeName = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/[\s　]+/g, '').trim();

const normalizeAddress = (value: string): string =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[‐‑‒–—―ー−-]/g, '')
    .replace(/[,.、。]/g, '')
    .trim();

const normalizePhone = (value: string): string => {
  const digits = value.normalize('NFKC').replace(/\D/g, '');
  if (digits.startsWith('81') && digits.length >= 11) {
    return `0${digits.slice(2)}`;
  }
  return digits;
};

const normalizeSummary = (input: Record<string, unknown> | null | undefined): NapConsistencySummary => ({
  total: Number(input?.total || 0),
  match: Number(input?.match || 0),
  mismatch: Number(input?.mismatch || 0),
  missing: Number(input?.missing || 0),
});

const mapRun = (row: DbNapRunRow): NapConsistencyRun => ({
  id: row.id,
  storeId: row.store_id,
  triggerType: row.trigger_type,
  status: row.status,
  message: row.message || undefined,
  summary: normalizeSummary(row.summary),
  requestedByUserId: row.requested_by_user_id || undefined,
  startedAt: new Date(row.started_at),
  finishedAt: row.finished_at ? new Date(row.finished_at) : undefined,
  createdAt: new Date(row.created_at),
});

const mapResult = (row: DbNapResultRow): NapConsistencyResult => ({
  id: row.id,
  runId: row.run_id,
  storeId: row.store_id,
  providerCatalogId: row.provider_catalog_id || undefined,
  providerKey: row.provider_key,
  providerName: row.provider_name,
  expectedName: row.expected_name || undefined,
  expectedAddress: row.expected_address || undefined,
  expectedPhone: row.expected_phone || undefined,
  observedName: row.observed_name || undefined,
  observedAddress: row.observed_address || undefined,
  observedPhone: row.observed_phone || undefined,
  nameMatch: typeof row.name_match === 'boolean' ? row.name_match : undefined,
  addressMatch: typeof row.address_match === 'boolean' ? row.address_match : undefined,
  phoneMatch: typeof row.phone_match === 'boolean' ? row.phone_match : undefined,
  status: row.status,
  mismatchFields: row.mismatch_fields || [],
  message: row.message || undefined,
  details: row.details || {},
  createdAt: new Date(row.created_at),
});

const flattenStringValues = (input: Record<string, unknown> | null | undefined): Array<{ key: string; value: string }> => {
  if (!input || typeof input !== 'object') return [];

  const rows: Array<{ key: string; value: string }> = [];
  const walk = (value: unknown, prefix: string, depth: number) => {
    if (depth > 2) return;
    if (typeof value === 'string') {
      const normalized = value.trim();
      if (normalized.length > 0) rows.push({ key: prefix, value: normalized });
      return;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;

    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      walk(child, path, depth + 1);
    });
  };

  walk(input, '', 0);
  return rows;
};

const extractByCandidates = (config: Record<string, unknown> | null | undefined, candidates: string[]): ExtractedNapValue | null => {
  const flattened = flattenStringValues(config);
  if (flattened.length === 0) return null;
  const normalizedCandidates = candidates.map((candidate) => normalizeKey(candidate));
  for (const candidate of normalizedCandidates) {
    const matched = flattened.find(({ key }) => {
      const normalizedKey = normalizeKey(key);
      return normalizedKey === candidate || normalizedKey.endsWith(candidate);
    });
    if (matched) {
      return { value: matched.value, sourceKey: matched.key };
    }
  }
  return null;
};

const compareField = (
  expectedValue: string | undefined,
  observedValue: string | undefined,
  field: 'name' | 'address' | 'phone'
): { isMatch?: boolean; isComparable: boolean; mismatch: boolean } => {
  if (!expectedValue && !observedValue) {
    return { isComparable: false, mismatch: false };
  }
  if (!expectedValue || !observedValue) {
    return { isComparable: false, mismatch: true };
  }

  const expected =
    field === 'phone' ? normalizePhone(expectedValue) : field === 'address' ? normalizeAddress(expectedValue) : normalizeName(expectedValue);
  const observed =
    field === 'phone' ? normalizePhone(observedValue) : field === 'address' ? normalizeAddress(observedValue) : normalizeName(observedValue);

  const isMatch = expected.length > 0 && observed.length > 0 ? expected === observed : false;
  return { isMatch, isComparable: true, mismatch: !isMatch };
};

const formatSummaryMessage = (summary: NapConsistencySummary): string =>
  `NAPチェック完了: MATCH ${summary.match}件 / MISMATCH ${summary.mismatch}件 / MISSING ${summary.missing}件`;

export const napConsistencyService = {
  async listRunsByStore(storeId: string, limit = 20): Promise<NapConsistencyRun[]> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('nap_consistency_runs')
      .select('id, store_id, trigger_type, status, message, summary, requested_by_user_id, started_at, finished_at, created_at')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error && isMissingRelationError(error)) throw new Error(MIGRATION_ERROR_MESSAGE);
    if (error) throw error;
    return ((data || []) as DbNapRunRow[]).map(mapRun);
  },

  async listResultsByRun(runId: string): Promise<NapConsistencyResult[]> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('nap_consistency_results')
      .select(
        'id, run_id, store_id, provider_catalog_id, provider_key, provider_name, expected_name, expected_address, expected_phone, observed_name, observed_address, observed_phone, name_match, address_match, phone_match, status, mismatch_fields, message, details, created_at'
      )
      .eq('run_id', runId)
      .order('provider_name', { ascending: true });
    if (error && isMissingRelationError(error)) throw new Error(MIGRATION_ERROR_MESSAGE);
    if (error) throw error;
    return ((data || []) as DbNapResultRow[]).map(mapResult);
  },

  async runManualCheck(params: { storeId: string; requestedByUserId: string }): Promise<NapConsistencyExecutionResult> {
    const client = requireSupabase();
    const store = await storesService.getById(params.storeId);
    if (!store) {
      throw new Error('対象店舗が見つかりません。');
    }

    const { data: createdRunData, error: createRunError } = await client
      .from('nap_consistency_runs')
      .insert({
        store_id: params.storeId,
        trigger_type: 'MANUAL',
        status: 'RUNNING',
        requested_by_user_id: params.requestedByUserId,
      })
      .select('id, store_id, trigger_type, status, message, summary, requested_by_user_id, started_at, finished_at, created_at')
      .single();
    if (createRunError && isMissingRelationError(createRunError)) throw new Error(MIGRATION_ERROR_MESSAGE);
    if (createRunError) throw createRunError;

    const run = mapRun(createdRunData as DbNapRunRow);
    const finalize = async (status: NapConsistencyRun['status'], summary: NapConsistencySummary, message: string) => {
      await client
        .from('nap_consistency_runs')
        .update({
          status,
          summary,
          message,
          finished_at: new Date().toISOString(),
        })
        .eq('id', run.id);
    };

    try {
      const providerRows = await providerCatalogService.listByOrg(store.orgId);
      const providerCatalogs = providerRows.map((row) => row.catalog).filter((catalog) => catalog.isActive);

      const { data: configData, error: configError } = await client
        .from('provider_configurations')
        .select('provider_catalog_id, config, has_gui_config, connection_status')
        .eq('store_id', params.storeId);
      if (configError && isMissingRelationError(configError)) throw new Error(MIGRATION_ERROR_MESSAGE);
      if (configError) throw configError;
      const configMap = new Map<string, DbProviderConfigurationRow>();
      ((configData || []) as DbProviderConfigurationRow[]).forEach((row) => {
        configMap.set(row.provider_catalog_id, row);
      });

      const resultPayload = providerCatalogs.map((catalog) => {
        const configRow = configMap.get(catalog.id);
        const expectedName = store.name || undefined;
        const expectedAddress = store.address || undefined;
        const expectedPhone = store.phone || undefined;

        if (!configRow || !configRow.has_gui_config) {
          return {
            run_id: run.id,
            store_id: params.storeId,
            provider_catalog_id: catalog.id,
            provider_key: catalog.providerKey,
            provider_name: catalog.displayName,
            expected_name: expectedName || null,
            expected_address: expectedAddress || null,
            expected_phone: expectedPhone || null,
            observed_name: null,
            observed_address: null,
            observed_phone: null,
            name_match: null,
            address_match: null,
            phone_match: null,
            status: 'MISSING',
            mismatch_fields: ['name', 'address', 'phone'],
            message: 'provider設定が未入力のため比較できません。',
            details: {
              connectionStatus: configRow?.connection_status || 'DISCONNECTED',
              hasGuiConfig: configRow?.has_gui_config || false,
            },
          };
        }

        const observedName = extractByCandidates(configRow.config, NAP_KEY_CANDIDATES.name);
        const observedAddress = extractByCandidates(configRow.config, NAP_KEY_CANDIDATES.address);
        const observedPhone = extractByCandidates(configRow.config, NAP_KEY_CANDIDATES.phone);

        const comparedName = compareField(expectedName, observedName?.value, 'name');
        const comparedAddress = compareField(expectedAddress, observedAddress?.value, 'address');
        const comparedPhone = compareField(expectedPhone, observedPhone?.value, 'phone');

        const mismatchFields: string[] = [];
        if (comparedName.mismatch) mismatchFields.push('name');
        if (comparedAddress.mismatch) mismatchFields.push('address');
        if (comparedPhone.mismatch) mismatchFields.push('phone');

        const hasObservedNap = Boolean(observedName?.value || observedAddress?.value || observedPhone?.value);
        const status: NapConsistencyResultStatus = !hasObservedNap
          ? 'MISSING'
          : mismatchFields.length === 0
            ? 'MATCH'
            : 'MISMATCH';

        const message =
          status === 'MATCH'
            ? 'NAP整合OK'
            : status === 'MISSING'
              ? 'NAP項目がprovider設定に見つかりません。'
              : `不一致: ${mismatchFields.join(', ')}`;

        return {
          run_id: run.id,
          store_id: params.storeId,
          provider_catalog_id: catalog.id,
          provider_key: catalog.providerKey,
          provider_name: catalog.displayName,
          expected_name: expectedName || null,
          expected_address: expectedAddress || null,
          expected_phone: expectedPhone || null,
          observed_name: observedName?.value || null,
          observed_address: observedAddress?.value || null,
          observed_phone: observedPhone?.value || null,
          name_match: comparedName.isComparable ? comparedName.isMatch : null,
          address_match: comparedAddress.isComparable ? comparedAddress.isMatch : null,
          phone_match: comparedPhone.isComparable ? comparedPhone.isMatch : null,
          status,
          mismatch_fields: mismatchFields,
          message,
          details: {
            connectionStatus: configRow.connection_status,
            sourceKeys: {
              name: observedName?.sourceKey || null,
              address: observedAddress?.sourceKey || null,
              phone: observedPhone?.sourceKey || null,
            },
          },
        };
      });

      if (resultPayload.length > 0) {
        const { error: insertResultError } = await client.from('nap_consistency_results').insert(resultPayload);
        if (insertResultError && isMissingRelationError(insertResultError)) throw new Error(MIGRATION_ERROR_MESSAGE);
        if (insertResultError) throw insertResultError;
      }

      // Best-effort: P3-06（NAPアラート）へ同期。migration未適用でもP3-05は成功させる。
      try {
        const createdResults = await napConsistencyService.listResultsByRun(run.id);
        await napAlertService.syncFromRunResults({
          storeId: params.storeId,
          runId: run.id,
          checkedAt: new Date(),
          requestedByUserId: params.requestedByUserId,
          results: createdResults.map((item) => ({
            id: item.id,
            providerCatalogId: item.providerCatalogId,
            providerKey: item.providerKey,
            providerName: item.providerName,
            status: item.status,
            mismatchFields: item.mismatchFields,
          })),
        });
      } catch (error) {
        console.warn('[napConsistencyService] Failed to sync NAP alerts:', error);
      }

      const summary: NapConsistencySummary = {
        total: resultPayload.length,
        match: resultPayload.filter((row) => row.status === 'MATCH').length,
        mismatch: resultPayload.filter((row) => row.status === 'MISMATCH').length,
        missing: resultPayload.filter((row) => row.status === 'MISSING').length,
      };
      const message = formatSummaryMessage(summary);
      await finalize('SUCCESS', summary, message);

      return {
        ok: true,
        runId: run.id,
        status: 'SUCCESS',
        summary,
        message,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '店舗情報チェックの実行に失敗しました。';
      await finalize('FAILED', { total: 0, match: 0, mismatch: 0, missing: 0 }, message);
      throw error;
    }
  },
};
