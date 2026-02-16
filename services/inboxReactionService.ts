import { InboxMessage, InboxReactionType, SocialPlatform } from '../types';
import { getFunctionErrorMessage, invokeFunctionByHttp } from './functionHttpClient';

type ProviderKey = 'FACEBOOK' | 'INSTAGRAM' | 'GBP';
type ChannelKey = 'REVIEWS' | 'DM';

const resolveProviderKey = (platform: SocialPlatform): ProviderKey | null => {
  if (platform === 'FACEBOOK') return 'FACEBOOK';
  if (platform === 'INSTAGRAM') return 'INSTAGRAM';
  return null;
};

const resolveChannel = (message: InboxMessage): ChannelKey => {
  return message.channel === 'DM' ? 'DM' : 'REVIEWS';
};

const resolveBodyMessage = (body: unknown): string => {
  if (!body || typeof body !== 'object') return '';
  const typed = body as Record<string, unknown>;
  const nestedError = typed.error;
  if (typeof nestedError === 'string' && nestedError.trim()) return nestedError.trim();
  if (typeof typed.message === 'string' && typed.message.trim()) return typed.message.trim();
  if (nestedError && typeof nestedError === 'object') {
    const nestedMessage = (nestedError as Record<string, unknown>).message;
    if (typeof nestedMessage === 'string' && nestedMessage.trim()) return nestedMessage.trim();
  }
  return '';
};

export const inboxReactionService = {
  async apply(params: {
    storeId: string;
    message: InboxMessage;
    reaction: InboxReactionType;
  }): Promise<void> {
    const provider = resolveProviderKey(params.message.platform);
    if (!provider) {
      throw new Error('この連携先はリアクション送信に未対応です。');
    }

    const payload: Record<string, unknown> = {
      reaction: params.reaction,
    };

    if (params.message.source !== 'REMOTE_CACHE') {
      payload.messageId = params.message.id;
    } else {
      if (!params.message.externalMessageId) {
        throw new Error('外部メッセージIDがないためリアクション送信できません。');
      }
      payload.storeId = params.storeId;
      payload.provider = provider;
      payload.externalMessageId = params.message.externalMessageId;
      payload.channel = resolveChannel(params.message);
    }

    const result = await invokeFunctionByHttp('inbox-apply-reaction', payload);
    if (!result.ok) {
      throw new Error(getFunctionErrorMessage(result, 'リアクション送信に失敗しました。'));
    }

    const body = result.body && typeof result.body === 'object' ? (result.body as Record<string, unknown>) : {};
    if (!body.ok) {
      throw new Error(resolveBodyMessage(result.body) || 'リアクション送信に失敗しました。');
    }
  },
};
