import React, { useEffect, useMemo, useState } from 'react';
import { InboxAssignableUser, InboxMessage, InboxReactionType, InboxSlaStatus, SocialPlatform, User } from '../types';
import { CalendarClock, Image as ImageIcon, Loader2, MessageCircle, Paperclip, Search, Send, Smile, Sparkles, Tag, ThumbsUp, UserRoundCheck, Video } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { inboxService } from '../services/inboxService';
import { geminiService } from '../services/geminiService';
import { useStore } from '../contexts/StoreContext';
import { messageReplyService } from '../services/messageReplyService';
import { getErrorMessage } from '../services/errorMessage';
import { featureFlagsService, resolveFeatureState } from '../services/featureFlagsService';
import { inboxSyncService } from '../services/inboxSyncService';
import { inboxReactionCacheService } from '../services/inboxReactionCacheService';
import { inboxReactionService } from '../services/inboxReactionService';
import { PAGE_CONTAINER_CLASS, PAGE_HEADER_DESCRIPTION_CLASS, PAGE_HEADER_TITLE_CLASS } from './ui/pageLayout';
import { SocialPlatformLogo } from './ui/SocialPlatformLogo';
import { formatViewLabel } from './ui/formatters';

const platformLabel: Record<SocialPlatform, string> = {
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  GOOGLE_BUSINESS: 'Googleビジネスプロフィール',
  TIKTOK: 'TikTok',
};

const slaLabel: Record<InboxSlaStatus, string> = {
  ON_TRACK: '順調',
  AT_RISK: '要注意',
  OVERDUE: '期限超過',
  COMPLETED: '完了',
};

const slaBadgeClass: Record<InboxSlaStatus, string> = {
  ON_TRACK: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200',
  AT_RISK: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
  OVERDUE: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200',
  COMPLETED: 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-100',
};

type InboxStatusFilter = 'ALL' | 'UNREPLIED' | 'REPLIED' | 'ASSIGNED' | 'AT_RISK' | 'OVERDUE';
type InboxPrimaryTab = 'REVIEWS' | 'DM';
const RECENT_DAYS_DEFAULT = 7;
const REACTION_OPTIONS: Array<{ type: InboxReactionType; label: string; emoji: string }> = [
  { type: 'LIKE', label: 'いいね', emoji: '👍' },
  { type: 'ANGRY', label: 'バッド', emoji: '👎' },
];

const statusFilterItems: { key: InboxStatusFilter; label: string }[] = [
  { key: 'ALL', label: 'すべて' },
  { key: 'UNREPLIED', label: '未返信' },
  { key: 'REPLIED', label: '返信済み' },
  { key: 'ASSIGNED', label: '担当あり' },
  { key: 'AT_RISK', label: '要注意' },
  { key: 'OVERDUE', label: '期限超過' },
];

const formatMessageDate = (date: Date) => {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const h = (`0${date.getHours()}`).slice(-2);
  const min = (`0${date.getMinutes()}`).slice(-2);
  return `${m}/${d} ${h}:${min}`;
};

const formatDetailDate = (date: Date) => {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const h = (`0${date.getHours()}`).slice(-2);
  const min = (`0${date.getMinutes()}`).slice(-2);
  return `${y}年${m}月${d}日 ${h}:${min}`;
};

const formatDateTimeLocal = (date?: Date): string => {
  if (!date) return '';
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  const localDate = new Date(date.getTime() - offsetMs);
  return localDate.toISOString().slice(0, 16);
};

const parseDateTimeLocal = (value: string): Date | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
};

const isDraftPendingApproval = (message: InboxMessage): boolean => {
  return message.replyDraftStatus === 'PENDING_APPROVAL' && Boolean(message.replyDraftContent);
};

const normalizeTagInput = (raw: string): string[] => {
  const tokens = raw
    .split(/[,\n]/)
    .map((token) => token.trim())
    .filter(Boolean);

  const set = new Set<string>();
  for (const token of tokens) {
    set.add(token.slice(0, 30));
    if (set.size >= 10) break;
  }
  return Array.from(set);
};

const deriveSlaStatus = (isReplied: boolean, dueAt?: Date): InboxSlaStatus => {
  if (isReplied) return 'COMPLETED';
  if (!dueAt) return 'ON_TRACK';
  const dueMs = dueAt.getTime();
  if (Number.isNaN(dueMs)) return 'ON_TRACK';
  const now = Date.now();
  if (dueMs < now) return 'OVERDUE';
  if (dueMs <= now + 24 * 60 * 60 * 1000) return 'AT_RISK';
  return 'ON_TRACK';
};

const getSupportedReactions = (message: InboxMessage): InboxReactionType[] => {
  if (message.platform === 'GOOGLE_BUSINESS') {
    return [];
  }
  if (message.platform === 'INSTAGRAM') {
    return ['LIKE'];
  }
  if (message.platform === 'FACEBOOK') {
    return ['LIKE', 'ANGRY'];
  }
  return [];
};

const reactionLabelMap: Record<InboxReactionType, string> = REACTION_OPTIONS.reduce((acc, option) => {
  acc[option.type] = `${option.emoji} ${option.label}`;
  return acc;
}, {} as Record<InboxReactionType, string>);

const getReactionLabel = (message: InboxMessage, reaction: InboxReactionType): string => {
  if (reaction === 'LIKE' && (message.platform === 'INSTAGRAM' || message.platform === 'GOOGLE_BUSINESS')) {
    return '❤️ ハート';
  }
  return reactionLabelMap[reaction];
};

const toInitial = (name: string): string => {
  const normalized = (name || '').trim();
  if (!normalized) return '?';
  return normalized.slice(0, 1).toUpperCase();
};

const SenderAvatar: React.FC<{ message: InboxMessage; sizeClass: string }> = ({ message, sizeClass }) => {
  if (message.senderAvatar) {
    return (
      <img
        src={message.senderAvatar}
        className={`${sizeClass} rounded-full object-cover border border-gray-200 dark:border-gray-600`}
        alt={`${message.senderName}のアイコン`}
      />
    );
  }
  return (
    <div
      className={`${sizeClass} rounded-full border border-gray-200 dark:border-gray-600 bg-gradient-to-br from-indigo-500 to-primary-600 text-white flex items-center justify-center font-bold`}
      aria-label={`${message.senderName}のアイコン`}
      title={message.senderName}
    >
      {toInitial(message.senderName)}
    </div>
  );
};

interface UnifiedInboxProps {
  currentUser: User;
}

export const UnifiedInbox: React.FC<UnifiedInboxProps> = ({ currentUser }) => {
  const { addNotification } = useNotification();
  const { activeStoreId, selectedStoreIds, stores } = useStore();
  const isMultiStoreSelected = selectedStoreIds.length > 1;
  const activeOrgId = useMemo(() => {
    if (!activeStoreId) return null;
    return stores.find((store) => store.id === activeStoreId)?.orgId || null;
  }, [activeStoreId, stores]);

  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [bulkReaction, setBulkReaction] = useState<InboxReactionType>('LIKE');
  const [isApplyingReaction, setIsApplyingReaction] = useState(false);
  const [isBulkApplyingReaction, setIsBulkApplyingReaction] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<InboxStatusFilter>('ALL');
  const [platformFilter, setPlatformFilter] = useState<'ALL' | SocialPlatform>('ALL');
  const [primaryTab, setPrimaryTab] = useState<InboxPrimaryTab>('REVIEWS');
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [inboxAutoSyncEnabled, setInboxAutoSyncEnabled] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState<InboxAssignableUser[]>([]);
  const [workflowTagsInput, setWorkflowTagsInput] = useState('');
  const [workflowAssignedUserId, setWorkflowAssignedUserId] = useState('');
  const [workflowDueAtInput, setWorkflowDueAtInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [isWorkflowSaving, setIsWorkflowSaving] = useState(false);
  const [isAssignableLoading, setIsAssignableLoading] = useState(false);
  const [reactionMap, setReactionMap] = useState<Record<string, InboxReactionType>>({});

  const selectedMessage = useMemo(
    () => messages.find((message) => message.id === selectedMessageId) || null,
    [messages, selectedMessageId]
  );
  const canReplyRemoteMessage = Boolean(
    selectedMessage &&
      selectedMessage.source === 'REMOTE_CACHE' &&
      selectedMessage.channel !== 'DM' &&
      ['FACEBOOK', 'INSTAGRAM', 'GOOGLE_BUSINESS'].includes(selectedMessage.platform) &&
      selectedMessage.externalMessageId
  );

  const selectedReactionTargets = useMemo(() => {
    if (selectedMessageIds.length === 0) return [];
    const selectedSet = new Set(selectedMessageIds);
    return messages.filter((message) => selectedSet.has(message.id) && getSupportedReactions(message).length > 0);
  }, [messages, selectedMessageIds]);

  const availableBulkReactions = useMemo(() => {
    if (selectedReactionTargets.length === 0) return [];
    return REACTION_OPTIONS.filter((option) => selectedReactionTargets.some((message) => getSupportedReactions(message).includes(option.type)));
  }, [selectedReactionTargets]);

  const patchMessage = (messageId: string, patch: Partial<InboxMessage>) => {
    setMessages((prev) => prev.map((message) => (message.id === messageId ? { ...message, ...patch } : message)));
  };

  const applyReactionSnapshot = (rows: InboxMessage[], map: Record<string, InboxReactionType>): InboxMessage[] => {
    return rows.map((row) => ({
      ...row,
      reaction: map[row.id] || row.reaction,
    }));
  };

  const refreshReactionMap = (storeId: string | null) => {
    if (!storeId) {
      setReactionMap({});
      return;
    }
    const cached = inboxReactionCacheService.listByStore(storeId);
    const next: Record<string, InboxReactionType> = {};
    Object.entries(cached).forEach(([messageId, row]) => {
      next[messageId] = row.reaction;
    });
    setReactionMap(next);
  };

  const toggleMessageSelection = (messageId: string) => {
    setSelectedMessageIds((prev) => (
      prev.includes(messageId) ? prev.filter((id) => id !== messageId) : [...prev, messageId]
    ));
  };

  const persistReactionCache = (messageId: string, reaction: InboxReactionType) => {
    patchMessage(messageId, { reaction });
    setReactionMap((prev) => ({ ...prev, [messageId]: reaction }));
    if (!activeStoreId) return;
    inboxReactionCacheService.saveReaction({
      storeId: activeStoreId,
      messageId,
      reaction,
    });
  };

  const applyReactionToMessage = async (message: InboxMessage, reaction: InboxReactionType) => {
    if (!activeStoreId) {
      throw new Error(
        isMultiStoreSelected
          ? '複数店舗選択中はリアクションを送信できません。店舗を1つだけ選択してください。'
          : '先に店舗を選択してください。'
      );
    }
    if (!isSupabaseConfigured) {
      persistReactionCache(message.id, reaction);
      return;
    }
    await inboxReactionService.apply({
      storeId: activeStoreId,
      message,
      reaction,
    });
    persistReactionCache(message.id, reaction);
  };

  const handleApplyReaction = async (message: InboxMessage, reaction: InboxReactionType) => {
    setIsApplyingReaction(true);
    try {
      await applyReactionToMessage(message, reaction);
      addNotification('リアクション送信', `${message.senderName} へのリアクションを送信しました。`, 'SUCCESS');
    } catch (error) {
      addNotification('リアクションエラー', getErrorMessage(error) || 'リアクション送信に失敗しました。', 'ERROR');
    } finally {
      setIsApplyingReaction(false);
    }
  };

  useEffect(() => {
    if (availableBulkReactions.length === 0) return;
    if (!availableBulkReactions.some((option) => option.type === bulkReaction)) {
      setBulkReaction(availableBulkReactions[0].type);
    }
  }, [availableBulkReactions, bulkReaction]);

  const sortMessagesByReceivedAt = (rows: InboxMessage[]) => {
    return [...rows].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
  };

  const filterRecentMessages = (rows: InboxMessage[]): InboxMessage[] => {
    const threshold = Date.now() - RECENT_DAYS_DEFAULT * 24 * 60 * 60 * 1000;
    return rows.filter((row) => row.receivedAt.getTime() >= threshold);
  };

  const loadInboxAutoSyncFlag = async () => {
    if (!isSupabaseConfigured || !activeOrgId) {
      setInboxAutoSyncEnabled(false);
      return;
    }
    try {
      const rows = await featureFlagsService.listByOrg(activeOrgId, activeStoreId || undefined);
      const state = resolveFeatureState(rows, 'inbox_autosync', activeStoreId || undefined);
      setInboxAutoSyncEnabled(state === 'ENABLED');
    } catch {
      setInboxAutoSyncEnabled(false);
    }
  };

  const handleSyncInbox = async (options?: { silent?: boolean; force?: boolean; fullHistory?: boolean }) => {
    if (!activeStoreId) {
      if (!options?.silent) {
        addNotification(
          '同期エラー',
          isMultiStoreSelected
            ? '複数店舗選択中は同期できません。店舗を1つだけ選択してください。'
            : '先に店舗を選択してください。',
          'ERROR'
        );
      }
      return;
    }

    if (!isSupabaseConfigured) {
      if (!options?.silent) {
        addNotification('モック', 'Supabase未設定のため同期を実行できません。', 'INFO');
      }
      return;
    }

    const loadFullHistory = Boolean(options?.fullHistory || historyLoaded);
    const includeDm = primaryTab === 'DM';

    setIsSyncing(true);
    try {
      const result = await inboxSyncService.sync({
        storeId: activeStoreId,
        providers: ['FACEBOOK', 'INSTAGRAM', 'GBP'],
        mode: loadFullHistory ? 'FULL' : 'LATEST_ONLY',
        includeDm,
        force: options?.force ?? true,
      });
      setLastSyncAt(result.lastSyncAt);
      const sorted = sortMessagesByReceivedAt(result.messages);
      const nextMessages = applyReactionSnapshot(loadFullHistory ? sorted : filterRecentMessages(sorted), reactionMap);
      setMessages(nextMessages);
      setHistoryLoaded(loadFullHistory);

      if (!options?.silent) {
        const totalSynced = Object.values(result.syncedCountByProvider || {}).reduce((sum, value) => sum + Number(value || 0), 0);
        const errorEntries = Object.entries(result.errors || {});
        const detail = Object.entries(result.syncedCountByProvider || {})
          .map(([provider, count]) => `${provider}:${count}件`)
          .join(' / ');
        addNotification(
          '受信箱を同期しました',
          `${totalSynced}件を更新しました。${detail ? `（${detail}）` : ''}${loadFullHistory ? ' 過去データも含めて表示しています。' : ` 直近${RECENT_DAYS_DEFAULT}日を表示しています。`}${errorEntries.length > 0 ? ` 一部エラー: ${errorEntries.map(([provider, message]) => `${provider}:${message}`).join(' / ')}` : ''}`,
          errorEntries.length > 0 ? 'WARNING' : 'SUCCESS'
        );
      }
    } catch (error) {
      if (!options?.silent) {
        addNotification('同期エラー', getErrorMessage(error) || '受信箱の同期に失敗しました。', 'ERROR');
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const reloadMessages = async () => {
    if (!isSupabaseConfigured) {
      setMessages([]);
      if (selectedMessageId) setSelectedMessageId(null);
      return;
    }
    if (selectedStoreIds.length === 0) {
      setMessages([]);
      return;
    }

    const includeDm = primaryTab === 'DM';
    const loadFullHistory = historyLoaded;
    setIsLoading(true);
    try {
      let nextMessages: InboxMessage[] = [];
      if (isMultiStoreSelected) {
        const data = await inboxService.listByStores(selectedStoreIds);
        const sorted = sortMessagesByReceivedAt(data);
        nextMessages = loadFullHistory ? sorted : filterRecentMessages(sorted);
        setLastSyncAt(null);
        setMessages(nextMessages);
      } else if (activeStoreId) {
        const result = await inboxSyncService.sync({
          storeId: activeStoreId,
          providers: ['FACEBOOK', 'INSTAGRAM', 'GBP'],
          mode: loadFullHistory ? 'FULL' : 'LATEST_ONLY',
          includeDm,
          force: false,
        });
        const data = sortMessagesByReceivedAt(result.messages);
        nextMessages = applyReactionSnapshot(loadFullHistory ? data : filterRecentMessages(data), reactionMap);
        setLastSyncAt(result.lastSyncAt);
        setMessages(nextMessages);
      } else {
        setLastSyncAt(null);
        setMessages([]);
      }
      if (nextMessages.length > 0 && !nextMessages.find((message) => message.id === selectedMessageId)) {
        setSelectedMessageId(nextMessages[0].id);
      }
    } catch (error) {
      addNotification('読み込みエラー', getErrorMessage(error) || '受信箱の取得に失敗しました。', 'ERROR');
    } finally {
      setIsLoading(false);
    }
  };

  const reloadAssignableUsers = async () => {
    if (!isSupabaseConfigured || !activeStoreId) {
      setAssignableUsers([{ id: currentUser.id, name: currentUser.name, role: currentUser.role }]);
      return;
    }

    setIsAssignableLoading(true);
    try {
      const users = await inboxService.listAssignableUsersByStore(activeStoreId);
      setAssignableUsers(users);
    } catch (error) {
      setAssignableUsers([]);
      addNotification('担当者取得エラー', getErrorMessage(error) || '担当者候補の取得に失敗しました。', 'ERROR');
    } finally {
      setIsAssignableLoading(false);
    }
  };

  useEffect(() => {
    void reloadMessages();
    void reloadAssignableUsers();
    void loadInboxAutoSyncFlag();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStoreIds.join(','), activeStoreId, activeOrgId, primaryTab, historyLoaded, isMultiStoreSelected]);

  useEffect(() => {
    refreshReactionMap(activeStoreId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStoreId]);

  useEffect(() => {
    setMessages((prev) => applyReactionSnapshot(prev, reactionMap));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reactionMap]);

  useEffect(() => {
    if (!activeStoreId || !inboxAutoSyncEnabled || primaryTab !== 'REVIEWS') return;
    void handleSyncInbox({ silent: true, force: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStoreId, inboxAutoSyncEnabled, primaryTab]);

  useEffect(() => {
    if (!selectedMessageId) {
      setReplyText('');
      return;
    }
    const message = messages.find((m) => m.id === selectedMessageId);
    if (!message || message.isReplied) {
      setReplyText('');
      return;
    }
    setReplyText(message.replyDraftContent || '');
  }, [messages, selectedMessageId]);

  useEffect(() => {
    if (!selectedMessage) {
      setWorkflowTagsInput('');
      setWorkflowAssignedUserId('');
      setWorkflowDueAtInput('');
      return;
    }
    setWorkflowTagsInput((selectedMessage.tags || []).join(', '));
    setWorkflowAssignedUserId(selectedMessage.assignedUserId || '');
    setWorkflowDueAtInput(formatDateTimeLocal(selectedMessage.dueAt));
  }, [selectedMessage]);

  const filteredMessages = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return messages.filter((message) => {
      const messageChannel = message.channel || 'REVIEWS';
      if (primaryTab === 'DM' && messageChannel !== 'DM') return false;
      if (primaryTab === 'REVIEWS' && messageChannel === 'DM') return false;
      if (platformFilter !== 'ALL' && message.platform !== platformFilter) return false;
      if (statusFilter === 'UNREPLIED' && message.isReplied) return false;
      if (statusFilter === 'REPLIED' && !message.isReplied) return false;
      if (statusFilter === 'ASSIGNED' && !message.assignedUserId) return false;
      if (statusFilter === 'AT_RISK' && message.slaStatus !== 'AT_RISK') return false;
      if (statusFilter === 'OVERDUE' && message.slaStatus !== 'OVERDUE') return false;
      if (!query) return true;

      const searchTargets = [
        message.senderName,
        message.content,
        message.platform,
        message.assignedUserName || '',
        (message.tags || []).join(' '),
      ]
        .join(' ')
        .toLowerCase();
      return searchTargets.includes(query);
    });
  }, [messages, platformFilter, primaryTab, searchText, statusFilter]);

  useEffect(() => {
    if (filteredMessages.length === 0) {
      setSelectedMessageId(null);
      return;
    }
    if (!selectedMessageId || !filteredMessages.some((message) => message.id === selectedMessageId)) {
      setSelectedMessageId(filteredMessages[0].id);
    }
  }, [filteredMessages, selectedMessageId]);

  useEffect(() => {
    const availableIds = new Set(filteredMessages.map((message) => message.id));
    setSelectedMessageIds((prev) => prev.filter((id) => availableIds.has(id)));
  }, [filteredMessages]);

  const handleGenerateReplyDraft = async () => {
    if (!selectedMessage || selectedMessage.isReplied) return;

    setIsGeneratingDraft(true);
    try {
      const draft = (
        await geminiService.generateReviewReplyDraft({
          senderName: selectedMessage.senderName,
          platform: selectedMessage.platform,
          reviewText: selectedMessage.content,
        })
      ).trim();

      if (!draft) {
        throw new Error('AI返信案が空でした。');
      }

      if (isSupabaseConfigured && selectedMessage.source !== 'REMOTE_CACHE') {
        await inboxService.saveReplyDraft(selectedMessage.id, draft);
      }

      const now = new Date();
      patchMessage(selectedMessage.id, {
        replyDraftContent: draft,
        replyDraftStatus: 'PENDING_APPROVAL',
        replyDraftGeneratedAt: now,
        replyDraftApprovedAt: undefined,
      });
      setReplyText(draft);
      addNotification('AI返信案を作成', '承認前保留として保存しました。内容を確認して送信してください。', 'SUCCESS');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'AI返信案の作成に失敗しました。時間を置いて再試行してください。';
      addNotification('AI返信案エラー', errorMessage, 'ERROR');
    } finally {
      setIsGeneratingDraft(false);
    }
  };

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMessage || selectedMessage.isReplied) return;
    if (isMultiStoreSelected) {
      addNotification('複数店舗選択中', '複数店舗選択中は返信を送信できません。店舗を1つだけ選択してください。', 'WARNING');
      return;
    }

    const normalizedReply = replyText.trim();
    if (!normalizedReply) return;

    if (!isSupabaseConfigured) {
      patchMessage(selectedMessage.id, {
        isReplied: true,
        replyContent: normalizedReply,
        replyDraftStatus: 'APPROVED',
        replyDraftApprovedAt: new Date(),
        slaStatus: 'COMPLETED',
      });
      addNotification('返信送信完了', `${selectedMessage.senderName} さんへ返信しました`, 'SUCCESS');
      setReplyText('');
      return;
    }

    setIsSubmitting(true);
    try {
      if (selectedMessage.source === 'REMOTE_CACHE') {
        if (!activeStoreId) {
          throw new Error('店舗が未選択のため返信できません。');
        }
        if (selectedMessage.channel === 'DM') {
          addNotification('返信未対応', 'DMの返信連携は次段で対応します。現在は口コミ・コメント返信のみ対応しています。', 'INFO');
          return;
        }
        if (!selectedMessage.externalMessageId) {
          addNotification('返信未対応', 'この連携先のキャッシュメッセージ返信は準備中です。', 'INFO');
          return;
        }
        let result;
        if (selectedMessage.platform === 'FACEBOOK') {
          result = await messageReplyService.replyFacebookExternalMessage({
            storeId: activeStoreId,
            externalMessageId: selectedMessage.externalMessageId,
            replyContent: normalizedReply,
          });
        } else if (selectedMessage.platform === 'INSTAGRAM') {
          result = await messageReplyService.replyInstagramExternalComment({
            storeId: activeStoreId,
            externalMessageId: selectedMessage.externalMessageId,
            replyContent: normalizedReply,
          });
        } else if (selectedMessage.platform === 'GOOGLE_BUSINESS') {
          result = await messageReplyService.replyGbpExternalReview({
            storeId: activeStoreId,
            externalMessageId: selectedMessage.externalMessageId,
            replyContent: normalizedReply,
          });
        } else {
          addNotification('返信未対応', 'この連携先のキャッシュメッセージ返信は準備中です。', 'INFO');
          return;
        }
        addNotification(
          '返信送信完了',
          result.mode === 'REAL'
            ? `${selectedMessage.senderName} さんへ返信しました`
            : `${selectedMessage.senderName} さんへMOCK返信を記録しました`,
          'SUCCESS'
        );
      } else if (selectedMessage.platform === 'FACEBOOK') {
        const result = await messageReplyService.replyFacebookMessage({
          messageId: selectedMessage.id,
          actorUserId: currentUser.id,
          replyContent: normalizedReply,
        });
        addNotification(
          '返信送信完了',
          result.mode === 'REAL'
            ? `${selectedMessage.senderName} さんへFacebook返信しました`
            : `${selectedMessage.senderName} さんへMOCK返信を記録しました`,
          'SUCCESS'
        );
      } else if (selectedMessage.platform === 'INSTAGRAM') {
        const result = await messageReplyService.replyInstagramMessage({
          messageId: selectedMessage.id,
          actorUserId: currentUser.id,
          replyContent: normalizedReply,
        });
        addNotification(
          '返信送信完了',
          result.mode === 'REAL'
            ? `${selectedMessage.senderName} さんへInstagram返信しました`
            : `${selectedMessage.senderName} さんへMOCK返信を記録しました`,
          'SUCCESS'
        );
      } else if (selectedMessage.platform === 'GOOGLE_BUSINESS') {
        const result = await messageReplyService.replyGbpReview({
          messageId: selectedMessage.id,
          actorUserId: currentUser.id,
          replyContent: normalizedReply,
        });
        addNotification(
          '返信送信完了',
          result.mode === 'REAL'
            ? `${selectedMessage.senderName} さんへGBP返信しました`
            : `${selectedMessage.senderName} さんへMOCK返信を記録しました`,
          'SUCCESS'
        );
      } else {
        await inboxService.replyToMessage(selectedMessage.id, normalizedReply);
        addNotification('返信送信完了', `${selectedMessage.senderName} さんへ返信しました`, 'SUCCESS');
      }
      patchMessage(selectedMessage.id, {
        isReplied: true,
        replyContent: normalizedReply,
        replyDraftStatus: 'APPROVED',
        replyDraftApprovedAt: new Date(),
        slaStatus: 'COMPLETED',
      });
      setReplyText('');
    } catch (error) {
      addNotification('返信エラー', getErrorMessage(error) || '返信の保存に失敗しました。', 'ERROR');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveWorkflow = async () => {
    if (!selectedMessage) return;

    const dueAt = parseDateTimeLocal(workflowDueAtInput);
    if (workflowDueAtInput && !dueAt) {
      addNotification('入力エラー', '対応期限の形式が不正です。', 'ERROR');
      return;
    }

    const normalizedTags = normalizeTagInput(workflowTagsInput);
    const assignedUserId = workflowAssignedUserId || undefined;
    const assignedUserName = assignedUserId
      ? assignableUsers.find((user) => user.id === assignedUserId)?.name
      : undefined;

    setIsWorkflowSaving(true);
    try {
      if (!isSupabaseConfigured || selectedMessage.source === 'REMOTE_CACHE') {
        const nextSlaStatus = deriveSlaStatus(selectedMessage.isReplied, dueAt);
        patchMessage(selectedMessage.id, {
          tags: normalizedTags,
          assignedUserId,
          assignedUserName,
          dueAt,
          slaStatus: nextSlaStatus,
        });
        addNotification('ワークフロー更新', 'モック状態でワークフローを更新しました。', 'SUCCESS');
        return;
      }

      const result = await inboxService.updateWorkflow({
        messageId: selectedMessage.id,
        tags: normalizedTags,
        assignedUserId: assignedUserId || null,
        dueAt: dueAt || null,
      });
      patchMessage(selectedMessage.id, {
        tags: result.tags,
        assignedUserId: result.assignedUserId,
        assignedUserName: result.assignedUserId
          ? assignableUsers.find((user) => user.id === result.assignedUserId)?.name
          : undefined,
        dueAt: result.dueAt,
        slaStatus: result.slaStatus,
      });
      addNotification('ワークフロー更新', 'タグ・担当・期限を保存しました。', 'SUCCESS');
    } catch (error) {
      addNotification('保存エラー', getErrorMessage(error) || 'ワークフローの保存に失敗しました。', 'ERROR');
    } finally {
      setIsWorkflowSaving(false);
    }
  };

  const handleBulkApplyReaction = async () => {
    if (selectedMessageIds.length === 0) {
      addNotification('未選択', '先に対象メッセージを選択してください。', 'WARNING');
      return;
    }

    if (selectedReactionTargets.length === 0) {
      addNotification('一括リアクション', '選択中のメッセージはリアクション未対応です。', 'WARNING');
      return;
    }

    setIsBulkApplyingReaction(true);
    try {
      const targets = selectedReactionTargets.filter((message) => getSupportedReactions(message).includes(bulkReaction));
      if (targets.length === 0) {
        addNotification('一括リアクション', '選択中のSNSではこのリアクションを利用できません。', 'WARNING');
        return;
      }
      const results = await Promise.allSettled(targets.map((message) => applyReactionToMessage(message, bulkReaction)));
      const successCount = results.filter((result) => result.status === 'fulfilled').length;
      const failedResults = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');

      if (failedResults.length > 0) {
        const detail = failedResults[0]?.reason ? getErrorMessage(failedResults[0].reason) : '一部のリアクション送信に失敗しました。';
        addNotification(
          '一括リアクション',
          `${successCount}件送信、${failedResults.length}件失敗しました。${detail ? `（${detail}）` : ''}`,
          'WARNING',
        );
      } else {
        addNotification('一括リアクション', `${successCount}件に ${reactionLabelMap[bulkReaction]} を送信しました。`, 'SUCCESS');
      }
    } finally {
      setIsBulkApplyingReaction(false);
    }
  };

  const previewDueAt = parseDateTimeLocal(workflowDueAtInput);
  const previewSlaStatus = selectedMessage
    ? deriveSlaStatus(selectedMessage.isReplied, previewDueAt)
    : 'ON_TRACK';
  const selectedMessageSupportedReactions = selectedMessage ? getSupportedReactions(selectedMessage) : [];

  return (
    <div className={PAGE_CONTAINER_CLASS}>
      <section>
        <h1 className={PAGE_HEADER_TITLE_CLASS}>{formatViewLabel('INBOX')}</h1>
        <p className={PAGE_HEADER_DESCRIPTION_CLASS}>口コミ・コメント・DMを確認できます。画像/動画はローカルキャッシュ表示です。</p>
      </section>

      <section className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-1">
          <button
            type="button"
            onClick={() => setPrimaryTab('REVIEWS')}
            className={`px-3 py-1.5 text-sm rounded-lg ${
              primaryTab === 'REVIEWS'
                ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                : 'text-gray-600 dark:text-gray-300'
            }`}
          >
            口コミ・コメント
          </button>
          <button
            type="button"
            onClick={() => setPrimaryTab('DM')}
            className={`px-3 py-1.5 text-sm rounded-lg ${
              primaryTab === 'DM'
                ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                : 'text-gray-600 dark:text-gray-300'
            }`}
          >
            DM
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            同期モード: {inboxAutoSyncEnabled ? '自動同期' : '手動同期のみ'}
            {lastSyncAt ? ` / 最終同期: ${formatDetailDate(lastSyncAt)}` : ''}
          </span>
          {!historyLoaded ? (
            <button
              type="button"
              onClick={() => {
                if (isMultiStoreSelected) {
                  setHistoryLoaded(true);
                  void reloadMessages();
                  return;
                }
                void handleSyncInbox({ force: true, fullHistory: true });
              }}
              disabled={selectedStoreIds.length === 0 || isSyncing || isLoading}
              title={
                isMultiStoreSelected
                  ? '複数店舗選択中は外部同期できません（表示の切替のみ可能です）。'
                  : undefined
              }
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
            >
              過去のメッセージを読み込む
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setHistoryLoaded(false);
                if (isMultiStoreSelected) {
                  void reloadMessages();
                  return;
                }
                void handleSyncInbox({ force: true, fullHistory: false });
              }}
              disabled={selectedStoreIds.length === 0 || isSyncing || isLoading}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
            >
              直近1週間表示に戻す
            </button>
          )}
          <button
            data-testid="inbox-sync-button"
            type="button"
            onClick={() => {
              if (isMultiStoreSelected) {
                void reloadMessages();
                return;
              }
              void handleSyncInbox();
            }}
            disabled={selectedStoreIds.length === 0 || isSyncing || isLoading || (isMultiStoreSelected ? false : !activeStoreId)}
            title={
              isMultiStoreSelected
                ? '複数店舗選択中は外部同期できません（DB表示の再読み込みのみ可能です）。'
                : !activeStoreId
                  ? '先に店舗を選択してください。'
                  : undefined
            }
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSyncing ? <Loader2 size={14} className="animate-spin" /> : <CalendarClock size={14} />}
            {isMultiStoreSelected ? '表示を更新' : '受信内容を同期'}
          </button>
        </div>
      </section>

      {selectedMessageIds.length > 0 && (
        <section className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-900/20 p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="text-sm text-indigo-800 dark:text-indigo-100 font-medium">
            {selectedMessageIds.length}件を選択中
            {selectedReactionTargets.length !== selectedMessageIds.length && (
              <span className="ml-2 text-xs font-normal text-indigo-700/90 dark:text-indigo-200/90">
                （{selectedReactionTargets.length}件がリアクション対応）
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={bulkReaction}
              onChange={(e) => setBulkReaction(e.target.value as InboxReactionType)}
              disabled={availableBulkReactions.length === 0}
              className="px-3 py-2 text-sm border border-indigo-300 dark:border-indigo-600 rounded-lg bg-white dark:bg-gray-800 dark:text-white"
            >
              {availableBulkReactions.map((option) => (
                <option key={option.type} value={option.type}>
                  {option.emoji} {option.label}
                </option>
              ))}
              {availableBulkReactions.length === 0 && (
                <option value="LIKE">利用可能なリアクションがありません</option>
              )}
            </select>
            <button
              type="button"
              onClick={() => void handleBulkApplyReaction()}
              disabled={isBulkApplyingReaction || availableBulkReactions.length === 0}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-60"
            >
              {isBulkApplyingReaction ? <Loader2 size={14} className="animate-spin" /> : <ThumbsUp size={14} />}
              一括リアクション
            </button>
          </div>
        </section>
      )}

      <div className="h-[calc(100vh-220px)] flex flex-col md:flex-row bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div
        id="inbox-left-panel"
        className="w-full md:w-1/3 border-r border-gray-200 dark:border-gray-700 flex flex-col bg-gray-50 dark:bg-gray-800"
      >
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <h2 className="text-lg font-bold text-gray-800 dark:text-white mb-3">メッセージ一覧</h2>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-gray-400 h-4 w-4" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="送信者・本文・タグを検索..."
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
            {statusFilterItems.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setStatusFilter(item.key)}
                className={`px-3 py-1 text-xs font-medium rounded-full whitespace-nowrap border ${
                  statusFilter === item.key
                    ? 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900 dark:text-indigo-300 dark:border-indigo-700'
                    : 'bg-white border-gray-200 text-gray-600 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="mt-3">
            <select
              id="inbox-platform-filter"
              data-testid="inbox-platform-filter"
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value as 'ALL' | SocialPlatform)}
              className="w-full px-3 py-2 text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white"
            >
              <option value="ALL">全プラットフォーム</option>
              <option value="GOOGLE_BUSINESS">{platformLabel.GOOGLE_BUSINESS}</option>
              <option value="INSTAGRAM">{platformLabel.INSTAGRAM}</option>
              <option value="FACEBOOK">{platformLabel.FACEBOOK}</option>
              <option value="TIKTOK">{platformLabel.TIKTOK}</option>
            </select>
          </div>
        </div>

            <div className="flex-1 overflow-y-auto">
              {isLoading && <div className="p-4 text-sm text-gray-500 dark:text-gray-400">読み込み中...</div>}
              {!isLoading && filteredMessages.length === 0 && (
                <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
                  {selectedStoreIds.length > 0 ? '条件に一致するメッセージがありません。' : '右上の店舗セレクタで店舗を選択してください。'}
                </div>
              )}
          {filteredMessages.map((message) => (
            <div
              key={message.id}
              data-testid="inbox-message-item"
              data-message-id={message.id}
              data-platform={message.platform}
              data-replied={message.isReplied ? '1' : '0'}
              onClick={() => setSelectedMessageId(message.id)}
              className={`p-4 border-b border-gray-100 dark:border-gray-700 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                selectedMessageId === message.id
                  ? 'bg-indigo-50 dark:bg-indigo-900/30 border-l-4 border-l-indigo-600'
                  : 'border-l-4 border-l-transparent bg-white dark:bg-gray-800'
              }`}
            >
              <div className="flex justify-between items-start mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <input
                    type="checkbox"
                    checked={selectedMessageIds.includes(message.id)}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      event.stopPropagation();
                      toggleMessageSelection(message.id);
                    }}
                    className="h-4 w-4"
                  />
                  {message.platform === 'TIKTOK' ? (
                    <div className="w-2 h-2 rounded-full bg-slate-500" />
                  ) : (
                    <SocialPlatformLogo platform={message.platform as 'INSTAGRAM' | 'FACEBOOK' | 'GOOGLE_BUSINESS'} size={13} />
                  )}
                  <span className="font-semibold text-sm text-gray-900 dark:text-white">{message.senderName}</span>
                  {message.reaction && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200">
                      {getReactionLabel(message, message.reaction)}
                    </span>
                  )}
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400">{formatMessageDate(message.receivedAt)}</span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2 mb-2">{message.content}</p>
              <div className="flex justify-between items-center gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wider">{platformLabel[message.platform]}</span>
                  {message.channel === 'DM' && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100">DM</span>
                  )}
                  {(message.mediaAttachments || []).length > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-200 inline-flex items-center gap-1">
                      <Paperclip size={10} />
                      {(message.mediaAttachments || []).length}
                    </span>
                  )}
                </div>
                {message.isReplied && (
                  <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                    <MessageCircle size={10} />
                    返信済
                  </span>
                )}
                {!message.isReplied && isDraftPendingApproval(message) && (
                  <span className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1">
                    <Sparkles size={10} />
                    承認前保留
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1 mt-2">
                {message.slaStatus && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${slaBadgeClass[message.slaStatus]}`}>
                    {slaLabel[message.slaStatus]}
                  </span>
                )}
                {message.assignedUserName && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100">
                    担当: {message.assignedUserName}
                  </span>
                )}
                {(message.tags || []).slice(0, 2).map((tag) => (
                  <span
                    key={`${message.id}-${tag}`}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200"
                  >
                    #{tag}
                  </span>
                ))}
                {(message.tags || []).length > 2 && (
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">+{(message.tags || []).length - 2}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-white dark:bg-gray-800">
        {selectedMessage ? (
          <>
            <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <SenderAvatar message={selectedMessage} sizeClass="w-12 h-12" />
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">{selectedMessage.senderName}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    <span className="inline-flex items-center gap-1.5 align-middle">
                      {selectedMessage.platform === 'TIKTOK' ? (
                        <span className="w-2 h-2 rounded-full bg-slate-500 inline-block" />
                      ) : (
                        <SocialPlatformLogo platform={selectedMessage.platform as 'INSTAGRAM' | 'FACEBOOK' | 'GOOGLE_BUSINESS'} size={13} />
                      )}
                      {platformLabel[selectedMessage.platform]}
                    </span>
                    <span className="mx-1">•</span>
                    {formatDetailDate(selectedMessage.receivedAt)}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 justify-end">
                {selectedMessage.channel === 'DM' && (
                  <span className="bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-100 px-3 py-1 rounded-full text-xs font-bold">
                    DM
                  </span>
                )}
                {selectedMessage.source === 'REMOTE_CACHE' && (
                  <span className="bg-violet-100 dark:bg-violet-900/30 text-violet-800 dark:text-violet-200 px-3 py-1 rounded-full text-xs font-bold">
                    キャッシュ表示
                  </span>
                )}
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${slaBadgeClass[selectedMessage.slaStatus || 'ON_TRACK']}`}>
                  対応期限: {slaLabel[selectedMessage.slaStatus || 'ON_TRACK']}
                </span>
                {selectedMessage.isReplied && (
                  <span className="bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 px-3 py-1 rounded-full text-xs font-bold">
                    返信完了
                  </span>
                )}
                {!selectedMessage.isReplied && isDraftPendingApproval(selectedMessage) && (
                  <span className="bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 px-3 py-1 rounded-full text-xs font-bold">
                    承認前保留
                  </span>
                )}
                {selectedMessage.reaction && (
                  <span className="bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-200 px-3 py-1 rounded-full text-xs font-bold">
                    リアクション: {getReactionLabel(selectedMessage, selectedMessage.reaction)}
                  </span>
                )}
              </div>
            </div>

            <div className="flex-1 p-6 overflow-y-auto bg-gray-50 dark:bg-gray-900 space-y-6">
              {selectedMessage.source === 'REMOTE_CACHE' && (
                <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-xs text-violet-800 dark:border-violet-800 dark:bg-violet-900/20 dark:text-violet-200">
                  このメッセージはローカルキャッシュ表示です。画像/動画はDBに保存されません。
                  {canReplyRemoteMessage
                    ? ' このまま返信送信できます。'
                    : ' この連携先の返信送信は準備中です。'}
                </div>
              )}
              <div
                id="inbox-workflow-panel"
                className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm"
              >
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h4 className="text-sm font-bold text-gray-800 dark:text-white">ワークフロー管理</h4>
                  <span className={`text-xs px-2 py-1 rounded-full ${slaBadgeClass[previewSlaStatus]}`}>
                    {slaLabel[previewSlaStatus]}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-600 dark:text-gray-300 mb-1 block">担当者</label>
                    <div className="relative">
                      <UserRoundCheck className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
                      <select
                        data-testid="inbox-workflow-assignee"
                        value={workflowAssignedUserId}
                        onChange={(e) => setWorkflowAssignedUserId(e.target.value)}
                        className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white"
                      >
                        <option value="">未割当</option>
                        {assignableUsers.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.name} ({user.role})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 dark:text-gray-300 mb-1 block">対応期限</label>
                    <div className="relative">
                      <CalendarClock className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
                      <input
                        data-testid="inbox-workflow-due-at"
                        type="datetime-local"
                        value={workflowDueAtInput}
                        onChange={(e) => setWorkflowDueAtInput(e.target.value)}
                        className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-3">
                  <label className="text-xs text-gray-600 dark:text-gray-300 mb-1 block">タグ（カンマ区切り、最大10個）</label>
                  <div className="relative">
                    <Tag className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
                    <input
                      data-testid="inbox-workflow-tags"
                      type="text"
                      value={workflowTagsInput}
                      onChange={(e) => setWorkflowTagsInput(e.target.value)}
                      placeholder="要返信, クレーム, VIP"
                      className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                </div>
                <div className="mt-3 flex justify-between items-center">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {isAssignableLoading ? '担当者候補を読み込み中...' : '保存すると一覧と期限表示に反映されます。'}
                  </p>
                  <button
                    data-testid="inbox-workflow-save"
                    type="button"
                    onClick={handleSaveWorkflow}
                    disabled={isWorkflowSaving || isSubmitting || isGeneratingDraft}
                    className="inline-flex items-center gap-2 bg-indigo-600 text-white px-3 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    {isWorkflowSaving ? <Loader2 size={14} className="animate-spin" /> : null}
                    ワークフローを保存
                  </button>
                </div>
              </div>

              <div className="flex gap-4">
                <SenderAvatar message={selectedMessage} sizeClass="w-8 h-8 mt-1" />
                <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl rounded-tl-none shadow-sm border border-gray-100 dark:border-gray-700 max-w-[80%]">
                  <p className="text-gray-800 dark:text-white leading-relaxed">{selectedMessage.content}</p>
                </div>
              </div>

              {(selectedMessage.mediaAttachments || []).length > 0 && (
                <div className="ml-12 rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 p-4 space-y-3 max-w-[85%]">
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 inline-flex items-center gap-2">
                    <Paperclip size={12} />
                    添付メディア
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {(selectedMessage.mediaAttachments || []).map((attachment, index) => (
                      <a
                        key={`${selectedMessage.id}-media-${index}`}
                        href={attachment.url}
                        target="_blank"
                        rel="noreferrer"
                        className="group block rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-gray-50 dark:bg-gray-900"
                      >
                        {attachment.type === 'VIDEO' ? (
                          <div className="relative">
                            <video
                              src={attachment.url}
                              controls
                              className="w-full h-44 object-cover bg-black"
                              poster={attachment.thumbnailUrl}
                            />
                            <span className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-black/60 text-white">
                              <Video size={10} />
                              動画
                            </span>
                          </div>
                        ) : (
                          <div className="relative">
                            <img
                              src={attachment.url}
                              alt="受信メディア"
                              className="w-full h-44 object-cover"
                            />
                            <span className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-black/60 text-white">
                              <ImageIcon size={10} />
                              画像
                            </span>
                          </div>
                        )}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {selectedMessageSupportedReactions.length > 0 && (
                <div className="ml-12 rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 p-4 max-w-[85%]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-gray-500 dark:text-gray-400">リアクション:</span>
                    {selectedMessageSupportedReactions.map((reactionType) => {
                      const option = REACTION_OPTIONS.find((item) => item.type === reactionType);
                      if (!option) return null;
                      const isActive = selectedMessage.reaction === reactionType;
                      return (
                        <button
                          key={reactionType}
                          type="button"
                          onClick={() => void handleApplyReaction(selectedMessage, reactionType)}
                          disabled={isApplyingReaction || isBulkApplyingReaction || isMultiStoreSelected || !activeStoreId}
                          title={
                            isMultiStoreSelected
                              ? '複数店舗選択中はリアクションを送信できません。店舗を1つだけ選択してください。'
                              : !activeStoreId
                                ? '先に店舗を選択してください。'
                                : undefined
                          }
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                            isActive
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-indigo-50 hover:border-indigo-200 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-indigo-900/30'
                          }`}
                        >
                          {reactionType === 'LIKE' ? <ThumbsUp size={12} /> : <Smile size={12} />}
                          <span>{option.emoji} {option.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                    リアクションは実際のSNSへ送信します。利用できる種類はSNS仕様により異なります。
                  </p>
                </div>
              )}

              {!selectedMessage.isReplied && isDraftPendingApproval(selectedMessage) && (
                <div className="flex gap-4 flex-row-reverse">
                  <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-white text-[10px] font-bold mt-1">AI</div>
                  <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-2xl rounded-tr-none shadow-sm border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-100 max-w-[80%]">
                    <p className="text-[11px] uppercase tracking-wide mb-1 text-amber-700 dark:text-amber-300">AI返信案（承認前）</p>
                    <p className="leading-relaxed">{selectedMessage.replyDraftContent}</p>
                  </div>
                </div>
              )}

              {selectedMessage.isReplied && selectedMessage.replyContent && (
                <div className="flex gap-4 flex-row-reverse">
                  <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold mt-1">Me</div>
                  <div className="bg-indigo-600 p-4 rounded-2xl rounded-tr-none shadow-sm text-white max-w-[80%]">
                    <p className="leading-relaxed">{selectedMessage.replyContent}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              {selectedMessage.isReplied ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">このメッセージは返信済みです。</p>
              ) : (
                <form id="inbox-reply-form" onSubmit={handleReply} className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <p className="text-xs text-gray-500 dark:text-gray-400">AI返信案は送信前に編集できます。</p>
                  <button
                    data-testid="inbox-generate-draft"
                    type="button"
                    onClick={handleGenerateReplyDraft}
                    disabled={isGeneratingDraft || isSubmitting || isWorkflowSaving || isMultiStoreSelected}
                    className="inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-700 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                      {isGeneratingDraft ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      {isGeneratingDraft ? '生成中...' : isDraftPendingApproval(selectedMessage) ? 'AI返信案を再生成' : 'AI返信案を作成'}
                    </button>
                  </div>
                  <textarea
                    id="inbox-reply-text"
                    data-testid="inbox-reply-text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder={`${selectedMessage.senderName} さんへ返信...`}
                    disabled={isSubmitting || isGeneratingDraft || isWorkflowSaving || isMultiStoreSelected}
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-xl p-4 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none min-h-[110px]"
                  />
                  <div className="flex justify-end">
                    <button
                      data-testid="inbox-send-reply"
                      type="submit"
                      disabled={
                        !replyText.trim() ||
                        isSubmitting ||
                        isGeneratingDraft ||
                        isWorkflowSaving ||
                        isMultiStoreSelected ||
                        (selectedMessage.source === 'REMOTE_CACHE' && !canReplyRemoteMessage)
                      }
                      className="inline-flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <Send size={16} />
                      <span>{isDraftPendingApproval(selectedMessage) ? '承認して送信' : '返信を送信'}</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 dark:text-gray-500">
            <MessageCircle size={48} className="mb-4 opacity-20" />
            <p>
              {isSupabaseConfigured && selectedStoreIds.length === 0
                ? '右上の店舗セレクタで店舗を選択してください。'
                : 'メッセージを選択して会話を開始します'}
            </p>
          </div>
        )}
      </div>
    </div>
    </div>
  );
};
