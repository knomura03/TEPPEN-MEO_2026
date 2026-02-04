import React from 'react';
import { useStore } from '../contexts/StoreContext';
import { isSupabaseConfigured } from '../services/supabaseClient';

export const StoreSelector: React.FC = () => {
  const { stores, activeStoreId, setActiveStoreId, isLoadingStores } = useStore();

  if (!isSupabaseConfigured) return null;

  if (isLoadingStores) {
    return (
      <div className="px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full text-gray-500 dark:text-gray-400">
        店舗読み込み中...
      </div>
    );
  }

  if (stores.length === 0) {
    return (
      <div className="px-3 py-2 text-sm bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-full text-yellow-800 dark:text-yellow-200">
        店舗が未設定
      </div>
    );
  }

  return (
    <select
      value={activeStoreId || ''}
      onChange={(e) => setActiveStoreId(e.target.value)}
      className="px-4 py-2 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full focus:ring-2 focus:ring-primary-500 outline-none transition-all text-gray-700 dark:text-gray-200"
    >
      {stores.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
};

