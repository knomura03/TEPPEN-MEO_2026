import { User, Role } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import { getFunctionErrorMessage, invokeFunctionByHttp } from './functionHttpClient';

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
  invited_at: string | null;
  password_set_at: string | null;
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

type DbStoreSubscriptionPlanRow = {
  store_id: string;
  billing_plan?: { code?: string | null } | null;
};

export type ManagedUserStoreSummary = {
  user: User;
  currentStoreCount: number;
  effectiveStoreLimit: number;
  maxStoresOverride?: number;
  allowCsvStoreBulkCreate: boolean;
  userStoreIds: string[];
};

type UpdateManagedUserPayload = {
  orgId: string;
  targetUserId: string;
  patch: {
    name?: string;
    role?: Role;
    storeIds?: string[];
  };
};

type DeleteManagedUserPayload = {
  orgId: string;
  targetUserId: string;
  mode: 'REMOVE_FROM_ORG' | 'FULL_DELETE';
  confirmToken?: string;
};

type GenerateAuthLinkPayload = {
  orgId: string;
  email: string;
  name: string;
  role: Role;
  storeId?: string;
  planCode?: string;
  linkType?: 'INVITE' | 'RECOVERY';
  redirectTo?: string;
};

type AttachExistingUserPayload = {
  orgId: string;
  storeId: string;
  targetUserId: string;
  role: Role;
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

const buildUser = (userId: string, role: Role, createdAt: string, plan: string, profile?: DbProfileRow | null): User => {
  const email = profile?.email || '';
  const username = email ? email.split('@')[0] : userId.slice(0, 8);
  return {
    id: userId,
    username,
    name: profile?.name || username,
    email,
    role,
    avatarUrl: profile?.avatar_url || undefined,
    plan: plan || 'FREE',
    lastLoginAt: createdAt ? new Date(createdAt) : new Date(),
    invitedAt: profile?.invited_at ? new Date(profile.invited_at) : undefined,
    passwordSetAt: profile?.password_set_at ? new Date(profile.password_set_at) : undefined,
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
      .select('id, name, email, avatar_url, invited_at, password_set_at')
      .in('id', userIds);

    if (profileError) throw profileError;

    const profileMap = new Map<string, DbProfileRow>();
    (profileRows || []).forEach((row) => profileMap.set((row as DbProfileRow).id, row as DbProfileRow));

    const allStoreIds = Array.from(
      new Set(
        Array.from(grouped.values()).flatMap((item) => Array.from(item.storeIds))
      )
    );
    const storePlanMap = new Map<string, string>();
    if (allStoreIds.length > 0) {
      const { data: storeSubscriptionRows, error: storeSubscriptionError } = await client
        .from('store_subscriptions')
        .select('store_id, billing_plan:billing_plans (code)')
        .in('store_id', allStoreIds);
      if (storeSubscriptionError && !isMissingRelationError(storeSubscriptionError)) throw storeSubscriptionError;
      (storeSubscriptionRows || []).forEach((row) => {
        const typed = row as DbStoreSubscriptionPlanRow;
        const storeId = String(typed.store_id || '');
        const code = typed.billing_plan?.code ? String(typed.billing_plan.code).toUpperCase() : '';
        if (storeId && code) {
          storePlanMap.set(storeId, code);
        }
      });
    }

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
      const userStoreIds = Array.from(info.storeIds);
      const userPlanCodes = Array.from(
        new Set(
          userStoreIds
            .map((storeId) => storePlanMap.get(storeId) || '')
            .filter((code) => code.length > 0)
        )
      );
      let derivedPlanCode = 'UNASSIGNED';
      if (userStoreIds.length > 0 && userPlanCodes.length === 1) {
        derivedPlanCode = userPlanCodes[0];
      } else if (userStoreIds.length > 0 && userPlanCodes.length > 1) {
        derivedPlanCode = 'MIXED';
      }

      const user = buildUser(userId, info.role, info.createdAt, derivedPlanCode, profile);
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
        userStoreIds,
      };
    });
  },

  async listUsersByOrg(orgId: string): Promise<User[]> {
    const summaries = await this.listUsersByOrgWithStoreStats(orgId);
    return summaries.map((summary) => summary.user);
  },

  async removeUserFromOrg(orgId: string, userId: string): Promise<void> {
    const result = await invokeFunctionByHttp('admin-user-delete', {
      orgId,
      targetUserId: userId,
      mode: 'REMOVE_FROM_ORG',
    } satisfies DeleteManagedUserPayload);
    if (!result.ok) {
      throw new Error(getFunctionErrorMessage(result, 'ユーザーの所属解除に失敗しました。'));
    }
  },

  async updateManagedUser(payload: UpdateManagedUserPayload): Promise<void> {
    const result = await invokeFunctionByHttp('admin-user-update', payload);
    if (!result.ok) {
      throw new Error(getFunctionErrorMessage(result, 'ユーザー編集に失敗しました。'));
    }
  },

  async deleteManagedUser(payload: DeleteManagedUserPayload): Promise<{
    confirmRequired: boolean;
    confirmToken?: string;
    expiresAt?: string;
  }> {
    const result = await invokeFunctionByHttp('admin-user-delete', payload);
    if (result.ok) {
      return { confirmRequired: false };
    }

    const body = result.body && typeof result.body === 'object'
      ? (result.body as Record<string, unknown>)
      : null;
    if (result.status === 409 && body?.error === 'CONFIRM_REQUIRED') {
      return {
        confirmRequired: true,
        confirmToken: typeof body.confirmToken === 'string' ? body.confirmToken : undefined,
        expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : undefined,
      };
    }

    throw new Error(getFunctionErrorMessage(result, 'ユーザー削除に失敗しました。'));
  },

  async generateAuthLink(payload: GenerateAuthLinkPayload): Promise<{
    actionLink: string;
    linkType: 'INVITE' | 'RECOVERY';
    reusedExistingUser: boolean;
  }> {
    const result = await invokeFunctionByHttp('admin-auth-link', payload);
    if (!result.ok) {
      throw new Error(getFunctionErrorMessage(result, '招待リンクの生成に失敗しました。'));
    }
    const body = result.body && typeof result.body === 'object'
      ? (result.body as Record<string, unknown>)
      : null;
    const actionLink = typeof body?.actionLink === 'string' ? body.actionLink : '';
    const linkType = body?.linkType === 'RECOVERY' ? 'RECOVERY' : 'INVITE';
    const reusedExistingUser = body?.reusedExistingUser === true;
    if (!actionLink) {
      throw new Error('招待リンクの生成結果にURLが含まれていません。');
    }
    return { actionLink, linkType, reusedExistingUser };
  },

  async attachExistingUserToStoreOrGroup(payload: AttachExistingUserPayload): Promise<{ attached: boolean }> {
    const result = await invokeFunctionByHttp('admin-user-attach-existing', payload);
    if (!result.ok) {
      throw new Error(getFunctionErrorMessage(result, '既存ユーザーの追加に失敗しました。'));
    }
    const body = result.body && typeof result.body === 'object'
      ? (result.body as Record<string, unknown>)
      : null;
    return {
      attached: body?.attached !== false,
    };
  },
};
