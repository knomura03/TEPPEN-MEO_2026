import { ProviderCapability, ProviderCatalog, ProviderKind, ProviderAuthKind, VisibilityState } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';

type DbProviderCatalogRow = {
  id: string;
  org_id: string;
  provider_key: string;
  display_name: string;
  provider_kind: ProviderKind;
  auth_kind: ProviderAuthKind;
  default_visibility: VisibilityState;
  is_active: boolean;
  provider_capabilities?: DbProviderCapabilityRow[];
};

type DbProviderCapabilityRow = {
  id: string;
  provider_catalog_id: string;
  can_connect: boolean;
  can_sync_inbox: boolean;
  can_publish: boolean;
  can_reply: boolean;
  can_fetch_metrics: boolean;
};

type ProviderCatalogWithCapability = {
  catalog: ProviderCatalog;
  capability?: ProviderCapability;
};

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、provider catalogを取得できません。');
  }
  return supabase;
};

const mapCatalog = (row: DbProviderCatalogRow): ProviderCatalog => ({
  id: row.id,
  orgId: row.org_id,
  providerKey: row.provider_key,
  displayName: row.display_name,
  providerKind: row.provider_kind,
  authKind: row.auth_kind,
  defaultVisibility: row.default_visibility,
  isActive: row.is_active,
});

const mapCapability = (row: DbProviderCapabilityRow): ProviderCapability => ({
  id: row.id,
  providerCatalogId: row.provider_catalog_id,
  canConnect: row.can_connect,
  canSyncInbox: row.can_sync_inbox,
  canPublish: row.can_publish,
  canReply: row.can_reply,
  canFetchMetrics: row.can_fetch_metrics,
});

export const providerCatalogService = {
  async listByOrg(orgId: string): Promise<ProviderCatalogWithCapability[]> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('provider_catalog')
      .select(
        'id, org_id, provider_key, display_name, provider_kind, auth_kind, default_visibility, is_active, provider_capabilities (id, provider_catalog_id, can_connect, can_sync_inbox, can_publish, can_reply, can_fetch_metrics)'
      )
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('display_name', { ascending: true });
    if (error) throw error;

    return ((data || []) as DbProviderCatalogRow[]).map((row) => {
      const capabilityRow = row.provider_capabilities?.[0];
      return {
        catalog: mapCatalog(row),
        capability: capabilityRow ? mapCapability(capabilityRow) : undefined,
      };
    });
  },

  async createProvider(params: {
    orgId: string;
    providerKey: string;
    displayName: string;
    providerKind: ProviderKind;
    authKind: ProviderAuthKind;
    defaultVisibility: VisibilityState;
    createdBy?: string;
    capability?: Partial<Pick<ProviderCapability, 'canConnect' | 'canSyncInbox' | 'canPublish' | 'canReply' | 'canFetchMetrics'>>;
  }): Promise<ProviderCatalogWithCapability> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('provider_catalog')
      .insert({
        org_id: params.orgId,
        provider_key: params.providerKey.toUpperCase(),
        display_name: params.displayName,
        provider_kind: params.providerKind,
        auth_kind: params.authKind,
        default_visibility: params.defaultVisibility,
        created_by: params.createdBy ?? null,
      })
      .select('id, org_id, provider_key, display_name, provider_kind, auth_kind, default_visibility, is_active')
      .single();
    if (error) throw error;

    const createdCatalog = mapCatalog(data as DbProviderCatalogRow);

    const capabilityInsert = {
      provider_catalog_id: createdCatalog.id,
      can_connect: params.capability?.canConnect ?? true,
      can_sync_inbox: params.capability?.canSyncInbox ?? true,
      can_publish: params.capability?.canPublish ?? false,
      can_reply: params.capability?.canReply ?? false,
      can_fetch_metrics: params.capability?.canFetchMetrics ?? false,
    };

    const { data: capData, error: capError } = await client
      .from('provider_capabilities')
      .insert(capabilityInsert)
      .select('id, provider_catalog_id, can_connect, can_sync_inbox, can_publish, can_reply, can_fetch_metrics')
      .single();
    if (capError) throw capError;

    return {
      catalog: createdCatalog,
      capability: mapCapability(capData as DbProviderCapabilityRow),
    };
  },

  async updateVisibility(providerCatalogId: string, visibility: VisibilityState): Promise<void> {
    const client = requireSupabase();
    const { error } = await client
      .from('provider_catalog')
      .update({
        default_visibility: visibility,
      })
      .eq('id', providerCatalogId);
    if (error) throw error;
  },

  async updateCapability(providerCatalogId: string, capability: Partial<Pick<ProviderCapability, 'canConnect' | 'canSyncInbox' | 'canPublish' | 'canReply' | 'canFetchMetrics'>>): Promise<void> {
    const client = requireSupabase();
    const payload: Record<string, boolean> = {};
    if (capability.canConnect !== undefined) payload.can_connect = capability.canConnect;
    if (capability.canSyncInbox !== undefined) payload.can_sync_inbox = capability.canSyncInbox;
    if (capability.canPublish !== undefined) payload.can_publish = capability.canPublish;
    if (capability.canReply !== undefined) payload.can_reply = capability.canReply;
    if (capability.canFetchMetrics !== undefined) payload.can_fetch_metrics = capability.canFetchMetrics;

    const { error } = await client
      .from('provider_capabilities')
      .update(payload)
      .eq('provider_catalog_id', providerCatalogId);
    if (error) throw error;
  },
};
