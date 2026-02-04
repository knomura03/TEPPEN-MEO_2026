import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Store } from '../types';
import { storesService } from '../services/storesService';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { useNotification } from './NotificationContext';
import { getErrorMessage } from '../services/errorMessage';

type StoreContextType = {
  stores: Store[];
  activeStoreId: string | null;
  setActiveStoreId: (storeId: string) => void;
  isLoadingStores: boolean;
  storesError: string | null;
  reloadStores: () => Promise<void>;
};

const StoreContext = createContext<StoreContextType | undefined>(undefined);

const ACTIVE_STORE_KEY = 'teppen_meo_active_store_id';

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { addNotification } = useNotification();
  const [stores, setStores] = useState<Store[]>([]);
  const [activeStoreId, setActiveStoreIdState] = useState<string | null>(null);
  const [isLoadingStores, setIsLoadingStores] = useState(false);
  const [storesError, setStoresError] = useState<string | null>(null);
  const lastNotifiedErrorRef = useRef<string | null>(null);

  const setActiveStoreId = (storeId: string) => {
    setActiveStoreIdState(storeId);
    localStorage.setItem(ACTIVE_STORE_KEY, storeId);
  };

  const reloadStores = async () => {
    if (!isSupabaseConfigured) return;
    setIsLoadingStores(true);
    setStoresError(null);
    try {
      const nextStores = await storesService.listAccessible();
      setStores(nextStores);

      const stored = localStorage.getItem(ACTIVE_STORE_KEY);
      if (stored && nextStores.some((s) => s.id === stored)) {
        setActiveStoreIdState(stored);
        return;
      }

      if (nextStores.length > 0) {
        setActiveStoreId(nextStores[0].id);
      } else {
        setActiveStoreIdState(null);
      }
    } catch (error) {
      const message = getErrorMessage(error) || 'unknown error';
      setStores([]);
      setActiveStoreIdState(null);
      setStoresError(message);
      if (lastNotifiedErrorRef.current !== message) {
        lastNotifiedErrorRef.current = message;
        console.error('[StoreContext] Failed to load stores:', error);
        addNotification('読み込みエラー', `店舗一覧の取得に失敗しました。（${message}）`, 'ERROR');
      }
    } finally {
      setIsLoadingStores(false);
    }
  };

  useEffect(() => {
    void reloadStores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<StoreContextType>(
    () => ({
      stores,
      activeStoreId,
      setActiveStoreId,
      isLoadingStores,
      storesError,
      reloadStores,
    }),
    [stores, activeStoreId, isLoadingStores, storesError]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
};

export const useStore = (): StoreContextType => {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within a StoreProvider');
  return ctx;
};
