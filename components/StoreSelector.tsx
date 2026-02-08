import React from 'react';
import { useStore } from '../contexts/StoreContext';
import { isSupabaseConfigured } from '../services/supabaseClient';

export const StoreSelector: React.FC = () => {
  const { stores, activeStoreId, setActiveStoreId, isLoadingStores, storesError, reloadStores } = useStore();

  if (!isSupabaseConfigured) {
    return (
      <div
        className="px-3 py-2 text-sm bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-full text-red-700 dark:text-red-200"
        title="Supabase未接続です。VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を設定してください。"
      >
        Supabase未設定
      </div>
    );
  }

  if (isLoadingStores) {
    return (
      <div className="px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full text-gray-500 dark:text-gray-400">
        店舗読み込み中...
      </div>
    );
  }

  if (stores.length === 0) {
    return (
      <button
        type="button"
        onClick={() => void reloadStores()}
        className={`px-3 py-2 text-sm rounded-full border transition-colors ${
          storesError
            ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-200'
            : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-200'
        }`}
        title={storesError ? storesError : 'クリックで再読み込み'}
      >
        {storesError ? '店舗取得エラー' : '店舗が未設定'}
      </button>
    );
  }

  return (
    <select
      data-testid="store-selector"
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
