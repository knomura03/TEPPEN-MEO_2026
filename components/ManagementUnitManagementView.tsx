import React, { useEffect, useMemo, useState } from 'react';
import { Role, User } from '../types';
import { useNotification } from '../contexts/NotificationContext';
import { managementUnitService } from '../services/managementUnitService';
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

interface ManagementUnitManagementViewProps {
  currentUser: User;
}

type SupervisorCandidate = {
  userId: string;
  name: string;
  email: string;
};

type GroupWithUnit = {
  id: string;
  name: string;
  managementUnitId?: string;
};

export const ManagementUnitManagementView: React.FC<ManagementUnitManagementViewProps> = ({ currentUser }) => {
  const { addNotification } = useNotification();
  const isAdmin = currentUser.role === Role.ADMIN;

  const [units, setUnits] = useState<Array<{ id: string; name: string }>>([]);
  const [supervisorCandidates, setSupervisorCandidates] = useState<SupervisorCandidate[]>([]);
  const [groups, setGroups] = useState<GroupWithUnit[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingBranding, setIsSavingBranding] = useState(false);

  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [unitNameInput, setUnitNameInput] = useState('');
  const [assignSupervisorUnitId, setAssignSupervisorUnitId] = useState('');
  const [assignSupervisorUserId, setAssignSupervisorUserId] = useState('');
  const [assignGroupId, setAssignGroupId] = useState('');
  const [assignGroupUnitId, setAssignGroupUnitId] = useState('');
  const [brandingServiceName, setBrandingServiceName] = useState('TEPPEN MEO');
  const [brandingLogoPath, setBrandingLogoPath] = useState<string | null>(null);
  const [brandingLogoUrl, setBrandingLogoUrl] = useState<string>('');
  const [brandingLogoFile, setBrandingLogoFile] = useState<File | null>(null);
  const [brandingLogoPreviewUrl, setBrandingLogoPreviewUrl] = useState<string>('');

  const selectedUnit = useMemo(
    () => units.find((unit) => unit.id === selectedUnitId) || null,
    [units, selectedUnitId]
  );

  const loadAll = async () => {
    if (!isAdmin || !isSupabaseConfigured) {
      setUnits([]);
      setSupervisorCandidates([]);
      setGroups([]);
      return;
    }
    setIsLoading(true);
    try {
      const [unitRows, supervisorRows, groupRows] = await Promise.all([
        managementUnitService.listUnits(),
        managementUnitService.listSupervisorCandidates(),
        managementUnitService.listGroupsWithUnit(),
      ]);
      const nextUnits = unitRows.map((row) => ({ id: row.id, name: row.name }));
      setUnits(nextUnits);
      setSupervisorCandidates(supervisorRows);
      setGroups(groupRows);

      if (nextUnits.length > 0) {
        setSelectedUnitId((prev) => (prev && nextUnits.some((unit) => unit.id === prev) ? prev : nextUnits[0].id));
        setAssignSupervisorUnitId((prev) => (prev && nextUnits.some((unit) => unit.id === prev) ? prev : nextUnits[0].id));
        setAssignGroupUnitId((prev) => (prev && nextUnits.some((unit) => unit.id === prev) ? prev : nextUnits[0].id));
      }
      if (groupRows.length > 0) {
        setAssignGroupId((prev) => (prev && groupRows.some((group) => group.id === prev) ? prev : groupRows[0].id));
      }
    } catch (error) {
      addNotification('取得エラー', getErrorMessage(error) || '管理ユニット情報の取得に失敗しました。', 'ERROR');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  useEffect(() => {
    if (selectedUnit?.name) {
      setUnitNameInput(selectedUnit.name);
      return;
    }
    setUnitNameInput('');
  }, [selectedUnit?.id, selectedUnit?.name]);

  useEffect(() => {
    if (!isAdmin || !isSupabaseConfigured || !selectedUnitId) {
      setBrandingServiceName('TEPPEN MEO');
      setBrandingLogoPath(null);
      setBrandingLogoUrl('');
      setBrandingLogoFile(null);
      setBrandingLogoPreviewUrl('');
      return;
    }
    const loadBranding = async () => {
      try {
        const row = await managementUnitService.getBranding(selectedUnitId);
        const serviceName = row?.serviceName || 'TEPPEN MEO';
        const logoPath = row?.logoPath || null;
        const logoUrl = logoPath ? managementUnitService.getBrandingLogoPublicUrl(logoPath, row?.updatedAt?.getTime?.() ? row.updatedAt.getTime() : Date.now()) : '';
        setBrandingServiceName(serviceName);
        setBrandingLogoPath(logoPath);
        setBrandingLogoUrl(logoUrl);
        setBrandingLogoFile(null);
        setBrandingLogoPreviewUrl('');
      } catch (error) {
        console.error('[ManagementUnitManagementView] Failed to load branding:', error);
        setBrandingServiceName('TEPPEN MEO');
        setBrandingLogoPath(null);
        setBrandingLogoUrl('');
        setBrandingLogoFile(null);
        setBrandingLogoPreviewUrl('');
      }
    };
    void loadBranding();
  }, [isAdmin, selectedUnitId]);

  useEffect(() => {
    if (!brandingLogoFile) return;
    const url = URL.createObjectURL(brandingLogoFile);
    setBrandingLogoPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [brandingLogoFile]);

  const handleSaveBranding = async () => {
    if (!isAdmin) return;
    if (!isSupabaseConfigured) {
      addNotification('未設定', 'Supabase未設定のため保存できません。', 'WARNING');
      return;
    }
    if (!selectedUnitId) {
      addNotification('入力エラー', '管理ユニットを選択してください。', 'WARNING');
      return;
    }
    const serviceName = brandingServiceName.trim();
    if (!serviceName) {
      addNotification('入力エラー', 'サービス名を入力してください。', 'WARNING');
      return;
    }

    setIsSavingBranding(true);
    try {
      let logoPathToSave = brandingLogoPath;
      if (brandingLogoFile) {
        const uploaded = await managementUnitService.uploadBrandingLogo({
          managementUnitId: selectedUnitId,
          file: brandingLogoFile,
        });
        logoPathToSave = uploaded.path;
      }

      const saved = await managementUnitService.upsertBranding({
        managementUnitId: selectedUnitId,
        serviceName,
        logoPath: logoPathToSave,
        updatedBy: currentUser.id,
      });
      setBrandingLogoPath(saved.logoPath || null);
      setBrandingLogoUrl(saved.logoPath ? managementUnitService.getBrandingLogoPublicUrl(saved.logoPath, saved.updatedAt.getTime()) : '');
      setBrandingLogoFile(null);
      setBrandingLogoPreviewUrl('');
      managementUnitService.notifyBrandingUpdated(selectedUnitId);
      addNotification('保存完了', 'ブランド設定を保存しました。', 'SUCCESS');
    } catch (error) {
      addNotification('保存エラー', getErrorMessage(error) || 'ブランド設定の保存に失敗しました。', 'ERROR');
    } finally {
      setIsSavingBranding(false);
    }
  };

  const handleSaveUnit = async () => {
    const name = unitNameInput.trim();
    if (!name) {
      addNotification('入力エラー', '管理ユニット名を入力してください。', 'WARNING');
      return;
    }
    setIsSaving(true);
    try {
      const saved = await managementUnitService.upsertUnit({
        id: selectedUnit?.id,
        name,
      });
      await loadAll();
      setSelectedUnitId(saved.id);
      addNotification('保存完了', `管理ユニット「${saved.name}」を保存しました。`, 'SUCCESS');
    } catch (error) {
      addNotification('保存エラー', getErrorMessage(error) || '管理ユニットの保存に失敗しました。', 'ERROR');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAssignSupervisor = async () => {
    if (!assignSupervisorUnitId || !assignSupervisorUserId) {
      addNotification('入力エラー', '管理ユニットとSUPERVISORを選択してください。', 'WARNING');
      return;
    }
    setIsSaving(true);
    try {
      await managementUnitService.assignSupervisor({
        managementUnitId: assignSupervisorUnitId,
        supervisorUserId: assignSupervisorUserId,
      });
      addNotification('割当完了', 'SUPERVISORの管理ユニットを更新しました。', 'SUCCESS');
    } catch (error) {
      addNotification('割当エラー', getErrorMessage(error) || 'SUPERVISOR割当に失敗しました。', 'ERROR');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAssignGroup = async () => {
    if (!assignGroupId || !assignGroupUnitId) {
      addNotification('入力エラー', 'グループと管理ユニットを選択してください。', 'WARNING');
      return;
    }
    setIsSaving(true);
    try {
      await managementUnitService.assignGroup({
        orgId: assignGroupId,
        managementUnitId: assignGroupUnitId,
      });
      await loadAll();
      addNotification('割当完了', 'グループの管理ユニットを更新しました。', 'SUCCESS');
    } catch (error) {
      addNotification('割当エラー', getErrorMessage(error) || 'グループ割当に失敗しました。', 'ERROR');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className={PAGE_CONTAINER_CLASS}>
        <section>
          <h1 className={PAGE_HEADER_TITLE_CLASS}>{formatViewLabel('MANAGEMENT_UNIT_MANAGEMENT')}</h1>
          <p className={PAGE_HEADER_DESCRIPTION_CLASS}>管理ユニットの作成・割当を管理します。</p>
        </section>
        <div className={PAGE_WARNING_CLASS}>この画面にアクセスする権限がありません。</div>
      </div>
    );
  }

  return (
    <div id="management-unit-main" className={PAGE_CONTAINER_CLASS}>
      <section>
        <h1 className={PAGE_HEADER_TITLE_CLASS}>{formatViewLabel('MANAGEMENT_UNIT_MANAGEMENT')}</h1>
        <p className={PAGE_HEADER_DESCRIPTION_CLASS}>ADMINが管理ユニット・SUPERVISOR割当・グループ割当を管理する画面です。</p>
      </section>

      {!isSupabaseConfigured && (
        <div className={PAGE_WARNING_CLASS}>Supabase未設定のため管理ユニット機能は利用できません。</div>
      )}

      {isLoading ? (
        <div className="rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 text-sm text-gray-500 dark:text-gray-400">
          管理ユニット情報を読み込み中...
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <section className="rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
            <h2 className={PAGE_SECTION_TITLE_CLASS}>管理ユニット作成/更新</h2>
            <p className={PAGE_SECTION_DESCRIPTION_CLASS}>既存の管理ユニットを選ぶか、新しい名前で保存してください。</p>
            <select
              value={selectedUnitId}
              onChange={(event) => setSelectedUnitId(event.target.value)}
              className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
            >
              <option value="">新規作成</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
            <input
              value={unitNameInput}
              onChange={(event) => setUnitNameInput(event.target.value)}
              placeholder="管理ユニット名"
              className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
            />
            <button
              type="button"
              onClick={() => void handleSaveUnit()}
              disabled={isSaving}
              className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSaving ? '保存中...' : '管理ユニットを保存'}
            </button>
          </section>

          <section className="rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
            <h2 className={PAGE_SECTION_TITLE_CLASS}>SUPERVISOR割当</h2>
            <p className={PAGE_SECTION_DESCRIPTION_CLASS}>SUPERVISORを管理ユニットに割り当てます（1ユーザー=1ユニット）。</p>
            <select
              value={assignSupervisorUnitId}
              onChange={(event) => setAssignSupervisorUnitId(event.target.value)}
              className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
            >
              <option value="">管理ユニットを選択</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
            <select
              value={assignSupervisorUserId}
              onChange={(event) => setAssignSupervisorUserId(event.target.value)}
              className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
            >
              <option value="">SUPERVISORを選択</option>
              {supervisorCandidates.map((candidate) => (
                <option key={candidate.userId} value={candidate.userId}>
                  {candidate.name} ({candidate.email})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleAssignSupervisor()}
              disabled={isSaving || !assignSupervisorUnitId || !assignSupervisorUserId}
              className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSaving ? '割当中...' : 'SUPERVISORを割当'}
            </button>
          </section>

          <section className="rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
            <h2 className={PAGE_SECTION_TITLE_CLASS}>グループ割当</h2>
            <p className={PAGE_SECTION_DESCRIPTION_CLASS}>グループを管理ユニットへ割り当てます。</p>
            <select
              value={assignGroupId}
              onChange={(event) => setAssignGroupId(event.target.value)}
              className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
            >
              <option value="">グループを選択</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
            <select
              value={assignGroupUnitId}
              onChange={(event) => setAssignGroupUnitId(event.target.value)}
              className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
            >
              <option value="">管理ユニットを選択</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleAssignGroup()}
              disabled={isSaving || !assignGroupId || !assignGroupUnitId}
              className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSaving ? '割当中...' : 'グループを割り当て'}
            </button>
          </section>

          <section className="rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3 xl:col-span-3">
            <h2 className={PAGE_SECTION_TITLE_CLASS}>ブランド（サービス名/ロゴ）</h2>
            <p className={PAGE_SECTION_DESCRIPTION_CLASS}>
              ここで設定したサービス名/ロゴは、この管理ユニット配下の画面に反映されます（複数管理ユニット選択中はデフォルト表示になります）。
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">サービス名</label>
                <input
                  value={brandingServiceName}
                  onChange={(event) => setBrandingServiceName(event.target.value)}
                  placeholder="例: TEPPEN MEO"
                  disabled={!selectedUnitId || isSavingBranding}
                  className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">ロゴ（SVG/PNG）</label>
                <input
                  type="file"
                  accept=".svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg"
                  disabled={!selectedUnitId || isSavingBranding}
                  onChange={(event) => {
                    const file = event.target.files && event.target.files[0] ? event.target.files[0] : null;
                    setBrandingLogoFile(file);
                  }}
                  className="block w-full text-sm text-gray-600 dark:text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 disabled:opacity-60 disabled:cursor-not-allowed"
                />
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-3">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">プレビュー</div>
                  <div className="flex items-center gap-3">
                    <img
                      src={brandingLogoPreviewUrl || brandingLogoUrl || '/logo.svg'}
                      alt="logo preview"
                      className="h-10 w-auto"
                    />
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {brandingServiceName.trim() || 'TEPPEN MEO'}
                    </div>
                  </div>
                  {!brandingLogoPreviewUrl && !brandingLogoUrl && (
                    <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                      ロゴ未設定のため、デフォルトロゴを表示しています。
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => void handleSaveBranding()}
                disabled={isSavingBranding || !selectedUnitId}
                className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSavingBranding ? '保存中...' : 'ブランド設定を保存'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
