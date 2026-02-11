import { InboxAssignableUser, InboxMessage, InboxSlaStatus, ReplyDraftStatus, Role, SocialPlatform } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import { migrationRequiredMessage } from './migrationRequiredMessage';

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
  reply_sent_at: string | null;
  reply_draft_content: string | null;
  reply_draft_status: ReplyDraftStatus | null;
  reply_draft_generated_at: string | null;
  reply_draft_approved_at: string | null;
  tags: string[] | null;
  assigned_user_id: string | null;
  due_at: string | null;
  sla_status: InboxSlaStatus | null;
};

type LegacyDbInboxMessageRow = Omit<
  DbInboxMessageRow,
  | 'reply_draft_content'
  | 'reply_draft_status'
  | 'reply_draft_generated_at'
  | 'reply_draft_approved_at'
  | 'tags'
  | 'assigned_user_id'
  | 'due_at'
  | 'sla_status'
>;

type DbMembershipRow = {
  user_id: string;
  role: string;
};

type DbProfileRow = {
  id: string;
  name: string | null;
  email: string | null;
};

type DbStoreOrgRow = {
  org_id: string;
};

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、受信箱データを取得できません。');
  }
  return supabase;
};

const isMissingColumnError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const maybeCode = 'code' in error ? String((error as { code?: string }).code || '') : '';
  const maybeMessage = 'message' in error ? String((error as { message?: string }).message || '') : '';
  return maybeCode === '42703' || maybeMessage.includes('column');
};

const toPlatform = (provider: string): SocialPlatform => {
  if (provider === 'GBP') return 'GOOGLE_BUSINESS';
  if (provider === 'INSTAGRAM') return 'INSTAGRAM';
  if (provider === 'FACEBOOK') return 'FACEBOOK';
  if (provider === 'TIKTOK') return 'TIKTOK';
  return 'GOOGLE_BUSINESS';
};

const toRole = (raw: string): Role => {
  const upper = (raw || '').toUpperCase();
  if (upper === Role.ADMIN) return Role.ADMIN;
  if (upper === Role.SUPERVISOR) return Role.SUPERVISOR;
  if (upper === Role.MANAGER) return Role.MANAGER;
  return Role.USER;
};

const rolePriority: Record<Role, number> = {
  [Role.ADMIN]: 4,
  [Role.SUPERVISOR]: 3,
  [Role.MANAGER]: 2,
  [Role.USER]: 1,
};

const normalizeTags = (tags: string[]): string[] => {
  const unique = new Set<string>();
  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag) continue;
    unique.add(tag.slice(0, 30));
    if (unique.size >= 10) break;
  }
  return Array.from(unique);
};

const deriveSlaStatus = (params: {
  isReplied: boolean;
  dueAtIso?: string | null;
  stored?: InboxSlaStatus | null;
}): InboxSlaStatus => {
  if (params.isReplied) return 'COMPLETED';
  if (!params.dueAtIso) return params.stored || 'ON_TRACK';
  const due = new Date(params.dueAtIso).getTime();
  if (Number.isNaN(due)) return params.stored || 'ON_TRACK';
  const now = Date.now();
  if (due < now) return 'OVERDUE';
  if (due <= now + 24 * 60 * 60 * 1000) return 'AT_RISK';
  return 'ON_TRACK';
};

const mapDbMessage = (row: DbInboxMessageRow, assigneeMap: Map<string, string>): InboxMessage => {
  const tags = Array.isArray(row.tags) ? row.tags.filter((tag) => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean) : [];
  const dueAt = row.due_at ? new Date(row.due_at) : undefined;
  return {
    id: row.id,
    platform: toPlatform(row.provider),
    senderName: row.sender_name || 'ユーザー',
    senderAvatar: row.sender_avatar_url || undefined,
    content: row.content,
    receivedAt: row.received_at ? new Date(row.received_at) : new Date(),
    isReplied: row.is_replied,
    replyContent: row.reply_content || undefined,
    replySentAt: row.reply_sent_at ? new Date(row.reply_sent_at) : undefined,
    replyDraftContent: row.reply_draft_content || undefined,
    replyDraftStatus: row.reply_draft_status || undefined,
    replyDraftGeneratedAt: row.reply_draft_generated_at ? new Date(row.reply_draft_generated_at) : undefined,
    replyDraftApprovedAt: row.reply_draft_approved_at ? new Date(row.reply_draft_approved_at) : undefined,
    tags,
    assignedUserId: row.assigned_user_id || undefined,
    assignedUserName: row.assigned_user_id ? assigneeMap.get(row.assigned_user_id) : undefined,
    dueAt,
    slaStatus: deriveSlaStatus({
      isReplied: row.is_replied,
      dueAtIso: row.due_at,
      stored: row.sla_status,
    }),
  };
};

export const inboxService = {
  async listByStore(storeId: string): Promise<InboxMessage[]> {
    const client = requireSupabase();

    const fullSelect =
      'id, store_id, provider, sender_name, sender_avatar_url, content, received_at, is_replied, reply_content, reply_sent_at, reply_draft_content, reply_draft_status, reply_draft_generated_at, reply_draft_approved_at, tags, assigned_user_id, due_at, sla_status';
    const draftSelect =
      'id, store_id, provider, sender_name, sender_avatar_url, content, received_at, is_replied, reply_content, reply_sent_at, reply_draft_content, reply_draft_status, reply_draft_generated_at, reply_draft_approved_at';
    const legacySelect =
      'id, store_id, provider, sender_name, sender_avatar_url, content, received_at, is_replied, reply_content, reply_sent_at';

    let rows: DbInboxMessageRow[] = [];

    const { data: fullData, error: fullError } = await client
      .from('inbox_messages')
      .select(fullSelect)
      .eq('store_id', storeId)
      .order('received_at', { ascending: false });

    if (fullError && isMissingColumnError(fullError)) {
      const { data: draftData, error: draftError } = await client
        .from('inbox_messages')
        .select(draftSelect)
        .eq('store_id', storeId)
        .order('received_at', { ascending: false });

      if (draftError && isMissingColumnError(draftError)) {
        const { data: legacyData, error: legacyError } = await client
          .from('inbox_messages')
          .select(legacySelect)
          .eq('store_id', storeId)
          .order('received_at', { ascending: false });
        if (legacyError) throw legacyError;
        rows = (legacyData || []).map((row) => ({
          ...(row as LegacyDbInboxMessageRow),
          reply_sent_at: null,
          reply_draft_content: null,
          reply_draft_status: null,
          reply_draft_generated_at: null,
          reply_draft_approved_at: null,
          tags: [],
          assigned_user_id: null,
          due_at: null,
          sla_status: null,
        }));
      } else if (draftError) {
        throw draftError;
      } else {
        rows = (draftData || []).map((row) => ({
          ...(row as Omit<DbInboxMessageRow, 'tags' | 'assigned_user_id' | 'due_at' | 'sla_status'>),
          tags: [],
          assigned_user_id: null,
          due_at: null,
          sla_status: null,
        }));
      }
    } else if (fullError) {
      throw fullError;
    } else {
      rows = (fullData || []) as DbInboxMessageRow[];
    }

    const assignedIds = Array.from(new Set(rows.map((row) => row.assigned_user_id).filter((value): value is string => Boolean(value))));
    const assigneeMap = new Map<string, string>();
    if (assignedIds.length > 0) {
      const { data: profileRows, error: profileError } = await client
        .from('profiles')
        .select('id, name, email')
        .in('id', assignedIds);
      if (!profileError) {
        (profileRows || []).forEach((row) => {
          const profile = row as DbProfileRow;
          const name = profile.name || profile.email || profile.id;
          assigneeMap.set(profile.id, name);
        });
      }
    }

    return rows.map((row) => mapDbMessage(row, assigneeMap));
  },

  async saveReplyDraft(messageId: string, draftContent: string): Promise<void> {
    const client = requireSupabase();
    const { error } = await client
      .from('inbox_messages')
      .update({
        reply_draft_content: draftContent,
        reply_draft_status: 'PENDING_APPROVAL',
        reply_draft_generated_at: new Date().toISOString(),
        reply_draft_approved_at: null,
      })
      .eq('id', messageId);
    if (error && isMissingColumnError(error)) {
      throw new Error(migrationRequiredMessage('受信箱（返信案の保存）'));
    }
    if (error) throw error;
  },

  async replyToMessage(messageId: string, replyContent: string): Promise<void> {
    const client = requireSupabase();
    const withDraftAndSlaPayload = {
      is_replied: true,
      reply_content: replyContent,
      reply_sent_at: new Date().toISOString(),
      reply_draft_status: 'APPROVED',
      reply_draft_approved_at: new Date().toISOString(),
      sla_status: 'COMPLETED' as InboxSlaStatus,
    };

    const { error } = await client
      .from('inbox_messages')
      .update(withDraftAndSlaPayload)
      .eq('id', messageId);

    if (error && isMissingColumnError(error)) {
      const { error: legacyError } = await client
        .from('inbox_messages')
        .update({
          is_replied: true,
          reply_content: replyContent,
          reply_sent_at: new Date().toISOString(),
        })
        .eq('id', messageId);
      if (legacyError) throw legacyError;
      return;
    }
    if (error) throw error;
  },

  async listAssignableUsersByStore(storeId: string): Promise<InboxAssignableUser[]> {
    const client = requireSupabase();
    const { data: store, error: storeError } = await client
      .from('stores')
      .select('org_id')
      .eq('id', storeId)
      .maybeSingle();
    if (storeError || !store) {
      throw new Error('店舗情報の取得に失敗しました。');
    }
    const storeRow = store as DbStoreOrgRow;

    const { data: memberships, error: membershipError } = await client
      .from('memberships')
      .select('user_id, role')
      .eq('org_id', storeRow.org_id);
    if (membershipError) throw membershipError;

    const grouped = new Map<string, Role>();
    ((memberships || []) as DbMembershipRow[]).forEach((row) => {
      const role = toRole(row.role);
      const existing = grouped.get(row.user_id);
      if (!existing || rolePriority[role] > rolePriority[existing]) {
        grouped.set(row.user_id, role);
      }
    });

    const userIds = Array.from(grouped.keys());
    if (userIds.length === 0) return [];

    const { data: profiles, error: profileError } = await client
      .from('profiles')
      .select('id, name, email')
      .in('id', userIds);
    if (profileError) throw profileError;

    const profileMap = new Map<string, DbProfileRow>();
    ((profiles || []) as DbProfileRow[]).forEach((profile) => {
      profileMap.set(profile.id, profile);
    });

    const users: InboxAssignableUser[] = userIds.map((userId) => {
      const profile = profileMap.get(userId);
      const name = profile?.name || profile?.email || userId;
      return {
        id: userId,
        name,
        role: grouped.get(userId) || Role.USER,
      };
    });

    return users.sort((a, b) => {
      const roleDiff = rolePriority[b.role] - rolePriority[a.role];
      if (roleDiff !== 0) return roleDiff;
      return a.name.localeCompare(b.name, 'ja');
    });
  },

  async updateWorkflow(params: {
    messageId: string;
    tags: string[];
    assignedUserId?: string | null;
    dueAt?: Date | null;
  }): Promise<{ tags: string[]; assignedUserId?: string; dueAt?: Date; slaStatus: InboxSlaStatus }> {
    const client = requireSupabase();

    const { data: messageRow, error: messageError } = await client
      .from('inbox_messages')
      .select('is_replied')
      .eq('id', params.messageId)
      .maybeSingle();
    if (messageError || !messageRow) {
      throw new Error('対象メッセージが見つかりません。');
    }

    const tags = normalizeTags(params.tags || []);
    const dueAtIso = params.dueAt ? params.dueAt.toISOString() : null;
    const isReplied = Boolean((messageRow as { is_replied?: boolean }).is_replied);
    const slaStatus = deriveSlaStatus({ isReplied, dueAtIso });

    const { error } = await client
      .from('inbox_messages')
      .update({
        tags,
        assigned_user_id: params.assignedUserId || null,
        due_at: dueAtIso,
        sla_status: slaStatus,
      })
      .eq('id', params.messageId);

    if (error && isMissingColumnError(error)) {
      throw new Error(migrationRequiredMessage('受信箱（担当/期限/タグ）'));
    }
    if (error) throw error;

    return {
      tags,
      assignedUserId: params.assignedUserId || undefined,
      dueAt: params.dueAt || undefined,
      slaStatus,
    };
  },
};
