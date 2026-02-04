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

export const storesService = {
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
