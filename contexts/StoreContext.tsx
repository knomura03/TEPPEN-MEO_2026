import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Store } from '../types';
import { storesService } from '../services/storesService';
import { isSupabaseConfigured } from '../services/supabaseClient';

type StoreContextType = {
  stores: Store[];
  activeStoreId: string | null;
  setActiveStoreId: (storeId: string) => void;
  isLoadingStores: boolean;
  reloadStores: () => Promise<void>;
};

const StoreContext = createContext<StoreContextType | undefined>(undefined);

const ACTIVE_STORE_KEY = 'teppen_meo_active_store_id';

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [stores, setStores] = useState<Store[]>([]);
  const [activeStoreId, setActiveStoreIdState] = useState<string | null>(null);
  const [isLoadingStores, setIsLoadingStores] = useState(false);

  const setActiveStoreId = (storeId: string) => {
    setActiveStoreIdState(storeId);
    localStorage.setItem(ACTIVE_STORE_KEY, storeId);
  };

  const reloadStores = async () => {
    if (!isSupabaseConfigured) return;
    setIsLoadingStores(true);
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
      reloadStores,
    }),
    [stores, activeStoreId, isLoadingStores]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
};

export const useStore = (): StoreContextType => {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within a StoreProvider');
  return ctx;
};

