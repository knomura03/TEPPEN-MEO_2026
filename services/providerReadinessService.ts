import { ProviderCatalog, ProviderConfiguration, ProviderReadiness } from '../types';
import { hasProviderAdapter } from './providerAdapterRegistry';

const isConfigured = (configuration?: ProviderConfiguration | null): boolean => {
  return Boolean(configuration?.hasGuiConfig);
};

const resolveTestMode = (
  provider: ProviderCatalog,
  hasGuiConfig: boolean,
  hasAdapter: boolean,
  connectionStatus: ProviderConfiguration['connectionStatus']
): ProviderReadiness['testMode'] => {
  const adapterSatisfied = provider.providerKind === 'GENERIC' || hasAdapter;
  if (hasGuiConfig && adapterSatisfied && connectionStatus === 'CONNECTED') return 'REAL';
  return 'MOCK';
};

const resolveRuntimeMode = (
  provider: ProviderCatalog,
  hasGuiConfig: boolean,
  hasAdapter: boolean,
  connectionStatus: ProviderConfiguration['connectionStatus']
): ProviderReadiness['runtimeMode'] => {
  const adapterSatisfied = provider.providerKind === 'GENERIC' || hasAdapter;
  if (!hasGuiConfig || !adapterSatisfied) return 'BLOCKED';
  if (connectionStatus === 'CONNECTED') return 'ACTIVE';
  return 'DEGRADED';
};

export const buildProviderReadiness = (
  provider: ProviderCatalog,
  configuration?: ProviderConfiguration | null
): ProviderReadiness => {
  const hasGuiConfig = isConfigured(configuration);
  const hasAdapter = hasProviderAdapter(provider.providerKey);
  const connectionStatus = configuration?.connectionStatus || 'DISCONNECTED';
  return {
    providerKey: provider.providerKey,
    hasGuiConfig,
    hasAdapter,
    connectionStatus,
    testMode: resolveTestMode(provider, hasGuiConfig, hasAdapter, connectionStatus),
    runtimeMode: resolveRuntimeMode(provider, hasGuiConfig, hasAdapter, connectionStatus),
  };
};
