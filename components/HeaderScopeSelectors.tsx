import React, { useMemo } from 'react';
import { Role, User } from '../types';
import { useStore } from '../contexts/StoreContext';
import { MultiSelectDropdown } from './ui/MultiSelectDropdown';
import { formatRoleLabel } from './ui/formatters';

export const HeaderScopeSelectors: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const {
    managementUnits,
    filteredGroups,
    filteredStores,
    selectedManagementUnitIds,
    selectedOrgIds,
    selectedStoreIds,
    setSelectedManagementUnitIds,
    setSelectedOrgIds,
    setSelectedStoreIds,
    isLoadingStores,
    storesError,
  } = useStore();

  const isAdmin = currentUser.role === Role.ADMIN;
  const isSupervisor = currentUser.role === Role.SUPERVISOR;
  const isManager = currentUser.role === Role.MANAGER;

  const showManagementUnitSelector = isAdmin && managementUnits.length > 0;
  const showGroupSelector =
    isAdmin || isSupervisor || (isManager && filteredGroups.length > 1);

  const unitOptions = useMemo(
    () =>
      managementUnits.map((unit) => ({
        id: unit.id,
        label: unit.name,
      })),
    [managementUnits]
  );

  const groupOptions = useMemo(
    () =>
      filteredGroups.map((group) => ({
        id: group.id,
        label: group.name,
        description: `権限: ${formatRoleLabel(group.role as Role)}`,
      })),
    [filteredGroups]
  );

  const groupNameById = useMemo(() => {
    const map = new Map<string, string>();
    filteredGroups.forEach((group) => map.set(group.id, group.name));
    return map;
  }, [filteredGroups]);

  const storeOptions = useMemo(
    () =>
      filteredStores.map((store) => ({
        id: store.id,
        label: store.name,
        description: groupNameById.get(store.orgId) ? `グループ: ${groupNameById.get(store.orgId)}` : undefined,
      })),
    [filteredStores, groupNameById]
  );

  const isDisabled = !showManagementUnitSelector && !showGroupSelector && storeOptions.length === 0;
  const isScopeLoading = isLoadingStores && storeOptions.length === 0;

  if (isScopeLoading) {
    return (
      <div className="px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full text-gray-500 dark:text-gray-400">
        読み込み中...
      </div>
    );
  }

  if (storesError) {
    return (
      <div
        className="px-3 py-2 text-sm bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-full text-red-700 dark:text-red-200"
        title={storesError}
      >
        店舗取得エラー
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {showManagementUnitSelector && (
        <MultiSelectDropdown
          buttonTestId="header-management-unit-selector"
          label="管理ユニット"
          options={unitOptions}
          selectedIds={selectedManagementUnitIds}
          onChange={setSelectedManagementUnitIds}
          disabled={isDisabled}
          minButtonWidthClassName="min-w-[240px]"
        />
      )}

      {showGroupSelector && (
        <MultiSelectDropdown
          buttonTestId="header-group-selector"
          label="グループ"
          options={groupOptions}
          selectedIds={selectedOrgIds}
          onChange={setSelectedOrgIds}
          disabled={filteredGroups.length === 0}
          minButtonWidthClassName="min-w-[240px]"
        />
      )}

      <MultiSelectDropdown
        buttonTestId="header-store-selector"
        label="店舗"
        options={storeOptions}
        selectedIds={selectedStoreIds}
        onChange={setSelectedStoreIds}
        disabled={filteredStores.length === 0}
        minButtonWidthClassName="min-w-[260px]"
      />
    </div>
  );
};
