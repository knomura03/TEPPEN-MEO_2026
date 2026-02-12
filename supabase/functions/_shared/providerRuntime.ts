import { readString } from './http.ts';

export type ProviderRuntimeContext = {
  store: { id: string; org_id: string };
  catalog: { id: string; org_id: string; provider_key: string };
  configuration: {
    id: string;
    store_id: string;
    provider_catalog_id: string;
    config: Record<string, unknown>;
    has_gui_config: boolean;
    connection_status: string;
  };
};

export const resolveProviderRuntimeContext = async (params: {
  supabaseAdmin: any;
  providerConfigurationId: string;
}): Promise<ProviderRuntimeContext | null> => {
  const { data: configuration } = await params.supabaseAdmin
    .from('provider_configurations')
    .select('id, store_id, provider_catalog_id, config, has_gui_config, connection_status')
    .eq('id', params.providerConfigurationId)
    .maybeSingle();

  if (!configuration) return null;

  const { data: store } = await params.supabaseAdmin
    .from('stores')
    .select('id, org_id')
    .eq('id', configuration.store_id)
    .maybeSingle();
  if (!store) return null;

  const { data: catalog } = await params.supabaseAdmin
    .from('provider_catalog')
    .select('id, org_id, provider_key')
    .eq('id', configuration.provider_catalog_id)
    .maybeSingle();
  if (!catalog) return null;

  return {
    store,
    catalog,
    configuration: {
      id: configuration.id,
      store_id: configuration.store_id,
      provider_catalog_id: configuration.provider_catalog_id,
      config: configuration.config && typeof configuration.config === 'object' ? configuration.config : {},
      has_gui_config: Boolean(configuration.has_gui_config),
      connection_status: String(configuration.connection_status || 'DISCONNECTED'),
    },
  };
};

export const isInternalRole = (role: string): boolean => {
  const upper = String(role || '').toUpperCase();
  return upper === 'ADMIN' || upper === 'SUPERVISOR';
};

export const isPublisherRole = (role: string): boolean => {
  const upper = String(role || '').toUpperCase();
  return upper === 'ADMIN' || upper === 'SUPERVISOR' || upper === 'MANAGER';
};

export const hasAnyRole = async (params: {
  supabaseAdmin: any;
  userId: string;
  orgId: string;
  roleMatcher: (role: string) => boolean;
}): Promise<boolean> => {
  const { data: memberships, error } = await params.supabaseAdmin
    .from('memberships')
    .select('role')
    .eq('user_id', params.userId)
    .eq('org_id', params.orgId);

  if (error || !memberships) return false;
  return memberships.some((row: { role: string }) => params.roleMatcher(readString(row as Record<string, unknown>, ['role'])));
};

export const resolveIntegrationCredential = async (params: {
  supabaseAdmin: any;
  storeId: string;
  providerKey: string;
}): Promise<{ integrationId: string; encryptedPayload: string; status: string } | null> => {
  const { data: integration } = await params.supabaseAdmin
    .from('integrations')
    .select('id, status')
    .eq('store_id', params.storeId)
    .eq('provider', params.providerKey)
    .maybeSingle();

  if (!integration?.id) return null;

  const { data: credential } = await params.supabaseAdmin
    .from('integration_credentials')
    .select('encrypted_payload')
    .eq('integration_id', integration.id)
    .maybeSingle();

  if (!credential?.encrypted_payload) return null;

  return {
    integrationId: integration.id,
    encryptedPayload: String(credential.encrypted_payload),
    status: String(integration.status || ''),
  };
};
