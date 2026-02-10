import React, { useEffect, useMemo, useState } from 'react';
import { MOCK_MESSAGES } from '../constants';
import { InboxAssignableUser, InboxMessage, InboxSlaStatus, SocialPlatform, User } from '../types';
import { CalendarClock, Loader2, MessageCircle, Search, Send, Sparkles, Tag, UserRoundCheck } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { inboxService } from '../services/inboxService';
import { geminiService } from '../services/geminiService';
import { useStore } from '../contexts/StoreContext';
import { messageReplyService } from '../services/messageReplyService';
import { getErrorMessage } from '../services/errorMessage';
import { PAGE_CONTAINER_CLASS, PAGE_HEADER_DESCRIPTION_CLASS, PAGE_HEADER_TITLE_CLASS } from './ui/pageLayout';

const platformLabel: Record<SocialPlatform, string> = {
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  GOOGLE_BUSINESS: 'Google Business Profile',
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

interface UnifiedInboxProps {
  currentUser: User;
}

export const UnifiedInbox: React.FC<UnifiedInboxProps> = ({ currentUser }) => {
  const { addNotification } = useNotification();
  const { activeStoreId } = useStore();

  const [messages, setMessages] = useState<InboxMessage[]>(MOCK_MESSAGES);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<InboxStatusFilter>('ALL');
  const [platformFilter, setPlatformFilter] = useState<'ALL' | SocialPlatform>('ALL');
  const [assignableUsers, setAssignableUsers] = useState<InboxAssignableUser[]>([]);
  const [workflowTagsInput, setWorkflowTagsInput] = useState('');
  const [workflowAssignedUserId, setWorkflowAssignedUserId] = useState('');
  const [workflowDueAtInput, setWorkflowDueAtInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [isWorkflowSaving, setIsWorkflowSaving] = useState(false);
  const [isAssignableLoading, setIsAssignableLoading] = useState(false);

  const selectedMessage = useMemo(
    () => messages.find((message) => message.id === selectedMessageId) || null,
    [messages, selectedMessageId]
  );

  const patchMessage = (messageId: string, patch: Partial<InboxMessage>) => {
    setMessages((prev) => prev.map((message) => (message.id === messageId ? { ...message, ...patch } : message)));
  };

  const reloadMessages = async () => {
    if (!isSupabaseConfigured) {
      setMessages(MOCK_MESSAGES);
      if (!selectedMessageId && MOCK_MESSAGES.length > 0) {
        setSelectedMessageId(MOCK_MESSAGES[0].id);
      }
      return;
    }
    if (!activeStoreId) {
      setMessages([]);
      return;
    }

    setIsLoading(true);
    try {
      const data = await inboxService.listByStore(activeStoreId);
      setMessages(data);
      if (data.length > 0 && !data.find((message) => message.id === selectedMessageId)) {
        setSelectedMessageId(data[0].id);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStoreId]);

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
  }, [messages, searchText, platformFilter, statusFilter]);

  useEffect(() => {
    if (filteredMessages.length === 0) {
      setSelectedMessageId(null);
      return;
    }
    if (!selectedMessageId || !filteredMessages.some((message) => message.id === selectedMessageId)) {
      setSelectedMessageId(filteredMessages[0].id);
    }
  }, [filteredMessages, selectedMessageId]);

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

      if (isSupabaseConfigured) {
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
      if (selectedMessage.platform === 'FACEBOOK') {
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
      if (!isSupabaseConfigured) {
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

  const previewDueAt = parseDateTimeLocal(workflowDueAtInput);
  const previewSlaStatus = selectedMessage
    ? deriveSlaStatus(selectedMessage.isReplied, previewDueAt)
    : 'ON_TRACK';

  const PlatformIcon = ({ platform }: { platform: SocialPlatform }) => {
    switch (platform) {
      case 'INSTAGRAM':
        return <div className="w-2 h-2 rounded-full bg-pink-500" />;
      case 'FACEBOOK':
        return <div className="w-2 h-2 rounded-full bg-blue-600" />;
      case 'GOOGLE_BUSINESS':
        return <div className="w-2 h-2 rounded-full bg-blue-400" />;
      case 'TIKTOK':
        return <div className="w-2 h-2 rounded-full bg-slate-500" />;
      default:
        return <div className="w-2 h-2 rounded-full bg-gray-400" />;
    }
  };

  return (
    <div className={PAGE_CONTAINER_CLASS}>
      <section>
        <h1 className={PAGE_HEADER_TITLE_CLASS}>受信箱</h1>
        <p className={PAGE_HEADER_DESCRIPTION_CLASS}>コメントやメッセージを確認し、担当・期限・返信を管理できます。</p>
      </section>

      <div className="h-[calc(100vh-220px)] flex flex-col md:flex-row bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="w-full md:w-1/3 border-r border-gray-200 dark:border-gray-700 flex flex-col bg-gray-50 dark:bg-gray-800">
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
              {activeStoreId ? '条件に一致するメッセージがありません。' : '右上の店舗セレクタで店舗を選択してください。'}
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
                <div className="flex items-center gap-2">
                  <PlatformIcon platform={message.platform} />
                  <span className="font-semibold text-sm text-gray-900 dark:text-white">{message.senderName}</span>
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400">{formatMessageDate(message.receivedAt)}</span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2 mb-2">{message.content}</p>
              <div className="flex justify-between items-center gap-2">
                <span className="text-[10px] text-gray-400 uppercase tracking-wider">{platformLabel[message.platform]}</span>
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
                <img
                  src={selectedMessage.senderAvatar || 'https://via.placeholder.com/40'}
                  className="w-12 h-12 rounded-full object-cover border border-gray-200 dark:border-gray-600"
                  alt="avatar"
                />
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">{selectedMessage.senderName}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    via {platformLabel[selectedMessage.platform]} • {formatDetailDate(selectedMessage.receivedAt)}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 justify-end">
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${slaBadgeClass[selectedMessage.slaStatus || 'ON_TRACK']}`}>
                  SLA: {slaLabel[selectedMessage.slaStatus || 'ON_TRACK']}
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
              </div>
            </div>

            <div className="flex-1 p-6 overflow-y-auto bg-gray-50 dark:bg-gray-900 space-y-6">
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
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
                    {isAssignableLoading ? '担当者候補を読み込み中...' : '保存すると一覧とSLA表示に反映されます。'}
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
                <img
                  src={selectedMessage.senderAvatar || 'https://via.placeholder.com/40'}
                  className="w-8 h-8 rounded-full object-cover mt-1"
                  alt="avatar"
                />
                <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl rounded-tl-none shadow-sm border border-gray-100 dark:border-gray-700 max-w-[80%]">
                  <p className="text-gray-800 dark:text-white leading-relaxed">{selectedMessage.content}</p>
                </div>
              </div>

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
                <form onSubmit={handleReply} className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <p className="text-xs text-gray-500 dark:text-gray-400">AI返信案は送信前に編集できます。</p>
                    <button
                      data-testid="inbox-generate-draft"
                      type="button"
                      onClick={handleGenerateReplyDraft}
                      disabled={isGeneratingDraft || isSubmitting || isWorkflowSaving}
                      className="inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-700 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isGeneratingDraft ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      {isGeneratingDraft ? '生成中...' : isDraftPendingApproval(selectedMessage) ? 'AI返信案を再生成' : 'AI返信案を作成'}
                    </button>
                  </div>
                  <textarea
                    data-testid="inbox-reply-text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder={`${selectedMessage.senderName} さんへ返信...`}
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-xl p-4 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none min-h-[110px]"
                  />
                  <div className="flex justify-end">
                    <button
                      data-testid="inbox-send-reply"
                      type="submit"
                      disabled={!replyText.trim() || isSubmitting || isGeneratingDraft || isWorkflowSaving}
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
              {isSupabaseConfigured && !activeStoreId
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
