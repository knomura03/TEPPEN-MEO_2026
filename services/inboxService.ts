import { InboxMessage, SocialPlatform } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';

type DbInboxMessageRow = {
  id: string;
  store_id: string;
  provider: string;
  sender_name: string | null;
  sender_avatar_url: string | null;
  content: string;
  received_at: string;
  is_replied: boolean;
  reply_content: string | null;
};

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、受信箱データを取得できません。');
  }
  return supabase;
};

const toPlatform = (provider: string): SocialPlatform => {
  if (provider === 'GBP') return 'GOOGLE_BUSINESS';
  if (provider === 'INSTAGRAM') return 'INSTAGRAM';
  if (provider === 'FACEBOOK') return 'FACEBOOK';
  if (provider === 'TIKTOK') return 'TIKTOK';
  return 'GOOGLE_BUSINESS';
};

const mapDbMessage = (row: DbInboxMessageRow): InboxMessage => {
  return {
    id: row.id,
    platform: toPlatform(row.provider),
    senderName: row.sender_name || 'ユーザー',
    senderAvatar: row.sender_avatar_url || undefined,
    content: row.content,
    receivedAt: row.received_at ? new Date(row.received_at) : new Date(),
    isReplied: row.is_replied,
    replyContent: row.reply_content || undefined,
  };
};

export const inboxService = {
  async listByStore(storeId: string): Promise<InboxMessage[]> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('inbox_messages')
      .select('id, store_id, provider, sender_name, sender_avatar_url, content, received_at, is_replied, reply_content')
      .eq('store_id', storeId)
      .order('received_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((row) => mapDbMessage(row as DbInboxMessageRow));
  },

  async replyToMessage(messageId: string, replyContent: string): Promise<void> {
    const client = requireSupabase();
    const { error } = await client
      .from('inbox_messages')
      .update({
        is_replied: true,
        reply_content: replyContent,
        reply_sent_at: new Date().toISOString(),
      })
      .eq('id', messageId);
    if (error) throw error;
  },
};

