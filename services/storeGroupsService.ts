import { StoreGroup } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import { migrationRequiredMessage } from './migrationRequiredMessage';

type DbStoreGroupStoreRow = {
  store_id: string;
};

type DbStoreGroupRow = {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  store_group_stores?: DbStoreGroupStoreRow[];
};

let storeGroupSchemaChecked = false;

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、店舗グループを取得できません。');
  }
  return supabase;
};

const isMissingRelationError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const maybeCode = 'code' in error ? String((error as { code?: string }).code || '') : '';
  const maybeMessage = 'message' in error ? String((error as { message?: string }).message || '') : '';
  return maybeCode === '42P01' || maybeMessage.includes('does not exist');
};

const ensureStoreGroupSchema = async (client: NonNullable<typeof supabase>) => {
  if (storeGroupSchemaChecked) return;
  const { error } = await client.from('store_groups').select('id').limit(1);
  if (error && isMissingRelationError(error)) {
    throw new Error(migrationRequiredMessage('店舗グループ'));
  }
  if (error) throw error;
  storeGroupSchemaChecked = true;
};

const mapStoreGroup = (row: DbStoreGroupRow): StoreGroup => ({
  id: row.id,
  orgId: row.org_id,
  name: row.name,
  description: row.description || undefined,
  storeIds: (row.store_group_stores || []).map((member) => member.store_id),
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

const uniqIds = (ids: string[]) => {
  const filtered = ids.filter((id) => id && id.trim().length > 0);
  return Array.from(new Set(filtered));
};

export const storeGroupsService = {
  async listByOrg(orgId: string): Promise<StoreGroup[]> {
    const client = requireSupabase();
    await ensureStoreGroupSchema(client);

    const { data, error } = await client
      .from('store_groups')
      .select('id, org_id, name, description, created_at, updated_at, store_group_stores (store_id)')
      .eq('org_id', orgId)
      .order('name', { ascending: true });

    if (error && isMissingRelationError(error)) {
      throw new Error(migrationRequiredMessage('店舗グループ'));
    }
    if (error) throw error;
    return ((data || []) as DbStoreGroupRow[]).map(mapStoreGroup);
  },

  async create(params: {
    orgId: string;
    name: string;
    description?: string;
    storeIds: string[];
  }): Promise<StoreGroup> {
    const client = requireSupabase();
    await ensureStoreGroupSchema(client);

    const storeIds = uniqIds(params.storeIds);
    const { data, error } = await client
      .from('store_groups')
      .insert({
        org_id: params.orgId,
        name: params.name.trim(),
        description: params.description?.trim() || null,
      })
      .select('id, org_id, name, description, created_at, updated_at')
      .single();

    if (error && isMissingRelationError(error)) {
      throw new Error(migrationRequiredMessage('店舗グループ'));
    }
    if (error) throw error;

    const created = data as DbStoreGroupRow;
    if (storeIds.length > 0) {
      const insertRows = storeIds.map((storeId) => ({
        store_group_id: created.id,
        store_id: storeId,
      }));
      const { error: memberError } = await client.from('store_group_stores').insert(insertRows);
      if (memberError && isMissingRelationError(memberError)) {
        throw new Error(migrationRequiredMessage('店舗グループ（店舗の紐付け）'));
      }
      if (memberError) throw memberError;
    }

    const { data: savedRow, error: savedError } = await client
      .from('store_groups')
      .select('id, org_id, name, description, created_at, updated_at, store_group_stores (store_id)')
      .eq('id', created.id)
      .single();
    if (savedError && isMissingRelationError(savedError)) {
      throw new Error(migrationRequiredMessage('店舗グループ'));
    }
    if (savedError) throw savedError;
    return mapStoreGroup(savedRow as DbStoreGroupRow);
  },

  async update(params: {
    id: string;
    name: string;
    description?: string;
    storeIds: string[];
  }): Promise<void> {
    const client = requireSupabase();
    await ensureStoreGroupSchema(client);

    const nextStoreIds = uniqIds(params.storeIds);
    const { error } = await client
      .from('store_groups')
      .update({
        name: params.name.trim(),
        description: params.description?.trim() || null,
      })
      .eq('id', params.id);

    if (error && isMissingRelationError(error)) {
      throw new Error(migrationRequiredMessage('店舗グループ'));
    }
    if (error) throw error;

    const { data: existingRows, error: selectError } = await client
      .from('store_group_stores')
      .select('store_id')
      .eq('store_group_id', params.id);
    if (selectError && isMissingRelationError(selectError)) {
      throw new Error(migrationRequiredMessage('店舗グループ（店舗の紐付け）'));
    }
    if (selectError) throw selectError;

    const currentStoreIds = new Set(((existingRows || []) as DbStoreGroupStoreRow[]).map((row) => row.store_id));
    const nextStoreIdSet = new Set(nextStoreIds);
    const toDelete = Array.from(currentStoreIds).filter((storeId) => !nextStoreIdSet.has(storeId));
    const toInsert = Array.from(nextStoreIdSet).filter((storeId) => !currentStoreIds.has(storeId));

    if (toDelete.length > 0) {
      const { error: deleteError } = await client
        .from('store_group_stores')
        .delete()
        .eq('store_group_id', params.id)
        .in('store_id', toDelete);
      if (deleteError && isMissingRelationError(deleteError)) {
        throw new Error(migrationRequiredMessage('店舗グループ（店舗の紐付け）'));
      }
      if (deleteError) throw deleteError;
    }

    if (toInsert.length > 0) {
      const insertRows = toInsert.map((storeId) => ({
        store_group_id: params.id,
        store_id: storeId,
      }));
      const { error: insertError } = await client.from('store_group_stores').insert(insertRows);
      if (insertError && isMissingRelationError(insertError)) {
        throw new Error(migrationRequiredMessage('店舗グループ（店舗の紐付け）'));
      }
      if (insertError) throw insertError;
    }
  },

  async remove(storeGroupId: string): Promise<void> {
    const client = requireSupabase();
    await ensureStoreGroupSchema(client);
    const { error } = await client
      .from('store_groups')
      .delete()
      .eq('id', storeGroupId);
    if (error && isMissingRelationError(error)) {
      throw new Error(migrationRequiredMessage('店舗グループ'));
    }
    if (error) throw error;
  },
};
