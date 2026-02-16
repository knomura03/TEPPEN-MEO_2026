import { ManagementUnit, ManagementUnitBranding } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import { getFunctionErrorMessage, invokeFunctionByHttp } from './functionHttpClient';

const BRANDING_BUCKET = 'branding';
export const MANAGEMENT_UNIT_BRANDING_UPDATED_EVENT = 'teppen.management-unit-branding-updated';

type DbManagementUnitRow = {
  id: string;
  name: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type SupervisorCandidate = {
  userId: string;
  name: string;
  email: string;
};

type GroupUnitRow = {
  id: string;
  name: string;
  management_unit_id: string | null;
};

type DbManagementUnitBrandingRow = {
  management_unit_id: string;
  service_name: string;
  logo_path: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase未設定のため管理ユニットを操作できません。');
  }
  return supabase;
};

const mapUnit = (row: DbManagementUnitRow): ManagementUnit => ({
  id: row.id,
  name: row.name,
  createdBy: row.created_by || undefined,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

const mapBranding = (row: DbManagementUnitBrandingRow): ManagementUnitBranding => ({
  managementUnitId: row.management_unit_id,
  serviceName: row.service_name,
  logoPath: row.logo_path || undefined,
  updatedBy: row.updated_by || undefined,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

const sanitizeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_');

const resolveLogoExtension = (file: File): string => {
  const type = (file.type || '').toLowerCase();
  if (type.includes('svg')) return 'svg';
  if (type.includes('png')) return 'png';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  const byName = file.name.includes('.') ? file.name.split('.').pop() : '';
  const ext = String(byName || '').toLowerCase();
  if (ext === 'svg' || ext === 'png' || ext === 'jpg' || ext === 'jpeg') return ext === 'jpeg' ? 'jpg' : ext;
  return 'svg';
};

export const managementUnitService = {
  async listUnits(): Promise<ManagementUnit[]> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('management_units')
      .select('id, name, created_by, created_at, updated_at')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map((row) => mapUnit(row as DbManagementUnitRow));
  },

  async upsertUnit(payload: { id?: string; name: string }): Promise<ManagementUnit> {
    const result = await invokeFunctionByHttp('admin-management-unit-upsert', payload);
    if (!result.ok) {
      throw new Error(getFunctionErrorMessage(result, '管理ユニットの保存に失敗しました。'));
    }
    const body = result.body && typeof result.body === 'object'
      ? (result.body as Record<string, unknown>)
      : null;
    const unitRaw = body?.unit && typeof body.unit === 'object'
      ? (body.unit as DbManagementUnitRow)
      : null;
    if (!unitRaw?.id) {
      throw new Error('管理ユニット保存結果が不正です。');
    }
    return mapUnit(unitRaw);
  },

  async assignSupervisor(payload: { managementUnitId: string; supervisorUserId: string }): Promise<void> {
    const result = await invokeFunctionByHttp('admin-management-unit-assign-supervisor', payload);
    if (!result.ok) {
      throw new Error(getFunctionErrorMessage(result, 'SUPERVISORの割当に失敗しました。'));
    }
  },

  async assignGroup(payload: { orgId: string; managementUnitId: string }): Promise<void> {
    const result = await invokeFunctionByHttp('admin-management-unit-upsert', payload);
    if (!result.ok) {
      throw new Error(getFunctionErrorMessage(result, 'グループへの管理ユニット割当に失敗しました。'));
    }
  },

  async listGroupsWithUnit(): Promise<Array<{ id: string; name: string; managementUnitId?: string }>> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('organizations')
      .select('id, name, management_unit_id')
      .order('name', { ascending: true });
    if (error) throw error;
    return (data || []).map((row) => {
      const typed = row as GroupUnitRow;
      return {
        id: typed.id,
        name: typed.name,
        managementUnitId: typed.management_unit_id || undefined,
      };
    });
  },

  async listSupervisorCandidates(): Promise<SupervisorCandidate[]> {
    const client = requireSupabase();
    const { data: membershipRows, error: membershipError } = await client
      .from('memberships')
      .select('user_id')
      .eq('role', 'SUPERVISOR');
    if (membershipError) throw membershipError;
    const userIds = Array.from(new Set((membershipRows || []).map((row) => String((row as { user_id?: string }).user_id || '')).filter(Boolean)));
    if (userIds.length === 0) return [];

    const { data: profileRows, error: profileError } = await client
      .from('profiles')
      .select('id, name, email')
      .in('id', userIds);
    if (profileError) throw profileError;

    const profileMap = new Map(
      (profileRows || []).map((row) => [
        String((row as { id?: string }).id || ''),
        {
          name: String((row as { name?: string | null }).name || ''),
          email: String((row as { email?: string | null }).email || ''),
        },
      ])
    );

    return userIds
      .map((userId) => {
        const profile = profileMap.get(userId);
        const email = profile?.email || '';
        return {
          userId,
          email,
          name: profile?.name || email.split('@')[0] || userId.slice(0, 8),
        };
      })
      .sort((a, b) => a.email.localeCompare(b.email, 'ja'));
  },

  async getBranding(managementUnitId: string): Promise<ManagementUnitBranding | null> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('management_unit_branding')
      .select('management_unit_id, service_name, logo_path, updated_by, created_at, updated_at')
      .eq('management_unit_id', managementUnitId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return mapBranding(data as DbManagementUnitBrandingRow);
  },

  async upsertBranding(payload: {
    managementUnitId: string;
    serviceName: string;
    logoPath?: string | null;
    updatedBy?: string;
  }): Promise<ManagementUnitBranding> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('management_unit_branding')
      .upsert(
        {
          management_unit_id: payload.managementUnitId,
          service_name: payload.serviceName,
          logo_path: payload.logoPath ?? null,
          updated_by: payload.updatedBy || null,
        },
        {
          onConflict: 'management_unit_id',
        }
      )
      .select('management_unit_id, service_name, logo_path, updated_by, created_at, updated_at')
      .single();
    if (error) throw error;
    return mapBranding(data as DbManagementUnitBrandingRow);
  },

  getBrandingLogoPublicUrl(logoPath: string, cacheBuster?: number): string {
    const client = requireSupabase();
    const { data } = client.storage.from(BRANDING_BUCKET).getPublicUrl(logoPath);
    const raw = data?.publicUrl || '';
    if (!raw) return '';
    if (!cacheBuster) return raw;
    const separator = raw.includes('?') ? '&' : '?';
    return `${raw}${separator}v=${cacheBuster}`;
  },

  async uploadBrandingLogo(params: { managementUnitId: string; file: File }): Promise<{ path: string; publicUrl: string }> {
    const client = requireSupabase();
    const extension = resolveLogoExtension(params.file);
    const safeExtension = sanitizeFileName(extension);
    const path = `management-units/${params.managementUnitId}/logo.${safeExtension}`;

    const { error: uploadError } = await client.storage
      .from(BRANDING_BUCKET)
      .upload(path, params.file, {
        upsert: true,
        contentType: params.file.type || undefined,
      });
    if (uploadError) throw uploadError;

    const { data } = client.storage.from(BRANDING_BUCKET).getPublicUrl(path);
    if (!data?.publicUrl) {
      throw new Error('ロゴURLの生成に失敗しました。');
    }
    return { path, publicUrl: data.publicUrl };
  },

  notifyBrandingUpdated(managementUnitId: string) {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(MANAGEMENT_UNIT_BRANDING_UPDATED_EVENT, { detail: { managementUnitId } }));
  },
};
