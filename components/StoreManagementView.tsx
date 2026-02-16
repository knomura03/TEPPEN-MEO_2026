import React, { useEffect, useMemo, useState } from 'react';
import { Role, User } from '../types';
import { useNotification } from '../contexts/NotificationContext';
import { useStore } from '../contexts/StoreContext';
import { storesService } from '../services/storesService';
import { getErrorMessage } from '../services/errorMessage';
import { isSupabaseConfigured } from '../services/supabaseClient';
import {
  PAGE_CONTAINER_CLASS,
  PAGE_HEADER_DESCRIPTION_CLASS,
  PAGE_HEADER_TITLE_CLASS,
  PAGE_SECTION_DESCRIPTION_CLASS,
  PAGE_SECTION_TITLE_CLASS,
  PAGE_WARNING_CLASS,
} from './ui/pageLayout';
import { formatViewLabel } from './ui/formatters';
import { COMMON_COPY } from './ui/copy';

interface StoreManagementViewProps {
  currentUser: User;
}

export const StoreManagementView: React.FC<StoreManagementViewProps> = ({ currentUser }) => {
  const { addNotification } = useNotification();
  const { filteredStores, activeStoreId, selectedOrgIds, selectedStoreIds, setActiveStoreId, reloadStores } = useStore();

  const activeStore = useMemo(
    () => filteredStores.find((store) => store.id === activeStoreId) || null,
    [filteredStores, activeStoreId]
  );
  const selectedOrgId = selectedOrgIds.length === 1 ? selectedOrgIds[0] : null;
  const activeOrgId = activeStore?.orgId || selectedOrgId || null;
  const isMultiStoreSelected = selectedStoreIds.length > 1;

  const [editName, setEditName] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editBusinessHours, setEditBusinessHours] = useState('');

  const [newStoreName, setNewStoreName] = useState('');
  const [newStoreAddress, setNewStoreAddress] = useState('');
  const [newStorePhone, setNewStorePhone] = useState('');
  const [newStoreCategory, setNewStoreCategory] = useState('');
  const [newStoreBusinessHours, setNewStoreBusinessHours] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    setEditName(activeStore?.name || '');
    setEditAddress(activeStore?.address || '');
    setEditPhone(activeStore?.phone || '');
    setEditCategory(activeStore?.category || '');
    setEditBusinessHours(activeStore?.businessHours || '');
  }, [activeStore?.id, activeStore?.name, activeStore?.address, activeStore?.phone, activeStore?.category, activeStore?.businessHours]);

  const handleUpdateStore = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isSupabaseConfigured) {
      addNotification('未設定', 'Supabase未設定のため更新できません。', 'WARNING');
      return;
    }
    if (isMultiStoreSelected) {
      addNotification('複数店舗選択中', COMMON_COPY.multiStoreSnsDisabled, 'WARNING');
      return;
    }
    if (!activeStore) {
      addNotification('店舗未選択', '更新する店舗を選択してください。', 'WARNING');
      return;
    }
    if (!editName.trim()) {
      addNotification('入力エラー', '店舗名を入力してください。', 'WARNING');
      return;
    }

    setIsSaving(true);
    try {
      await storesService.updateStore(activeStore.id, {
        name: editName.trim(),
        address: editAddress.trim() || null,
        phone: editPhone.trim() || null,
        category: editCategory.trim() || null,
        businessHours: editBusinessHours.trim() || null,
      });
      await reloadStores();
      setActiveStoreId(activeStore.id);
      addNotification('更新完了', '店舗情報を更新しました。', 'SUCCESS');
    } catch (error) {
      addNotification('更新エラー', getErrorMessage(error) || '店舗情報の更新に失敗しました。', 'ERROR');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateStore = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isSupabaseConfigured) {
      addNotification('未設定', 'Supabase未設定のため作成できません。', 'WARNING');
      return;
    }
    if (isMultiStoreSelected) {
      addNotification('複数店舗選択中', COMMON_COPY.multiStoreSnsDisabled, 'WARNING');
      return;
    }
    if (!newStoreName.trim()) {
      addNotification('入力エラー', '新規店舗名を入力してください。', 'WARNING');
      return;
    }
    if (!activeOrgId) {
      addNotification('グループ未選択', '追加先のグループを選択してください。', 'WARNING');
      return;
    }
    if (!activeStore && !selectedOrgId) {
      addNotification('店舗未選択', '追加先のグループ内の店舗を選択するか、ヘッダーでグループを1つだけ選択してください。', 'WARNING');
      return;
    }

    setIsCreating(true);
    try {
      const created = await storesService.createStore({
        orgId: activeOrgId,
        name: newStoreName.trim(),
        address: newStoreAddress.trim() || undefined,
        phone: newStorePhone.trim() || undefined,
        category: newStoreCategory.trim() || undefined,
        businessHours: newStoreBusinessHours.trim() || undefined,
      });
      await reloadStores();
      setActiveStoreId(created.id);
      setNewStoreName('');
      setNewStoreAddress('');
      setNewStorePhone('');
      setNewStoreCategory('');
      setNewStoreBusinessHours('');
      addNotification('作成完了', '新しい店舗を作成しました。', 'SUCCESS');
    } catch (error) {
      addNotification('作成エラー', getErrorMessage(error) || '店舗作成に失敗しました。', 'ERROR');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div id="store-management-main" className={PAGE_CONTAINER_CLASS}>
      <section>
        <h1 className={PAGE_HEADER_TITLE_CLASS}>{formatViewLabel('STORE_MANAGEMENT')}</h1>
        <p className={PAGE_HEADER_DESCRIPTION_CLASS}>
          {currentUser.role === Role.USER
            ? '担当店舗の情報を確認・編集できます。'
            : 'MANAGER以上のユーザーが担当店舗を作成・編集できます。'}
        </p>
      </section>

      {!isSupabaseConfigured && (
        <div className={PAGE_WARNING_CLASS}>Supabase未設定のため店舗管理機能は利用できません。</div>
      )}

      {isMultiStoreSelected && (
        <div className={PAGE_WARNING_CLASS}>{COMMON_COPY.multiStoreSnsDisabled}</div>
      )}

      <section className="rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
        <h2 className={PAGE_SECTION_TITLE_CLASS}>担当店舗一覧</h2>
        <p className={PAGE_SECTION_DESCRIPTION_CLASS}>編集対象の店舗を選択してください（複数店舗選択中は編集できません）。</p>
        {filteredStores.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">アクセス可能な店舗がありません。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {filteredStores.map((store) => (
              <button
                key={store.id}
                type="button"
                onClick={() => setActiveStoreId(store.id)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                  store.id === activeStoreId
                    ? 'border-primary-500 bg-primary-50 text-primary-700 dark:border-primary-400 dark:bg-primary-900/20 dark:text-primary-300'
                    : 'border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-primary-300'
                }`}
              >
                {store.name}
              </button>
            ))}
          </div>
        )}
      </section>

      <form onSubmit={handleUpdateStore} className="rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
        <h2 className={PAGE_SECTION_TITLE_CLASS}>選択中の店舗を編集</h2>
        <input
          value={editName}
          onChange={(event) => setEditName(event.target.value)}
          placeholder="店舗名"
          className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
          disabled={!activeStore || isSaving || isMultiStoreSelected}
        />
        <input
          value={editAddress}
          onChange={(event) => setEditAddress(event.target.value)}
          placeholder="住所"
          className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
          disabled={!activeStore || isSaving || isMultiStoreSelected}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            value={editPhone}
            onChange={(event) => setEditPhone(event.target.value)}
            placeholder="電話番号"
            className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
            disabled={!activeStore || isSaving || isMultiStoreSelected}
          />
          <input
            value={editCategory}
            onChange={(event) => setEditCategory(event.target.value)}
            placeholder="カテゴリ"
            className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
            disabled={!activeStore || isSaving || isMultiStoreSelected}
          />
        </div>
        <input
          value={editBusinessHours}
          onChange={(event) => setEditBusinessHours(event.target.value)}
          placeholder="営業時間"
          className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
          disabled={!activeStore || isSaving || isMultiStoreSelected}
        />
        <button
          type="submit"
          disabled={!activeStore || isSaving || isMultiStoreSelected}
          className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSaving ? '更新中...' : '店舗情報を更新'}
        </button>
      </form>

      {currentUser.role !== Role.USER && (
        <form onSubmit={handleCreateStore} className="rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
          <h2 className={PAGE_SECTION_TITLE_CLASS}>店舗を追加</h2>
          <p className={PAGE_SECTION_DESCRIPTION_CLASS}>現在選択中のグループに新しい店舗を追加します。</p>
          <input
            value={newStoreName}
            onChange={(event) => setNewStoreName(event.target.value)}
            placeholder="新規店舗名"
            className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
            disabled={isCreating || isMultiStoreSelected}
          />
          <input
            value={newStoreAddress}
            onChange={(event) => setNewStoreAddress(event.target.value)}
            placeholder="住所"
            className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
            disabled={isCreating || isMultiStoreSelected}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              value={newStorePhone}
              onChange={(event) => setNewStorePhone(event.target.value)}
              placeholder="電話番号"
              className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
              disabled={isCreating || isMultiStoreSelected}
            />
            <input
              value={newStoreCategory}
              onChange={(event) => setNewStoreCategory(event.target.value)}
              placeholder="カテゴリ"
              className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
              disabled={isCreating || isMultiStoreSelected}
            />
          </div>
          <input
            value={newStoreBusinessHours}
            onChange={(event) => setNewStoreBusinessHours(event.target.value)}
            placeholder="営業時間"
            className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
            disabled={isCreating || isMultiStoreSelected}
          />
          <button
            type="submit"
            disabled={isCreating || isMultiStoreSelected}
            className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isCreating ? '作成中...' : '店舗を追加'}
          </button>
        </form>
      )}
    </div>
  );
};
