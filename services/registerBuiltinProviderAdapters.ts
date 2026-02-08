import { registerProviderAdapter } from './providerAdapterRegistry';

const noop = async () => {};

registerProviderAdapter('INSTAGRAM', {
  connect: noop,
  disconnect: noop,
  syncInbox: noop,
  publishPost: noop,
  replyMessage: noop,
  healthCheck: noop,
});

registerProviderAdapter('FACEBOOK', {
  connect: noop,
  disconnect: noop,
  syncInbox: noop,
  publishPost: noop,
  replyMessage: noop,
  healthCheck: noop,
});
