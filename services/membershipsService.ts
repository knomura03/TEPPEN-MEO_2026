import { Role } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';

type DbMembershipRow = {
  role: string;
};

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、所属（membership）を取得できません。');
  }
  return supabase;
};

const toRole = (raw: string): Role => {
  const upper = (raw || '').toUpperCase();
  if (upper === Role.ADMIN) return Role.ADMIN;
  if (upper === Role.SUPERVISOR) return Role.SUPERVISOR;
  if (upper === Role.MANAGER) return Role.MANAGER;
  return Role.USER;
};

const rolePriority: Record<Role, number> = {
  [Role.ADMIN]: 4,
  [Role.SUPERVISOR]: 3,
  [Role.MANAGER]: 2,
  [Role.USER]: 1,
};

export const membershipsService = {
  async getMyHighestRole(): Promise<Role | null> {
    const client = requireSupabase();

    const { data, error } = await client.from('memberships').select('role');
    if (error) throw error;

    const roles = (data || []).map((r) => toRole((r as DbMembershipRow).role));
    if (roles.length === 0) return null;

    return roles.reduce((best, next) => (rolePriority[next] > rolePriority[best] ? next : best), Role.USER);
  },
};
