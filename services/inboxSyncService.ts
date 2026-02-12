import { getFunctionErrorMessage, invokeFunctionByHttp } from './functionHttpClient';

export type InboxSyncResult = {
  syncedCountByProvider: Record<string, number>;
  errors: Record<string, string>;
  lastSyncAt: Date;
};

export const inboxSyncService = {
  async sync(params: {
    storeId: string;
    providers?: Array<'FACEBOOK' | 'INSTAGRAM' | 'GBP'>;
    mode?: 'LATEST_ONLY' | 'FULL';
  }): Promise<InboxSyncResult> {
    const result = await invokeFunctionByHttp('inbox-sync', {
      storeId: params.storeId,
      providers: params.providers,
      mode: params.mode || 'LATEST_ONLY',
    });

    if (!result.ok) {
      throw new Error(getFunctionErrorMessage(result, '受信箱同期に失敗しました。'));
    }

    const body = result.body && typeof result.body === 'object' ? (result.body as Record<string, unknown>) : {};
    const lastSyncAt = typeof body.lastSyncAt === 'string' ? new Date(body.lastSyncAt) : new Date();

    return {
      syncedCountByProvider:
        body.syncedCountByProvider && typeof body.syncedCountByProvider === 'object'
          ? (body.syncedCountByProvider as Record<string, number>)
          : {},
      errors: body.errors && typeof body.errors === 'object' ? (body.errors as Record<string, string>) : {},
      lastSyncAt: Number.isNaN(lastSyncAt.getTime()) ? new Date() : lastSyncAt,
    };
  },
};
