import { NapAlert, NapAlertStatus, NapConsistencyResult, NapConsistencyResultStatus } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import { migrationRequiredMessage } from './migrationRequiredMessage';

type DbNapAlertRow = {
  id: string;
  store_id: string;
  provider_catalog_id: string | null;
  provider_key: string;
  provider_name: string;
  status: NapAlertStatus;
  last_result_status: NapConsistencyResultStatus;
  mismatch_fields: string[] | null;
  last_run_id: string | null;
  last_result_id: string | null;
  first_detected_at: string;
  opened_at: string;
  last_detected_at: string;
  last_checked_at: string;
  acknowledged_at: string | null;
  acknowledged_by_user_id: string | null;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  note: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type SyncResultRow = Pick<
  NapConsistencyResult,
  'id' | 'providerCatalogId' | 'providerKey' | 'providerName' | 'status' | 'mismatchFields'
>;

const MIGRATION_ERROR_MESSAGE = migrationRequiredMessage('店舗情報チェック（アラート）');

const SELECT_COLUMNS =
  'id, store_id, provider_catalog_id, provider_key, provider_name, status, last_result_status, mismatch_fields, last_run_id, last_result_id, first_detected_at, opened_at, last_detected_at, last_checked_at, acknowledged_at, acknowledged_by_user_id, resolved_at, resolved_by_user_id, note, updated_by, created_at, updated_at';

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、店舗情報チェック（アラート）を利用できません。');
  }
  return supabase;
};

const isMissingRelationError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: string }).code || '') : '';
  const message = 'message' in error ? String((error as { message?: string }).message || '') : '';
  return code === '42P01' || message.includes('does not exist');
};

const mapAlert = (row: DbNapAlertRow): NapAlert => ({
  id: row.id,
  storeId: row.store_id,
  providerCatalogId: row.provider_catalog_id || undefined,
  providerKey: row.provider_key,
  providerName: row.provider_name,
  status: row.status,
  lastResultStatus: row.last_result_status,
  mismatchFields: row.mismatch_fields || [],
  lastRunId: row.last_run_id || undefined,
  lastResultId: row.last_result_id || undefined,
  firstDetectedAt: new Date(row.first_detected_at),
  openedAt: new Date(row.opened_at),
  lastDetectedAt: new Date(row.last_detected_at),
  lastCheckedAt: new Date(row.last_checked_at),
  acknowledgedAt: row.acknowledged_at ? new Date(row.acknowledged_at) : undefined,
  acknowledgedByUserId: row.acknowledged_by_user_id || undefined,
  resolvedAt: row.resolved_at ? new Date(row.resolved_at) : undefined,
  resolvedByUserId: row.resolved_by_user_id || undefined,
  note: row.note || undefined,
  updatedBy: row.updated_by || undefined,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

export const napAlertService = {
  async listActiveByStore(storeId: string, limit = 50): Promise<NapAlert[]> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('nap_alerts')
      .select(SELECT_COLUMNS)
      .eq('store_id', storeId)
      .in('status', ['OPEN', 'ACKED'])
      .order('last_detected_at', { ascending: false })
      .order('provider_name', { ascending: true })
      .limit(limit);
    if (error && isMissingRelationError(error)) throw new Error(MIGRATION_ERROR_MESSAGE);
    if (error) throw error;
    return ((data || []) as DbNapAlertRow[]).map(mapAlert);
  },

  async updateStatus(params: { id: string; status: NapAlertStatus; updatedBy: string; note?: string }): Promise<NapAlert> {
    const client = requireSupabase();
    const nowIso = new Date().toISOString();

    const payload: Record<string, unknown> = {
      status: params.status,
      updated_by: params.updatedBy,
    };

    if (typeof params.note === 'string') {
      const normalized = params.note.trim();
      payload.note = normalized.length > 0 ? normalized.slice(0, 500) : null;
    }

    if (params.status === 'OPEN') {
      payload.opened_at = nowIso;
      payload.acknowledged_at = null;
      payload.acknowledged_by_user_id = null;
      payload.resolved_at = null;
      payload.resolved_by_user_id = null;
    } else if (params.status === 'ACKED') {
      payload.acknowledged_at = nowIso;
      payload.acknowledged_by_user_id = params.updatedBy;
      payload.resolved_at = null;
      payload.resolved_by_user_id = null;
    } else if (params.status === 'RESOLVED') {
      payload.resolved_at = nowIso;
      payload.resolved_by_user_id = params.updatedBy;
    }

    const { data, error } = await client.from('nap_alerts').update(payload).eq('id', params.id).select(SELECT_COLUMNS).single();
    if (error && isMissingRelationError(error)) throw new Error(MIGRATION_ERROR_MESSAGE);
    if (error) throw error;
    return mapAlert(data as DbNapAlertRow);
  },

  async syncFromRunResults(params: {
    storeId: string;
    runId: string;
    checkedAt: Date;
    requestedByUserId: string;
    results: SyncResultRow[];
  }): Promise<void> {
    const client = requireSupabase();
    if (params.results.length === 0) return;

    const nowIso = params.checkedAt.toISOString();
    const keys = Array.from(new Set(params.results.map((row) => row.providerKey)));

    const { data: existingRows, error: existingError } = await client
      .from('nap_alerts')
      .select(SELECT_COLUMNS)
      .eq('store_id', params.storeId)
      .in('provider_key', keys);
    if (existingError && isMissingRelationError(existingError)) throw new Error(MIGRATION_ERROR_MESSAGE);
    if (existingError) throw existingError;

    const existingMap = new Map<string, DbNapAlertRow>();
    ((existingRows || []) as DbNapAlertRow[]).forEach((row) => {
      existingMap.set(row.provider_key, row);
    });

    const inserts: Array<Record<string, unknown>> = [];

    for (const row of params.results) {
      const existing = existingMap.get(row.providerKey);
      const providerCatalogId = row.providerCatalogId || null;
      const mismatchFields = row.mismatchFields || [];

      if (row.status === 'MATCH') {
        if (!existing) continue;
        const payload: Record<string, unknown> = {
          provider_catalog_id: providerCatalogId,
          provider_name: row.providerName,
          status: 'RESOLVED',
          last_result_status: 'MATCH',
          mismatch_fields: [],
          last_run_id: params.runId,
          last_result_id: row.id,
          last_checked_at: nowIso,
          updated_by: params.requestedByUserId,
        };
        if (existing.status !== 'RESOLVED') {
          payload.resolved_at = nowIso;
          payload.resolved_by_user_id = null;
        }
        const { error } = await client.from('nap_alerts').update(payload).eq('id', existing.id);
        if (error && isMissingRelationError(error)) throw new Error(MIGRATION_ERROR_MESSAGE);
        if (error) throw error;
        continue;
      }

      if (row.status !== 'MISMATCH' && row.status !== 'MISSING') {
        continue;
      }

      if (existing) {
        const payload: Record<string, unknown> = {
          provider_catalog_id: providerCatalogId,
          provider_name: row.providerName,
          last_result_status: row.status,
          mismatch_fields: mismatchFields,
          last_run_id: params.runId,
          last_result_id: row.id,
          last_checked_at: nowIso,
          last_detected_at: nowIso,
          updated_by: params.requestedByUserId,
        };

        if (existing.status === 'RESOLVED') {
          payload.status = 'OPEN';
          payload.opened_at = nowIso;
          payload.acknowledged_at = null;
          payload.acknowledged_by_user_id = null;
          payload.resolved_at = null;
          payload.resolved_by_user_id = null;
        } else {
          payload.status = existing.status;
        }

        const { error } = await client.from('nap_alerts').update(payload).eq('id', existing.id);
        if (error && isMissingRelationError(error)) throw new Error(MIGRATION_ERROR_MESSAGE);
        if (error) throw error;
        continue;
      }

      inserts.push({
        store_id: params.storeId,
        provider_catalog_id: providerCatalogId,
        provider_key: row.providerKey,
        provider_name: row.providerName,
        status: 'OPEN',
        last_result_status: row.status,
        mismatch_fields: mismatchFields,
        last_run_id: params.runId,
        last_result_id: row.id,
        first_detected_at: nowIso,
        opened_at: nowIso,
        last_detected_at: nowIso,
        last_checked_at: nowIso,
        updated_by: params.requestedByUserId,
      });
    }

    if (inserts.length > 0) {
      const { error } = await client.from('nap_alerts').insert(inserts);
      if (error && isMissingRelationError(error)) throw new Error(MIGRATION_ERROR_MESSAGE);
      if (error) throw error;
    }
  },
};
