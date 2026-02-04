import React from 'react';
import { useNotification } from '../contexts/NotificationContext';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { NotificationType } from '../types';

export const ToastContainer: React.FC = () => {
  const { activeToasts, removeToast } = useNotification();

  const getIcon = (type: NotificationType) => {
    switch (type) {
      case 'SUCCESS': return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'ERROR': return <AlertCircle className="w-5 h-5 text-red-500" />;
      case 'WARNING': return <AlertTriangle className="w-5 h-5 text-orange-500" />;
      default: return <Info className="w-5 h-5 text-blue-500" />;
    }
  };

  const getBorderColor = (type: NotificationType) => {
    switch (type) {
      case 'SUCCESS': return 'border-green-500';
      case 'ERROR': return 'border-red-500';
      case 'WARNING': return 'border-orange-500';
      default: return 'border-blue-500';
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-3 pointer-events-none">
      {activeToasts.map(toast => (
        <div
          key={toast.id}
          className={`
            pointer-events-auto
            flex items-start gap-3 p-4 
            bg-white dark:bg-gray-800 
            shadow-lg rounded-lg border-l-4 
            ${getBorderColor(toast.type)}
            transform transition-all duration-300 animate-slide-in
            min-w-[300px] max-w-sm
          `}
        >
          <div className="flex-shrink-0 mt-0.5">
            {getIcon(toast.type)}
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
              {toast.title}
            </h4>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {toast.message}
            </p>
          </div>
          <button
            onClick={() => removeToast(toast.id)}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
};