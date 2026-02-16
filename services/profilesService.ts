import { isSupabaseConfigured, supabase } from './supabaseClient';

export type Profile = {
  id: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  invitedAt?: Date;
  passwordSetAt?: Date;
};

type DbProfileRow = {
  id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
  invited_at: string | null;
  password_set_at: string | null;
};

const mapDbProfile = (row: DbProfileRow): Profile => {
  return {
    id: row.id,
    name: row.name || undefined,
    email: row.email || undefined,
    avatarUrl: row.avatar_url || undefined,
    invitedAt: row.invited_at ? new Date(row.invited_at) : undefined,
    passwordSetAt: row.password_set_at ? new Date(row.password_set_at) : undefined,
  };
};

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、プロフィールを取得できません。');
  }
  return supabase;
};

export const profilesService = {
  async getProfile(userId: string): Promise<Profile | null> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('profiles')
      .select('id, name, email, avatar_url, invited_at, password_set_at')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return mapDbProfile(data as DbProfileRow);
  },

  async upsertProfile(
    userId: string,
    payload: { name: string; email: string | null; avatarUrl?: string | null }
  ): Promise<Profile> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('profiles')
      .upsert(
        {
          id: userId,
          name: payload.name,
          email: payload.email,
          avatar_url: payload.avatarUrl ?? null,
        },
        { onConflict: 'id' }
      )
      .select('id, name, email, avatar_url, invited_at, password_set_at')
      .single();
    if (error) throw error;
    return mapDbProfile(data as DbProfileRow);
  },
};
