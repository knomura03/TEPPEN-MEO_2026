import React, { useEffect, useState } from 'react';
import { MOCK_MESSAGES } from '../constants';
import { InboxMessage } from '../types';
import { Search, Filter, Send, MessageCircle } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { inboxService } from '../services/inboxService';
import { useStore } from '../contexts/StoreContext';

const formatMessageDate = (date: Date) => {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const h = ('0' + date.getHours()).slice(-2);
  const min = ('0' + date.getMinutes()).slice(-2);
  return `${m}/${d} ${h}:${min}`;
};

const formatDetailDate = (date: Date) => {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const h = ('0' + date.getHours()).slice(-2);
  const min = ('0' + date.getMinutes()).slice(-2);
  return `${y}年${m}月${d}日 ${h}:${min}`;
};

export const UnifiedInbox: React.FC = () => {
  const { addNotification } = useNotification();
  const { activeStoreId } = useStore();
  const [messages, setMessages] = useState<InboxMessage[]>(MOCK_MESSAGES);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedMessage = messages.find(m => m.id === selectedMessageId);

  const reload = async () => {
    if (!isSupabaseConfigured) {
      setMessages(MOCK_MESSAGES);
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
      if (data.length > 0 && !data.find((m) => m.id === selectedMessageId)) {
        setSelectedMessageId(data[0].id);
      }
    } catch {
      addNotification('読み込みエラー', '受信箱の取得に失敗しました。', 'ERROR');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStoreId]);

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMessage || !replyText.trim()) return;

    if (!isSupabaseConfigured) {
      const updatedMessages = messages.map(msg => 
        msg.id === selectedMessage.id 
          ? { ...msg, isReplied: true, replyContent: replyText } 
          : msg
      );
      setMessages(updatedMessages);
      addNotification('返信送信完了', `${selectedMessage.senderName} さんへ返信しました`, 'SUCCESS');
      setReplyText('');
      return;
    }

    setIsSubmitting(true);
    try {
      await inboxService.replyToMessage(selectedMessage.id, replyText.trim());
      const updatedMessages = messages.map(msg => 
        msg.id === selectedMessage.id 
          ? { ...msg, isReplied: true, replyContent: replyText } 
          : msg
      );
      setMessages(updatedMessages);
      addNotification('返信送信完了', `${selectedMessage.senderName} さんへ返信しました`, 'SUCCESS');
      setReplyText('');
    } catch {
      addNotification('返信エラー', '返信の保存に失敗しました。', 'ERROR');
    } finally {
      setIsSubmitting(false);
    }
  };

  const PlatformIcon = ({ platform }: { platform: string }) => {
    switch(platform) {
      case 'INSTAGRAM': return <div className="w-2 h-2 rounded-full bg-pink-500" />;
      case 'FACEBOOK': return <div className="w-2 h-2 rounded-full bg-blue-600" />;
      case 'GOOGLE_BUSINESS': return <div className="w-2 h-2 rounded-full bg-blue-400" />;
      default: return <div className="w-2 h-2 rounded-full bg-gray-400" />;
    }
  };

  return (
    <div className="h-[calc(100vh-100px)] flex flex-col md:flex-row bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Sidebar List */}
      <div className="w-full md:w-1/3 border-r border-gray-200 dark:border-gray-700 flex flex-col bg-gray-50 dark:bg-gray-800">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <h2 className="text-lg font-bold text-gray-800 dark:text-white mb-3">受信箱</h2>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-gray-400 h-4 w-4" />
            <input 
              type="text" 
              placeholder="メッセージを検索..." 
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
             <button className="px-3 py-1 text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300 rounded-full whitespace-nowrap">すべて</button>
             <button className="px-3 py-1 text-xs font-medium bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-full whitespace-nowrap">未返信</button>
             <button className="px-3 py-1 text-xs font-medium bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-full whitespace-nowrap">Instagram</button>
             <button className="px-3 py-1 text-xs font-medium bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-full whitespace-nowrap">GBP</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="p-4 text-sm text-gray-500 dark:text-gray-400">読み込み中...</div>
          )}
          {messages.map(message => (
            <div 
              key={message.id}
              onClick={() => setSelectedMessageId(message.id)}
              className={`p-4 border-b border-gray-100 dark:border-gray-700 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                selectedMessageId === message.id ? 'bg-indigo-50 dark:bg-indigo-900/30 border-l-4 border-l-indigo-600' : 'border-l-4 border-l-transparent bg-white dark:bg-gray-800'
              }`}
            >
              <div className="flex justify-between items-start mb-1">
                <div className="flex items-center gap-2">
                  <PlatformIcon platform={message.platform} />
                  <span className="font-semibold text-sm text-gray-900 dark:text-white">{message.senderName}</span>
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {formatMessageDate(message.receivedAt)}
                </span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2 mb-2">{message.content}</p>
              <div className="flex justify-between items-center">
                 <span className="text-[10px] text-gray-400 uppercase tracking-wider">{message.platform}</span>
                 {message.isReplied && <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1"><MessageCircle size={10}/> 返信済</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col bg-white dark:bg-gray-800">
        {selectedMessage ? (
          <>
            {/* Header */}
            <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <img 
                  src={selectedMessage.senderAvatar || 'https://via.placeholder.com/40'} 
                  className="w-12 h-12 rounded-full object-cover border border-gray-200 dark:border-gray-600" 
                  alt="avatar" 
                />
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">{selectedMessage.senderName}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                     via {selectedMessage.platform} • {formatDetailDate(selectedMessage.receivedAt)}
                  </p>
                </div>
              </div>
              {selectedMessage.isReplied && (
                 <span className="bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 px-3 py-1 rounded-full text-xs font-bold">完了</span>
              )}
            </div>

            {/* Message Body */}
            <div className="flex-1 p-6 overflow-y-auto bg-gray-50 dark:bg-gray-900 space-y-6">
              {/* User Message */}
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

              {/* Reply if exists */}
              {selectedMessage.isReplied && selectedMessage.replyContent && (
                 <div className="flex gap-4 flex-row-reverse">
                    <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold mt-1">Me</div>
                    <div className="bg-indigo-600 p-4 rounded-2xl rounded-tr-none shadow-sm text-white max-w-[80%]">
                        <p className="leading-relaxed">{selectedMessage.replyContent}</p>
                    </div>
                 </div>
              )}
            </div>

            {/* Reply Input */}
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              <form onSubmit={handleReply} className="relative">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={`${selectedMessage.senderName} さんへ返信...`}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-xl p-4 pr-12 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none min-h-[100px]"
                />
                <button 
                  type="submit"
                  disabled={!replyText.trim() || isSubmitting}
                  className="absolute bottom-4 right-4 bg-indigo-600 text-white p-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Send size={18} />
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 dark:text-gray-500">
            <MessageCircle size={48} className="mb-4 opacity-20" />
            <p>メッセージを選択して会話を開始します</p>
          </div>
        )}
      </div>
    </div>
  );
};
