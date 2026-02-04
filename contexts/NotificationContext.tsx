import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { AppNotification, NotificationType } from '../types';

interface NotificationContextType {
  notifications: AppNotification[];
  unreadCount: number;
  addNotification: (title: string, message: string, type?: NotificationType) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
  removeToast: (id: string) => void;
  activeToasts: AppNotification[];
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [activeToasts, setActiveToasts] = useState<AppNotification[]>([]);

  const addNotification = useCallback((title: string, message: string, type: NotificationType = 'INFO') => {
    const newNotification: AppNotification = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      type,
      title,
      message,
      timestamp: new Date(),
      isRead: false,
    };

    setNotifications(prev => [newNotification, ...prev]);
    setActiveToasts(prev => [...prev, newNotification]);

    // ブラウザ通知 (Permission check)
    if (!('Notification' in window)) {
      console.log('This browser does not support desktop notification');
    } else if (Notification.permission === 'granted') {
      new Notification(title, { body: message });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          new Notification(title, { body: message });
        }
      });
    }

    // トースト自動消去
    setTimeout(() => {
      removeToast(newNotification.id);
    }, 5000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setActiveToasts(prev => prev.filter(n => n.id !== id));
  }, []);

  const markAsRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <NotificationContext.Provider value={{
      notifications,
      unreadCount,
      addNotification,
      markAsRead,
      markAllAsRead,
      clearAll,
      removeToast,
      activeToasts
    }}>
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return context;
};