import { User, Role } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';

type DbMembershipRow = {
  user_id: string;
  org_id: string;
  role: string;
  store_id: string | null;
  created_at: string;
};

type DbProfileRow = {
  id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
};

type DbUserStoreControlRow = {
  org_id: string;
  user_id: string;
  max_stores: number | null;
  allow_csv_store_bulk_create: boolean;
};

type DbOrgStorePolicyRow = {
  org_id: string;
  default_user_store_limit: number;
};

export type ManagedUserStoreSummary = {
  user: User;
  currentStoreCount: number;
  effectiveStoreLimit: number;
  maxStoresOverride?: number;
  allowCsvStoreBulkCreate: boolean;
};

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、ユーザーを取得できません。');
  }
  return supabase;
};

const isMissingRelationError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const maybeCode = 'code' in error ? String((error as { code?: string }).code || '') : '';
  const maybeMessage = 'message' in error ? String((error as { message?: string }).message || '') : '';
  return maybeCode === '42P01' || maybeMessage.includes('does not exist');
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
  async listUsersByOrgWithStoreStats(orgId: string): Promise<ManagedUserStoreSummary[]> {
    const client = requireSupabase();
    const { data: membershipRows, error: membershipError } = await client
      .from('memberships')
      .select('user_id, org_id, role, store_id, created_at')
      .eq('org_id', orgId);
    if (membershipError) throw membershipError;

    const rows = (membershipRows || []) as DbMembershipRow[];
    if (rows.length === 0) return [];

    const grouped = new Map<string, { role: Role; createdAt: string; storeIds: Set<string> }>();
    for (const row of rows) {
      const role = toRole(row.role);
      const existing = grouped.get(row.user_id);
      if (!existing) {
        grouped.set(row.user_id, {
          role,
          createdAt: row.created_at,
          storeIds: new Set(role === Role.USER && row.store_id ? [row.store_id] : []),
        });
        continue;
      }

      if (rolePriority[role] > rolePriority[existing.role]) {
        existing.role = role;
      }
      if (role === Role.USER && row.store_id) {
        existing.storeIds.add(row.store_id);
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

    let policyRows: DbOrgStorePolicyRow | null = null;
    const { data: policyData, error: policyError } = await client
      .from('org_store_policies')
      .select('org_id, default_user_store_limit')
      .eq('org_id', orgId)
      .maybeSingle();
    if (policyError && !isMissingRelationError(policyError)) throw policyError;
    if (policyData) {
      policyRows = policyData as DbOrgStorePolicyRow;
    }

    let controlRows: DbUserStoreControlRow[] = [];
    const { data: controlData, error: controlError } = await client
      .from('user_store_controls')
      .select('org_id, user_id, max_stores, allow_csv_store_bulk_create')
      .eq('org_id', orgId)
      .in('user_id', userIds);
    if (controlError && !isMissingRelationError(controlError)) throw controlError;
    if (controlData) {
      controlRows = controlData as DbUserStoreControlRow[];
    }

    const controlMap = new Map<string, DbUserStoreControlRow>();
    controlRows.forEach((row) => {
      controlMap.set(row.user_id, row);
    });

    const defaultLimit = Math.max(1, (policyRows?.default_user_store_limit || 1));

    return userIds.map((userId) => {
      const info = grouped.get(userId)!;
      const profile = profileMap.get(userId) || null;
      const control = controlMap.get(userId);
      const user = buildUser(userId, info.role, info.createdAt, profile);
      const currentStoreCount = info.role === Role.USER ? info.storeIds.size : 0;
      const effectiveStoreLimit = info.role === Role.USER
        ? Math.max(1, control?.max_stores ?? defaultLimit)
        : 0;

      return {
        user,
        currentStoreCount,
        effectiveStoreLimit,
        maxStoresOverride: control?.max_stores ?? undefined,
        allowCsvStoreBulkCreate: info.role === Role.USER ? Boolean(control?.allow_csv_store_bulk_create) : false,
      };
    });
  },

  async listUsersByOrg(orgId: string): Promise<User[]> {
    const summaries = await this.listUsersByOrgWithStoreStats(orgId);
    return summaries.map((summary) => summary.user);
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
