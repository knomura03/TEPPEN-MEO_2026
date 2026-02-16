import { isSupabaseConfigured, supabase } from './supabaseClient';
import { getFunctionErrorMessage, invokeFunctionByHttp } from './functionHttpClient';

export type AccessibleGroup = {
  id: string;
  name: string;
  role: string;
  managementUnitId?: string;
};

const roleRank: Record<string, number> = {
  ADMIN: 4,
  SUPERVISOR: 3,
  MANAGER: 2,
  USER: 1,
};

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、グループ情報を取得できません。');
  }
  return supabase;
};

export const groupService = {
  async listAccessibleGroups(userId: string): Promise<AccessibleGroup[]> {
    const client = requireSupabase();
    const { data: membershipData, error: membershipError } = await client
      .from('memberships')
      .select('org_id, role')
      .eq('user_id', userId);
    if (membershipError) throw membershipError;
    const actorRoles = (membershipData || [])
      .map((row) => String((row as { role?: string }).role || '').toUpperCase())
      .filter(Boolean);
    const hasAdmin = actorRoles.includes('ADMIN');
    const hasSupervisor = actorRoles.includes('SUPERVISOR');

    const { data: orgRows, error: orgError } = await client
      .from('organizations')
      .select('id, name, management_unit_id')
      .order('name', { ascending: true });
    if (orgError) throw orgError;

    const roleByOrg = new Map<string, string>();
    (membershipData || []).forEach((row) => {
      const typed = row as { org_id?: string; role?: string };
      const orgId = String(typed.org_id || '');
      const role = String(typed.role || '').toUpperCase();
      if (!orgId || !role) return;
      const existing = roleByOrg.get(orgId);
      if (!existing || (roleRank[role] || 0) > (roleRank[existing] || 0)) {
        roleByOrg.set(orgId, role);
      }
    });

    return (orgRows || [])
      .map((row) => {
        const typed = row as { id?: string; name?: string | null; management_unit_id?: string | null };
        const id = String(typed.id || '');
        if (!id) return null;
        const role = hasAdmin
          ? 'ADMIN'
          : hasSupervisor
            ? 'SUPERVISOR'
            : (roleByOrg.get(id) || 'USER');
        return {
          id,
          name: typed.name || `グループ ${id.slice(0, 8)}`,
          role,
          managementUnitId: typed.management_unit_id ? String(typed.management_unit_id) : undefined,
        } as AccessibleGroup;
      })
      .filter((row): row is AccessibleGroup => Boolean(row));
  },

  async createGroup(params: { groupName: string; initialStoreName: string; managementUnitId?: string }): Promise<{ orgId: string; storeId: string }> {
    const result = await invokeFunctionByHttp('group-create', {
      groupName: params.groupName,
      initialStoreName: params.initialStoreName,
      managementUnitId: params.managementUnitId,
    });
    if (!result.ok) {
      throw new Error(getFunctionErrorMessage(result, 'グループ作成に失敗しました。'));
    }
    const body = result.body && typeof result.body === 'object'
      ? (result.body as Record<string, unknown>)
      : {};
    const orgId = typeof body.orgId === 'string' ? body.orgId : '';
    const storeId = typeof body.storeId === 'string' ? body.storeId : '';
    if (!orgId || !storeId) {
      throw new Error('グループ作成結果に必要なIDが含まれていません。');
    }
    return { orgId, storeId };
  },

  async renameGroup(params: { orgId: string; groupName: string }): Promise<void> {
    const result = await invokeFunctionByHttp('group-rename', {
      orgId: params.orgId,
      groupName: params.groupName,
    });
    if (!result.ok) {
      throw new Error(getFunctionErrorMessage(result, 'グループ名の変更に失敗しました。'));
    }
  },
};
