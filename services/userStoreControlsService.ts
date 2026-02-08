import { OrgStorePolicy, UserStoreControl } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';

type DbOrgStorePolicyRow = {
  org_id: string;
  default_user_store_limit: number;
  allow_user_store_creation: boolean;
  updated_by: string | null;
  updated_at: string;
};

type DbUserStoreControlRow = {
  org_id: string;
  user_id: string;
  max_stores: number | null;
  allow_csv_store_bulk_create: boolean;
  updated_by: string | null;
  updated_at: string;
};

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、店舗制御設定を利用できません。');
  }
  return supabase;
};

const isMissingSchemaError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: string }).code || '') : '';
  const message = 'message' in error ? String((error as { message?: string }).message || '') : '';
  return code === '42P01' || code === '42883' || message.includes('does not exist');
};

const mapOrgPolicy = (row: DbOrgStorePolicyRow): OrgStorePolicy => ({
  orgId: row.org_id,
  defaultUserStoreLimit: row.default_user_store_limit,
  allowUserStoreCreation: row.allow_user_store_creation,
  updatedBy: row.updated_by || undefined,
  updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
});

const mapUserControl = (row: DbUserStoreControlRow): UserStoreControl => ({
  orgId: row.org_id,
  userId: row.user_id,
  maxStores: row.max_stores ?? undefined,
  allowCsvStoreBulkCreate: row.allow_csv_store_bulk_create,
  updatedBy: row.updated_by || undefined,
  updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
});

const safeRpcInt = (data: unknown, fallback: number): number => {
  const parsed = Number(data);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
};

export const userStoreControlsService = {
  async getOrgPolicy(orgId: string): Promise<OrgStorePolicy> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('org_store_policies')
      .select('org_id, default_user_store_limit, allow_user_store_creation, updated_by, updated_at')
      .eq('org_id', orgId)
      .maybeSingle();
    if (error && !isMissingSchemaError(error)) throw error;
    if (error && isMissingSchemaError(error)) {
      throw new Error('P1-08拡張 migration（202602060009）の適用後に再試行してください。');
    }
    if (!data) {
      return {
        orgId,
        defaultUserStoreLimit: 1,
        allowUserStoreCreation: true,
      };
    }
    return mapOrgPolicy(data as DbOrgStorePolicyRow);
  },

  async getUserControl(orgId: string, userId: string): Promise<UserStoreControl> {
    const client = requireSupabase();
    const [{ data, error }, effectiveLimitResult, countResult] = await Promise.all([
      client
        .from('user_store_controls')
        .select('org_id, user_id, max_stores, allow_csv_store_bulk_create, updated_by, updated_at')
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .maybeSingle(),
      client.rpc('effective_user_store_limit', {
        target_org_id: orgId,
        target_user_id: userId,
      }),
      client.rpc('user_store_count', {
        target_org_id: orgId,
        target_user_id: userId,
      }),
    ]);

    if (error && !isMissingSchemaError(error)) throw error;
    if (effectiveLimitResult.error && !isMissingSchemaError(effectiveLimitResult.error)) throw effectiveLimitResult.error;
    if (countResult.error && !isMissingSchemaError(countResult.error)) throw countResult.error;
    if (
      (error && isMissingSchemaError(error)) ||
      (effectiveLimitResult.error && isMissingSchemaError(effectiveLimitResult.error)) ||
      (countResult.error && isMissingSchemaError(countResult.error))
    ) {
      throw new Error('P1-08拡張 migration（202602060009）の適用後に再試行してください。');
    }

    const base: UserStoreControl = data
      ? mapUserControl(data as DbUserStoreControlRow)
      : {
          orgId,
          userId,
          allowCsvStoreBulkCreate: false,
        };

    return {
      ...base,
      effectiveStoreLimit: safeRpcInt(effectiveLimitResult.data, 1),
      currentStoreCount: safeRpcInt(countResult.data, 0),
    };
  },

  async upsertUserControl(params: {
    orgId: string;
    userId: string;
    maxStores?: number | null;
    allowCsvStoreBulkCreate: boolean;
    updatedBy?: string;
  }): Promise<UserStoreControl> {
    const client = requireSupabase();
    const { error } = await client.from('user_store_controls').upsert(
      {
        org_id: params.orgId,
        user_id: params.userId,
        max_stores: params.maxStores ?? null,
        allow_csv_store_bulk_create: params.allowCsvStoreBulkCreate,
        updated_by: params.updatedBy ?? null,
      },
      {
        onConflict: 'org_id,user_id',
      }
    );
    if (error && !isMissingSchemaError(error)) throw error;
    if (error && isMissingSchemaError(error)) {
      throw new Error('P1-08拡張 migration（202602060009）の適用後に再試行してください。');
    }
    return this.getUserControl(params.orgId, params.userId);
  },
};
