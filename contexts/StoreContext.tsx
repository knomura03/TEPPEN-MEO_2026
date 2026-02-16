import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ManagementUnit, Role, Store, User } from '../types';
import { storesService } from '../services/storesService';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { useNotification } from './NotificationContext';
import { getErrorMessage } from '../services/errorMessage';
import { AccessibleGroup, groupService } from '../services/groupService';
import { managementUnitService } from '../services/managementUnitService';

type StoreContextType = {
  stores: Store[];
  accessibleGroups: AccessibleGroup[];
  managementUnits: ManagementUnit[];
  filteredGroups: AccessibleGroup[];
  filteredStores: Store[];
  selectedManagementUnitIds: string[];
  selectedOrgIds: string[];
  selectedStoreIds: string[];
  activeStoreId: string | null;
  setActiveStoreId: (storeId: string) => void;
  setSelectedManagementUnitIds: (ids: string[]) => void;
  setSelectedOrgIds: (ids: string[]) => void;
  setSelectedStoreIds: (ids: string[]) => void;
  selectAllManagementUnits: () => void;
  clearManagementUnits: () => void;
  selectAllGroups: () => void;
  clearGroups: () => void;
  selectAllStores: () => void;
  clearStores: () => void;
  isLoadingStores: boolean;
  storesError: string | null;
  reloadStores: () => Promise<void>;
};

const StoreContext = createContext<StoreContextType | undefined>(undefined);

const ACTIVE_STORE_KEY = 'teppen_meo_active_store_id';
const SCOPE_SELECTION_KEY_PREFIX = 'teppen_meo_scope_selection_v1:';
const AUDIT_STORE_PREFIX = '[AUDIT]';

const pickDefaultStore = (items: Store[]): Store | null => {
  if (items.length === 0) return null;
  const productionStore = items.find((store) => !store.name.trim().startsWith(AUDIT_STORE_PREFIX));
  return productionStore || items[0];
};

type ScopeSelection = {
  managementUnitIds: string[];
  orgIds: string[];
  storeIds: string[];
};

const loadStoredSelection = (userId: string): ScopeSelection | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${SCOPE_SELECTION_KEY_PREFIX}${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ScopeSelection>;
    return {
      managementUnitIds: Array.isArray(parsed.managementUnitIds) ? parsed.managementUnitIds.filter((id): id is string => typeof id === 'string') : [],
      orgIds: Array.isArray(parsed.orgIds) ? parsed.orgIds.filter((id): id is string => typeof id === 'string') : [],
      storeIds: Array.isArray(parsed.storeIds) ? parsed.storeIds.filter((id): id is string => typeof id === 'string') : [],
    };
  } catch {
    return null;
  }
};

const persistSelection = (userId: string, selection: ScopeSelection) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${SCOPE_SELECTION_KEY_PREFIX}${userId}`, JSON.stringify(selection));
  } catch {
    // ignore
  }
};

const normalizeUnique = (ids: string[]) => Array.from(new Set(ids.filter(Boolean)));

const reconcileSelection = (params: {
  selection: ScopeSelection;
  stores: Store[];
  groups: AccessibleGroup[];
  managementUnits: ManagementUnit[];
  isAdmin: boolean;
}): ScopeSelection => {
  const storeIdSet = new Set(params.stores.map((store) => store.id));
  const groupIdSet = new Set(params.groups.map((group) => group.id));
  const unitIdSet = new Set(params.managementUnits.map((unit) => unit.id));

  const allUnitIds = params.managementUnits.map((unit) => unit.id);
  const allGroupIds = params.groups.map((group) => group.id);

  let managementUnitIds = normalizeUnique(params.selection.managementUnitIds).filter((id) => unitIdSet.has(id));
  if (params.isAdmin && params.managementUnits.length > 0 && managementUnitIds.length === 0) {
    managementUnitIds = allUnitIds;
  }

  const filteredGroups = params.isAdmin && params.managementUnits.length > 0
    ? params.groups.filter((group) => {
      const unitId = group.managementUnitId;
      if (!unitId) return true;
      return managementUnitIds.includes(unitId);
    })
    : params.groups;
  const filteredGroupIdSet = new Set(filteredGroups.map((group) => group.id));
  const fallbackGroupIds = filteredGroups.map((group) => group.id);

  let orgIds = normalizeUnique(params.selection.orgIds).filter((id) => groupIdSet.has(id) && filteredGroupIdSet.has(id));
  if (params.groups.length > 0 && orgIds.length === 0) {
    orgIds = params.isAdmin && params.managementUnits.length > 0 ? fallbackGroupIds : allGroupIds;
  }

  const allowedOrgIdSet = new Set(orgIds.filter((id) => filteredGroupIdSet.has(id)));
  const filteredStores = params.stores.filter((store) => allowedOrgIdSet.has(store.orgId));
  const filteredStoreIdSet = new Set(filteredStores.map((store) => store.id));

  let storeIds = normalizeUnique(params.selection.storeIds).filter((id) => storeIdSet.has(id) && filteredStoreIdSet.has(id));
  if (params.stores.length > 0 && storeIds.length === 0) {
    const fallback = pickDefaultStore(filteredStores) || pickDefaultStore(params.stores);
    storeIds = fallback ? [fallback.id] : [];
  }

  return {
    managementUnitIds,
    orgIds,
    storeIds,
  };
};

export const StoreProvider: React.FC<{ children: React.ReactNode; currentUser: Pick<User, 'id' | 'role'> }> = ({ children, currentUser }) => {
  const { addNotification } = useNotification();
  const [stores, setStores] = useState<Store[]>([]);
  const [accessibleGroups, setAccessibleGroups] = useState<AccessibleGroup[]>([]);
  const [managementUnits, setManagementUnits] = useState<ManagementUnit[]>([]);
  const [selection, setSelection] = useState<ScopeSelection>(() => {
    const stored = loadStoredSelection(currentUser.id);
    return stored || { managementUnitIds: [], orgIds: [], storeIds: [] };
  });
  const [isLoadingStores, setIsLoadingStores] = useState(false);
  const [storesError, setStoresError] = useState<string | null>(null);
  const lastNotifiedErrorRef = useRef<string | null>(null);

  const isAdmin = currentUser.role === Role.ADMIN;

  const filteredGroups = useMemo(() => {
    if (!isAdmin || managementUnits.length === 0) return accessibleGroups;
    const unitSet = new Set(selection.managementUnitIds);
    return accessibleGroups.filter((group) => !group.managementUnitId || unitSet.has(group.managementUnitId));
  }, [accessibleGroups, isAdmin, managementUnits.length, selection.managementUnitIds]);

  const filteredStores = useMemo(() => {
    const orgSet = new Set(selection.orgIds);
    return stores.filter((store) => orgSet.has(store.orgId));
  }, [selection.orgIds, stores]);

  const selectedStoreIds = selection.storeIds;
  const activeStoreId = selectedStoreIds.length === 1 ? selectedStoreIds[0] : null;

  const persistActiveStoreLegacy = (storeId: string) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(ACTIVE_STORE_KEY, storeId);
    } catch {
      // ignore
    }
  };

  const setSelectionAndPersist = (next: ScopeSelection) => {
    setSelection(next);
    persistSelection(currentUser.id, next);
    if (next.storeIds.length === 1) persistActiveStoreLegacy(next.storeIds[0]);
  };

  const updateSelection = (updater: (prev: ScopeSelection) => ScopeSelection) => {
    setSelection((prev) => {
      const next = reconcileSelection({
        selection: updater(prev),
        stores,
        groups: accessibleGroups,
        managementUnits,
        isAdmin,
      });
      persistSelection(currentUser.id, next);
      if (next.storeIds.length === 1) persistActiveStoreLegacy(next.storeIds[0]);
      return next;
    });
  };

  const setActiveStoreId = (storeId: string) => updateSelection((prev) => ({ ...prev, storeIds: [storeId] }));

  const setSelectedManagementUnitIds = (ids: string[]) => {
    const normalized = normalizeUnique(ids);
    updateSelection((prev) => ({ ...prev, managementUnitIds: normalized }));
  };

  const setSelectedOrgIds = (ids: string[]) => {
    const normalized = normalizeUnique(ids);
    updateSelection((prev) => ({ ...prev, orgIds: normalized }));
  };

  const setSelectedStoreIds = (ids: string[]) => {
    const normalized = normalizeUnique(ids);
    updateSelection((prev) => ({ ...prev, storeIds: normalized }));
  };

  const selectAllManagementUnits = () => setSelectedManagementUnitIds(managementUnits.map((unit) => unit.id));
  const clearManagementUnits = () => setSelectedManagementUnitIds([]);
  const selectAllGroups = () => setSelectedOrgIds(filteredGroups.map((group) => group.id));
  const clearGroups = () => setSelectedOrgIds([]);
  const selectAllStores = () => setSelectedStoreIds(filteredStores.map((store) => store.id));
  const clearStores = () => {
    const fallback = pickDefaultStore(filteredStores) || pickDefaultStore(stores);
    setSelectedStoreIds(fallback ? [fallback.id] : []);
  };

  const reloadStores = async () => {
    if (!isSupabaseConfigured) return;
    setIsLoadingStores(true);
    setStoresError(null);
    try {
      const storePromise = storesService.listAccessible();
      const groupPromise = groupService.listAccessibleGroups(currentUser.id).catch((error) => {
        console.warn('[StoreContext] Failed to load groups:', error);
        return [] as AccessibleGroup[];
      });
      const unitPromise = isAdmin
        ? managementUnitService.listUnits().catch((error) => {
          console.warn('[StoreContext] Failed to load management units:', error);
          return [] as ManagementUnit[];
        })
        : Promise.resolve([] as ManagementUnit[]);

      const [nextStores, nextGroups, nextUnits] = await Promise.all([storePromise, groupPromise, unitPromise]);
      setStores(nextStores);
      setAccessibleGroups(nextGroups);
      setManagementUnits(nextUnits);

      const legacyStoredStoreId = typeof window !== 'undefined' ? window.localStorage.getItem(ACTIVE_STORE_KEY) : null;
      const storedSelection = loadStoredSelection(currentUser.id);
      const mergedSelection: ScopeSelection = {
        managementUnitIds: storedSelection?.managementUnitIds || selection.managementUnitIds,
        orgIds: storedSelection?.orgIds || selection.orgIds,
        storeIds: storedSelection?.storeIds || selection.storeIds,
      };
      if (mergedSelection.storeIds.length === 0 && legacyStoredStoreId) {
        mergedSelection.storeIds = [legacyStoredStoreId];
      }

      const nextSelection = reconcileSelection({
        selection: mergedSelection,
        stores: nextStores,
        groups: nextGroups,
        managementUnits: nextUnits,
        isAdmin,
      });
      setSelectionAndPersist(nextSelection);
    } catch (error) {
      const message = getErrorMessage(error) || 'unknown error';
      setStores([]);
      setAccessibleGroups([]);
      setManagementUnits([]);
      setSelection({ managementUnitIds: [], orgIds: [], storeIds: [] });
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

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const nextSelection = reconcileSelection({
      selection,
      stores,
      groups: accessibleGroups,
      managementUnits,
      isAdmin,
    });
    if (JSON.stringify(nextSelection) !== JSON.stringify(selection)) {
      setSelectionAndPersist(nextSelection);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stores, accessibleGroups, managementUnits, isAdmin]);

  const value = useMemo<StoreContextType>(
    () => ({
      stores,
      accessibleGroups,
      managementUnits,
      filteredGroups,
      filteredStores,
      selectedManagementUnitIds: selection.managementUnitIds,
      selectedOrgIds: selection.orgIds,
      selectedStoreIds: selection.storeIds,
      activeStoreId,
      setActiveStoreId,
      setSelectedManagementUnitIds,
      setSelectedOrgIds,
      setSelectedStoreIds,
      selectAllManagementUnits,
      clearManagementUnits,
      selectAllGroups,
      clearGroups,
      selectAllStores,
      clearStores,
      isLoadingStores,
      storesError,
      reloadStores,
    }),
    [
      accessibleGroups,
      activeStoreId,
      clearGroups,
      clearManagementUnits,
      clearStores,
      filteredGroups,
      filteredStores,
      isLoadingStores,
      managementUnits,
      selection.managementUnitIds,
      selection.orgIds,
      selection.storeIds,
      selectAllGroups,
      selectAllManagementUnits,
      selectAllStores,
      setActiveStoreId,
      setSelectedManagementUnitIds,
      setSelectedOrgIds,
      setSelectedStoreIds,
      stores,
      storesError,
      reloadStores,
    ]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
};

export const useStore = (): StoreContextType => {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within a StoreProvider');
  return ctx;
};
