import { Store, StoreCsvImportResult, StoreCsvRow, StoreCsvValidationError } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import { migrationRequiredMessage } from './migrationRequiredMessage';

type DbStoreRow = {
  id: string;
  org_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  category: string | null;
  business_hours: string | null;
};

type RpcBulkStoreResult = {
  ok?: boolean;
  created_count?: number;
  errors?: Array<{
    line?: number;
    column?: string;
    code?: string;
    message?: string;
  }>;
};

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、店舗ライフサイクル機能を利用できません。');
  }
  return supabase;
};

const isMissingSchemaError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: string }).code || '') : '';
  const message = 'message' in error ? String((error as { message?: string }).message || '') : '';
  return code === '42P01' || code === '42883' || message.includes('does not exist');
};

const mapStore = (row: DbStoreRow): Store => ({
  id: row.id,
  orgId: row.org_id,
  name: row.name,
  address: row.address || undefined,
  phone: row.phone || undefined,
  website: row.website || undefined,
  category: row.category || undefined,
  businessHours: row.business_hours || undefined,
});

const mapErrors = (errors: RpcBulkStoreResult['errors']): StoreCsvValidationError[] => {
  if (!errors || errors.length === 0) return [];
  return errors.map((error) => ({
    line: Number(error?.line || 0) || 1,
    column: String(error?.column || 'csv'),
    code: String(error?.code || 'UNKNOWN'),
    message: String(error?.message || 'CSV取り込みに失敗しました。'),
  }));
};

export const storeLifecycleService = {
  async createStoreForCurrentUser(input: {
    storeName: string;
    address?: string;
    phone?: string;
    category?: string;
    businessHours?: string;
    website?: string;
    orgId?: string;
    orgName?: string;
  }): Promise<Store> {
    const client = requireSupabase();
    const { data, error } = await client.rpc('create_store_for_actor', {
      p_store_name: input.storeName,
      p_address: input.address || null,
      p_phone: input.phone || null,
      p_category: input.category || null,
      p_business_hours: input.businessHours || null,
      p_website: input.website || null,
      p_org_id: input.orgId || null,
      p_org_name: input.orgName || null,
    });
    if (error && !isMissingSchemaError(error)) throw error;
    if (error && isMissingSchemaError(error)) {
      throw new Error(migrationRequiredMessage('店舗の作成'));
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      throw new Error('店舗の作成結果を取得できませんでした。');
    }
    return mapStore(row as DbStoreRow);
  },

  async createStoresByCsvForUser(input: {
    orgId: string;
    userId: string;
    rows: StoreCsvRow[];
  }): Promise<StoreCsvImportResult> {
    const client = requireSupabase();
    const payloadRows = input.rows.map((row) => ({
      store_name: row.storeName,
      address: row.address,
      phone: row.phone,
      category: row.category,
      business_hours: row.businessHours || null,
      website: row.website || null,
      note: row.note || null,
    }));

    const { data, error } = await client.rpc('bulk_create_stores_for_user', {
      target_org_id: input.orgId,
      target_user_id: input.userId,
      rows: payloadRows,
    });
    if (error && !isMissingSchemaError(error)) throw error;
    if (error && isMissingSchemaError(error)) {
      throw new Error(migrationRequiredMessage('CSV一括作成'));
    }

    const result = (data || {}) as RpcBulkStoreResult;
    return {
      ok: Boolean(result.ok),
      createdCount: Number(result.created_count || 0),
      errors: mapErrors(result.errors),
    };
  },
};
