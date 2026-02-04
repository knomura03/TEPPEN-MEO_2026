import React, { useState, useRef, useEffect } from 'react';
import { useNotification } from '../contexts/NotificationContext';
import { Bell, Check, Trash2, X } from 'lucide-react';
import { NotificationType } from '../types';

const formatTime = (date: Date) => {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return '今';
  if (minutes < 60) return `${minutes}分前`;
  if (hours < 24) return `${hours}時間前`;
  return `${days}日前`;
};

export const NotificationCenter: React.FC = () => {
  const { notifications, unreadCount, markAsRead, markAllAsRead, clearAll } = useNotification();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getIconColor = (type: NotificationType) => {
    switch (type) {
      case 'SUCCESS': return 'bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-300';
      case 'ERROR': return 'bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-300';
      case 'WARNING': return 'bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-300';
      default: return 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300';
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        title="通知"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-red-500 border-2 border-white dark:border-gray-800 rounded-full"></span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 md:w-96 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 overflow-hidden z-50 animate-fade-in origin-top-right">
          <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gray-50/50 dark:bg-gray-900/50">
            <h3 className="font-bold text-gray-800 dark:text-white">通知</h3>
            <div className="flex gap-2">
              {unreadCount > 0 && (
                <button 
                  onClick={markAllAsRead}
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                >
                  <Check size={12} /> すべて既読
                </button>
              )}
              {notifications.length > 0 && (
                <button 
                  onClick={clearAll}
                  className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 flex items-center gap-1"
                  title="すべて削除"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                <Bell size={32} className="mx-auto mb-2 opacity-20" />
                <p className="text-sm">新しい通知はありません</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-gray-700">
                {notifications.map(notification => (
                  <div 
                    key={notification.id}
                    onClick={() => markAsRead(notification.id)}
                    className={`p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer ${
                      !notification.isRead ? 'bg-indigo-50/50 dark:bg-indigo-900/10' : ''
                    }`}
                  >
                    <div className="flex gap-3">
                      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${getIconColor(notification.type)}`}>
                        {notification.type === 'SUCCESS' ? '✓' : notification.type === 'ERROR' ? '!' : 'i'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start mb-1">
                          <p className={`text-sm font-medium ${!notification.isRead ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300'}`}>
                            {notification.title}
                          </p>
                          <span className="text-xs text-gray-400 whitespace-nowrap ml-2">
                            {formatTime(notification.timestamp)}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                          {notification.message}
                        </p>
                      </div>
                      {!notification.isRead && (
                        <div className="flex-shrink-0 mt-1">
                          <div className="w-2 h-2 bg-indigo-500 rounded-full"></div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};