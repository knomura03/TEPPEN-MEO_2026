import { ProviderAdapter } from '../types';

const registry = new Map<string, ProviderAdapter>();

export const registerProviderAdapter = (providerKey: string, adapter: ProviderAdapter) => {
  registry.set(providerKey.toUpperCase(), adapter);
};

export const hasProviderAdapter = (providerKey: string): boolean => {
  return registry.has(providerKey.toUpperCase());
};

export const resolveProviderAdapter = (providerKey: string): ProviderAdapter => {
  const adapter = registry.get(providerKey.toUpperCase());
  if (!adapter) {
    throw new Error(`No adapter registered for provider: ${providerKey}`);
  }
  return adapter;
};
