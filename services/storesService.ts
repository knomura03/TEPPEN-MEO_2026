import { Store } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';

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

const mapDbStore = (row: DbStoreRow): Store => {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    address: row.address || undefined,
    phone: row.phone || undefined,
    website: row.website || undefined,
    category: row.category || undefined,
    businessHours: row.business_hours || undefined,
  };
};

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、店舗データを取得できません。');
  }
  return supabase;
};

const isMissingSchemaError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: string }).code || '') : '';
  const message = 'message' in error ? String((error as { message?: string }).message || '') : '';
  return code === '42P01' || code === '42883' || message.includes('does not exist');
};

export const storesService = {
  async createStore(payload: {
    name: string;
    address?: string;
    phone?: string;
    website?: string;
    category?: string;
    businessHours?: string;
    orgId?: string;
    orgName?: string;
  }): Promise<Store> {
    const client = requireSupabase();
    const { data, error } = await client.rpc('create_store_for_actor', {
      p_store_name: payload.name,
      p_address: payload.address || null,
      p_phone: payload.phone || null,
      p_category: payload.category || null,
      p_business_hours: payload.businessHours || null,
      p_website: payload.website || null,
      p_org_id: payload.orgId || null,
      p_org_name: payload.orgName || null,
    });
    if (error && !isMissingSchemaError(error)) throw error;
    if (error && isMissingSchemaError(error)) {
      throw new Error('P1-08拡張 migration（202602060009）の適用後に再試行してください。');
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      throw new Error('店舗作成結果の取得に失敗しました。');
    }
    return mapDbStore(row as DbStoreRow);
  },

  async listAccessible(): Promise<Store[]> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('stores')
      .select('id, org_id, name, address, phone, website, category, business_hours')
      .order('name', { ascending: true });
    if (error) throw error;
    return (data || []).map(mapDbStore);
  },

  async getById(storeId: string): Promise<Store | null> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('stores')
      .select('id, org_id, name, address, phone, website, category, business_hours')
      .eq('id', storeId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return mapDbStore(data as DbStoreRow);
  },

  async updateStore(
    storeId: string,
    payload: {
      name: string;
      address: string | null;
      phone: string | null;
      category: string | null;
      businessHours: string | null;
    }
  ): Promise<Store> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('stores')
      .update({
        name: payload.name,
        address: payload.address,
        phone: payload.phone,
        category: payload.category,
        business_hours: payload.businessHours,
      })
      .eq('id', storeId)
      .select('id, org_id, name, address, phone, website, category, business_hours')
      .single();
    if (error) throw error;
    return mapDbStore(data as DbStoreRow);
  },
};
