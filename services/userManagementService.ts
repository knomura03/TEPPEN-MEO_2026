import { User, Role } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';

type DbMembershipRow = {
  user_id: string;
  org_id: string;
  role: string;
  created_at: string;
};

type DbProfileRow = {
  id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
};

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、ユーザーを取得できません。');
  }
  return supabase;
};

const toRole = (raw: string): Role => {
  const upper = (raw || '').toUpperCase();
  if (upper === Role.ADMIN) return Role.ADMIN;
  if (upper === Role.MANAGER) return Role.MANAGER;
  return Role.USER;
};

const rolePriority: Record<Role, number> = {
  [Role.ADMIN]: 3,
  [Role.MANAGER]: 2,
  [Role.USER]: 1,
};

const buildUser = (userId: string, role: Role, createdAt: string, profile?: DbProfileRow | null): User => {
  const email = profile?.email || '';
  const username = email ? email.split('@')[0] : userId.slice(0, 8);
  return {
    id: userId,
    username,
    name: profile?.name || username,
    email,
    role,
    avatarUrl: profile?.avatar_url || undefined,
    plan: 'FREE',
    lastLoginAt: createdAt ? new Date(createdAt) : new Date(),
  };
};

export const userManagementService = {
  async listUsersByOrg(orgId: string): Promise<User[]> {
    const client = requireSupabase();
    const { data: membershipRows, error: membershipError } = await client
      .from('memberships')
      .select('user_id, org_id, role, created_at')
      .eq('org_id', orgId);
    if (membershipError) throw membershipError;

    const rows = (membershipRows || []) as DbMembershipRow[];
    if (rows.length === 0) return [];

    const grouped = new Map<string, { role: Role; createdAt: string }>();
    for (const row of rows) {
      const role = toRole(row.role);
      const existing = grouped.get(row.user_id);
      if (!existing) {
        grouped.set(row.user_id, { role, createdAt: row.created_at });
        continue;
      }
      if (rolePriority[role] > rolePriority[existing.role]) {
        grouped.set(row.user_id, { role, createdAt: existing.createdAt });
      }
    }

    const userIds = Array.from(grouped.keys());
    const { data: profileRows, error: profileError } = await client
      .from('profiles')
      .select('id, name, email, avatar_url')
      .in('id', userIds);
    if (profileError) throw profileError;

    const profileMap = new Map<string, DbProfileRow>();
    (profileRows || []).forEach((row) => profileMap.set((row as DbProfileRow).id, row as DbProfileRow));

    return userIds.map((userId) => {
      const info = grouped.get(userId)!;
      const profile = profileMap.get(userId) || null;
      return buildUser(userId, info.role, info.createdAt, profile);
    });
  },

  async removeUserFromOrg(orgId: string, userId: string): Promise<void> {
    const client = requireSupabase();
    const { error } = await client
      .from('memberships')
      .delete()
      .eq('org_id', orgId)
      .eq('user_id', userId);
    if (error) throw error;
  },
};
