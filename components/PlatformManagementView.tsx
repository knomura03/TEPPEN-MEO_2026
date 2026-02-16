import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ProviderAuthKind,
  ProviderCapability,
  ProviderCatalog,
  ProviderConfiguration,
  ProviderKind,
  ProviderReadiness,
  Role,
  User,
  VisibilityState,
} from '../types';
import {
  DEFAULT_PROVIDER_CAPABILITIES,
  DEFAULT_PROVIDER_CATALOGS,
} from '../constants';
import { useNotification } from '../contexts/NotificationContext';
import { useStore } from '../contexts/StoreContext';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { getErrorMessage } from '../services/errorMessage';
import { integrationsService } from '../services/integrationsService';
import { providerCatalogService } from '../services/providerCatalogService';
import { providerConfigurationService } from '../services/providerConfigurationService';
import { buildProviderReadiness } from '../services/providerReadinessService';
import { oauthConnectionService } from '../services/oauthConnectionService';
import { ModalPortal } from './ModalPortal';
import { SocialPlatformLogo } from './ui/SocialPlatformLogo';
import {
  PAGE_CONTAINER_CLASS,
  PAGE_HEADER_DESCRIPTION_CLASS,
  PAGE_HEADER_TITLE_CLASS,
  PAGE_SECTION_DESCRIPTION_CLASS,
  PAGE_SECTION_TITLE_CLASS,
  PAGE_WARNING_CLASS,
} from './ui/pageLayout';
import { formatViewLabel } from './ui/formatters';
import { AlertTriangle, ExternalLink, Plus, Save } from 'lucide-react';

type ProviderCard = {
  catalog: ProviderCatalog;
  capability: ProviderCapability;
  configuration?: ProviderConfiguration;
  readiness: ProviderReadiness;
  isConnected: boolean;
};

const PROVIDER_KIND_LABELS: Record<ProviderKind, string> = {
  NATIVE: '標準連携',
  GENERIC: '汎用連携',
};

const PROVIDER_AUTH_LABELS: Record<ProviderAuthKind, string> = {
  OAUTH2: 'ログイン連携',
  API_KEY: 'APIキー',
  WEBHOOK: 'Webhook',
  NONE: '不要',
};

const PROVIDER_VISIBILITY_LABELS: Record<VisibilityState, string> = {
  HIDDEN: '非表示',
  ADMIN_ONLY: '内部のみ',
  ENABLED: '全体公開',
};

const CONNECTION_STATUS_LABELS = {
  CONNECTED: '接続済み',
  DISCONNECTED: '未接続',
  ERROR: 'エラー',
} as const;

const TEST_MODE_LABELS = {
  REAL: '実接続',
  MOCK: '検証',
} as const;

const RUNTIME_MODE_LABELS = {
  ACTIVE: '有効',
  DEGRADED: '一部制限',
  BLOCKED: '停止',
} as const;

const PROVIDER_FORMAL_DISPLAY_NAMES: Record<string, string> = {
  GBP: 'Googleビジネスプロフィール',
  GOOGLE_BUSINESS: 'Googleビジネスプロフィール',
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
};

const PROVIDER_DISPLAY_ORDER: Record<string, number> = {
  GBP: 0,
  GOOGLE_BUSINESS: 0,
  FACEBOOK: 1,
  INSTAGRAM: 2,
};

const getProviderDisplayName = (providerKey: string, fallback: string): string => {
  const normalized = (providerKey || '').toUpperCase();
  return PROVIDER_FORMAL_DISPLAY_NAMES[normalized] || fallback;
};

const hasBrandedPlatformLogo = (providerKey: string): boolean => {
  const normalized = (providerKey || '').toUpperCase();
  return normalized === 'GBP' || normalized === 'GOOGLE_BUSINESS' || normalized === 'FACEBOOK' || normalized === 'INSTAGRAM';
};

const normalizeJson = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

export const PlatformManagementView: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const { addNotification } = useNotification();
  const { activeStoreId, selectedStoreIds, selectedOrgIds, stores } = useStore();

  const isInternal = currentUser.role === Role.ADMIN || currentUser.role === Role.SUPERVISOR;
  const canManageProviders = currentUser.role === Role.ADMIN;
  const isSingleStoreSelected = selectedStoreIds.length === 1 && Boolean(activeStoreId);

  const activeOrgId = useMemo(() => {
    if (activeStoreId) {
      return stores.find((store) => store.id === activeStoreId)?.orgId || null;
    }
    if (selectedOrgIds.length === 1) return selectedOrgIds[0] || null;
    return null;
  }, [activeStoreId, selectedOrgIds, stores]);

  const fallbackProviderCards = useMemo<ProviderCard[]>(() => {
    const capabilityMap = new Map(DEFAULT_PROVIDER_CAPABILITIES.map((item) => [item.providerCatalogId, item]));
    return DEFAULT_PROVIDER_CATALOGS.map((catalog) => {
      const capability = capabilityMap.get(catalog.id);
      const readiness = buildProviderReadiness(catalog, undefined);
      return {
        catalog,
        capability: capability || {
          id: `cap-${catalog.id}`,
          providerCatalogId: catalog.id,
          canConnect: true,
          canSyncInbox: true,
          canPublish: false,
          canReply: false,
          canFetchMetrics: false,
        },
        readiness,
        isConnected: false,
      };
    });
  }, []);

  const [providerCards, setProviderCards] = useState<ProviderCard[]>([]);
  const [isLoadingIntegrations, setIsLoadingIntegrations] = useState(false);
  const [updatingIntegrationId, setUpdatingIntegrationId] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [providerConfigJson, setProviderConfigJson] = useState('{}');
  const [providerSecretInput, setProviderSecretInput] = useState('');
  const [isSavingProviderConfig, setIsSavingProviderConfig] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isDiscoveringTargets, setIsDiscoveringTargets] = useState(false);

  const [oauthAuthorizationUrl, setOauthAuthorizationUrl] = useState('');
  const [oauthProviderLabel, setOauthProviderLabel] = useState('');
  const [isOAuthModalOpen, setIsOAuthModalOpen] = useState(false);
  const [isStartingOAuth, setIsStartingOAuth] = useState(false);
  const [isDisconnectingOAuth, setIsDisconnectingOAuth] = useState(false);
  const oauthQueryHandledRef = useRef<string | null>(null);

  // Provider catalog create (ADMIN only)
  const [isCreatingProvider, setIsCreatingProvider] = useState(false);
  const [newProviderKey, setNewProviderKey] = useState('');
  const [newProviderName, setNewProviderName] = useState('');
  const [newProviderKind, setNewProviderKind] = useState<ProviderKind>('GENERIC');
  const [newProviderAuthKind, setNewProviderAuthKind] = useState<ProviderAuthKind>('API_KEY');
  const [newProviderVisibility, setNewProviderVisibility] = useState<VisibilityState>('ADMIN_ONLY');
  const [newCanConnect, setNewCanConnect] = useState(true);
  const [newCanSyncInbox, setNewCanSyncInbox] = useState(true);
  const [newCanPublish, setNewCanPublish] = useState(false);
  const [newCanReply, setNewCanReply] = useState(false);
  const [newCanFetchMetrics, setNewCanFetchMetrics] = useState(false);

  const loadProviderCards = async () => {
    if (!isSupabaseConfigured) {
      setProviderCards(fallbackProviderCards);
      return;
    }
    if (!activeOrgId) {
      setProviderCards(fallbackProviderCards);
      return;
    }

    setIsLoadingIntegrations(true);
    try {
      const [catalogRows, integrationRows, configurationRows] = await Promise.all([
        providerCatalogService.listByOrg(activeOrgId),
        activeStoreId ? integrationsService.listByStore(activeStoreId) : Promise.resolve([]),
        activeStoreId ? providerConfigurationService.listByStore(activeStoreId) : Promise.resolve([]),
      ]);
      const integrationMap = new Map(integrationRows.map((row) => [row.providerKey, row.isConnected]));
      const configurationMap = new Map(configurationRows.map((row) => [row.providerCatalogId, row]));

      const nextCards: ProviderCard[] = catalogRows.map((row) => {
        const configuration = configurationMap.get(row.catalog.id);
        const readiness = buildProviderReadiness(row.catalog, configuration);
        const integrationConnected = integrationMap.get(row.catalog.providerKey) === true;
        const configConnected = configuration?.connectionStatus === 'CONNECTED';
        return {
          catalog: row.catalog,
          capability: row.capability || {
            id: `cap-${row.catalog.id}`,
            providerCatalogId: row.catalog.id,
            canConnect: true,
            canSyncInbox: true,
            canPublish: false,
            canReply: false,
            canFetchMetrics: false,
          },
          configuration,
          readiness,
          isConnected: integrationConnected || configConnected,
        };
      });

      const sortedCards = [...nextCards].sort((left, right) => {
        const leftKey = left.catalog.providerKey.toUpperCase();
        const rightKey = right.catalog.providerKey.toUpperCase();
        const leftOrder = PROVIDER_DISPLAY_ORDER[leftKey] ?? 999;
        const rightOrder = PROVIDER_DISPLAY_ORDER[rightKey] ?? 999;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        const leftLabel = getProviderDisplayName(left.catalog.providerKey, left.catalog.displayName);
        const rightLabel = getProviderDisplayName(right.catalog.providerKey, right.catalog.displayName);
        return leftLabel.localeCompare(rightLabel, 'ja');
      });

      setProviderCards(sortedCards);
      if (!selectedProviderId && sortedCards.length > 0) {
        setSelectedProviderId(sortedCards[0].catalog.id);
      }
    } catch (error) {
      console.error('[PlatformManagementView] Failed to load provider cards:', error);
      addNotification('読み込みエラー', '連携状態の取得に失敗しました。', 'ERROR');
    } finally {
      setIsLoadingIntegrations(false);
    }
  };

  useEffect(() => {
    void loadProviderCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStoreId, activeOrgId]);

  const visibleProviderCards = useMemo(() => {
    const all = providerCards;
    if (isInternal) return all;
    return all.filter((card) => card.catalog.defaultVisibility === 'ENABLED');
  }, [isInternal, providerCards]);

  const selectedProviderCard = useMemo(
    () => providerCards.find((card) => card.catalog.id === selectedProviderId) || null,
    [providerCards, selectedProviderId]
  );

  useEffect(() => {
    if (!selectedProviderCard) return;
    setProviderConfigJson(JSON.stringify(selectedProviderCard.configuration?.config || {}, null, 2));
  }, [selectedProviderCard?.catalog.id, selectedProviderCard?.configuration?.id]);

  const integrationDisabledReason = !isSupabaseConfigured
    ? 'Supabase未設定のため操作できません。'
    : !isSingleStoreSelected
      ? '複数店舗選択中のため操作できません。店舗を1つだけ選択してください。'
      : null;

  const closeOAuthModal = (force = false) => {
    if (isStartingOAuth && !force) return;
    setIsOAuthModalOpen(false);
    setOauthAuthorizationUrl('');
    setOauthProviderLabel('');
  };

  const handleToggleConnection = (providerCatalogId: string) => {
    const target = providerCards.find((card) => card.catalog.id === providerCatalogId);
    if (!target) return;
    const targetDisplayName = getProviderDisplayName(target.catalog.providerKey, target.catalog.displayName);
    const effectiveConnected = target.isConnected || target.configuration?.connectionStatus === 'CONNECTED';

    if (!isSupabaseConfigured) {
      addNotification('未設定', 'Supabase未設定のため操作できません。', 'WARNING');
      return;
    }
    if (!activeStoreId || selectedStoreIds.length !== 1) {
      addNotification('店舗選択', '店舗を1つだけ選択してください。', 'WARNING');
      return;
    }

    if (target.catalog.authKind === 'OAUTH2') {
      if (effectiveConnected) {
        setIsDisconnectingOAuth(true);
        oauthConnectionService
          .disconnect({
            storeId: activeStoreId,
            providerKey: target.catalog.providerKey,
          })
          .then(() => {
            addNotification('連携解除', `${targetDisplayName} の連携を解除しました。`, 'INFO');
          })
          .catch((error) => {
            console.error('[PlatformManagementView] Failed to disconnect OAuth provider:', error);
            addNotification('連携解除エラー', `連携解除に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
          })
          .finally(async () => {
            setIsDisconnectingOAuth(false);
            await loadProviderCards();
          });
        return;
      }

      setIsStartingOAuth(true);
      oauthConnectionService
        .start({
          storeId: activeStoreId,
          providerKey: target.catalog.providerKey,
          returnTo: typeof window !== 'undefined' ? `${window.location.origin}/?view=PLATFORM_MANAGEMENT` : undefined,
        })
        .then((result) => {
          setOauthAuthorizationUrl(result.authorizationUrl);
          setOauthProviderLabel(targetDisplayName);
          setIsOAuthModalOpen(true);
          addNotification('連携開始', `${targetDisplayName} の認可画面へ進んでください。`, 'INFO');
        })
        .catch((error) => {
          console.error('[PlatformManagementView] Failed to start OAuth provider flow:', error);
          addNotification('連携開始エラー', `連携開始に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
        })
        .finally(() => {
          setIsStartingOAuth(false);
        });
      return;
    }

    if (!activeStoreId) return;
    setUpdatingIntegrationId(providerCatalogId);
    integrationsService
      .setConnection(activeStoreId, target.catalog.providerKey, !effectiveConnected)
      .then((updated) => {
        addNotification(
          updated.isConnected ? '連携完了' : '連携解除',
          `${targetDisplayName}との連携を${updated.isConnected ? '開始' : '解除'}しました。`,
          updated.isConnected ? 'SUCCESS' : 'INFO'
        );
      })
      .catch((error) => {
        console.error('[PlatformManagementView] Failed to update integration connection:', error);
        addNotification('連携エラー', '連携状態の更新に失敗しました。', 'ERROR');
      })
      .finally(async () => {
        setUpdatingIntegrationId(null);
        await loadProviderCards();
      });
  };

  const handleOpenOAuthAuthorization = () => {
    if (!oauthAuthorizationUrl || typeof window === 'undefined') return;
    window.location.assign(oauthAuthorizationUrl);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const currentSearch = window.location.search || '';
    if (oauthQueryHandledRef.current === currentSearch) return;
    oauthQueryHandledRef.current = currentSearch;

    const params = new URLSearchParams(currentSearch);
    const oauthStatus = params.get('oauthStatus');
    const oauthProvider = params.get('oauthProvider');
    const oauthError = params.get('oauthError');
    const oauthErrorMessage = params.get('oauthErrorMessage');

    const decode = (value: string): string => {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    };

    if (oauthStatus === 'success') {
      addNotification('OAuth連携完了', `${oauthProvider || '連携先'} の接続が完了しました。接続テストで状態を確認してください。`, 'SUCCESS');
      void loadProviderCards();
    } else if (oauthStatus === 'error') {
      const errorText = oauthError ? `（${decode(oauthError)}）` : '';
      const detailText = oauthErrorMessage ? `\n詳細: ${decode(oauthErrorMessage)}` : '';
      addNotification('OAuth連携エラー', `OAuth連携に失敗しました。${errorText}${detailText}`, 'ERROR');
      void loadProviderCards();
    }

    if (!oauthStatus && !oauthError && !oauthErrorMessage) return;
    params.delete('oauthStatus');
    params.delete('oauthProvider');
    params.delete('oauthError');
    params.delete('oauthErrorMessage');
    const nextQuery = params.toString();
    const nextPath = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, '', nextPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addNotification]);

  const handleSaveProviderConfig = async () => {
    if (!selectedProviderCard) {
      addNotification('入力エラー', '連携先を選択してください。', 'WARNING');
      return;
    }
    if (!activeStoreId || selectedStoreIds.length !== 1) {
      addNotification('店舗選択', '店舗を1つだけ選択してください。', 'WARNING');
      return;
    }
    if (!isSupabaseConfigured) {
      addNotification('未設定', 'Supabase未設定のため保存できません。', 'WARNING');
      return;
    }

    setIsSavingProviderConfig(true);
    try {
      const config = normalizeJson(providerConfigJson);
      const updated = await providerConfigurationService.upsertConfiguration({
        storeId: activeStoreId,
        providerCatalogId: selectedProviderCard.catalog.id,
        config,
        updatedBy: currentUser.id,
      });
      if (providerSecretInput.trim()) {
        await providerConfigurationService.upsertSecret({
          providerConfigurationId: updated.id,
          secret: providerSecretInput.trim(),
        });
        setProviderSecretInput('');
      }
      addNotification('保存完了', '連携先設定を保存しました。', 'SUCCESS');
      await loadProviderCards();
    } catch (error) {
      addNotification('保存エラー', `連携先設定の保存に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    } finally {
      setIsSavingProviderConfig(false);
    }
  };

  const handleTestConnection = async () => {
    if (!selectedProviderCard?.configuration?.id) {
      addNotification('入力エラー', '先に「設定を保存」を実行してください。', 'WARNING');
      return;
    }
    if (!isSupabaseConfigured) {
      addNotification('未設定', 'Supabase未設定のため接続テストできません。', 'WARNING');
      return;
    }

    setIsTestingConnection(true);
    try {
      const status = await providerConfigurationService.testConnection({
        providerConfigurationId: selectedProviderCard.configuration.id,
      });
      addNotification('接続テスト', `接続状態: ${CONNECTION_STATUS_LABELS[status] || status}`, status === 'CONNECTED' ? 'SUCCESS' : 'WARNING');
      await loadProviderCards();
    } catch (error) {
      addNotification('接続テストエラー', `接続テストに失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleDiscoverTargets = async () => {
    if (!selectedProviderCard?.configuration?.id) {
      addNotification('入力エラー', '先に「設定を保存」を実行してください。', 'WARNING');
      return;
    }
    if (!isSupabaseConfigured) {
      addNotification('未設定', 'Supabase未設定のためID自動取得できません。', 'WARNING');
      return;
    }

    setIsDiscoveringTargets(true);
    try {
      const result = await providerConfigurationService.discoverTargets({
        providerConfigurationId: selectedProviderCard.configuration.id,
      });
      if (result.autoApplied) {
        setProviderConfigJson(JSON.stringify(result.appliedConfig || {}, null, 2));
        addNotification('ID自動取得', '候補を取得し、設定へ反映しました。必要に応じて保存してください。', 'SUCCESS');
      } else {
        addNotification('ID自動取得', result.message || '候補を取得しました。', 'INFO');
      }
      await loadProviderCards();
    } catch (error) {
      addNotification('ID自動取得エラー', `ID自動取得に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    } finally {
      setIsDiscoveringTargets(false);
    }
  };

  const handleCreateProvider = async () => {
    if (!canManageProviders) return;
    if (!isSupabaseConfigured) {
      addNotification('未設定', 'Supabase未設定のため追加できません。', 'WARNING');
      return;
    }
    if (!activeOrgId) {
      addNotification('グループ未選択', '店舗を選択してから追加してください。', 'WARNING');
      return;
    }
    if (!newProviderKey.trim() || !newProviderName.trim()) {
      addNotification('入力エラー', '連携先キーと表示名を入力してください。', 'WARNING');
      return;
    }
    const normalizedKey = newProviderKey.trim().toUpperCase();
    if (!/^[A-Z0-9_]+$/.test(normalizedKey)) {
      addNotification('入力エラー', '連携先キーは英大文字・数字・アンダースコアのみ使用できます。', 'WARNING');
      return;
    }

    setIsCreatingProvider(true);
    try {
      await providerCatalogService.createProvider({
        orgId: activeOrgId,
        providerKey: normalizedKey,
        displayName: newProviderName.trim(),
        providerKind: newProviderKind,
        authKind: newProviderAuthKind,
        defaultVisibility: newProviderVisibility,
        createdBy: currentUser.id,
        capability: {
          canConnect: newCanConnect,
          canSyncInbox: newCanSyncInbox,
          canPublish: newCanPublish,
          canReply: newCanReply,
          canFetchMetrics: newCanFetchMetrics,
        },
      });
      addNotification('連携先追加', '連携先を追加しました。', 'SUCCESS');
      setNewProviderKey('');
      setNewProviderName('');
      await loadProviderCards();
    } catch (error) {
      addNotification('追加エラー', `連携先の追加に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    } finally {
      setIsCreatingProvider(false);
    }
  };

  return (
    <div id="platform-management-main" className={PAGE_CONTAINER_CLASS}>
      <section>
        <h1 className={PAGE_HEADER_TITLE_CLASS}>{formatViewLabel('PLATFORM_MANAGEMENT')}</h1>
        <p className={PAGE_HEADER_DESCRIPTION_CLASS}>店舗ごとのSNS連携を管理します。</p>
      </section>

      {!isSupabaseConfigured && (
        <div className={PAGE_WARNING_CLASS}>
          Supabase未接続のため、プラットフォーム管理は利用できません。
        </div>
      )}

      {selectedStoreIds.length > 1 && (
        <div className="rounded-2xl border border-yellow-200 dark:border-yellow-900/40 bg-yellow-50 dark:bg-yellow-900/20 p-4 text-sm text-yellow-900 dark:text-yellow-100">
          <div className="font-bold mb-1 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            複数店舗選択中は操作できません
          </div>
          <div>SNS連携/同期/投稿/返信/指標取得を行うには、店舗を1つだけ選択してください。</div>
        </div>
      )}

      <section className="space-y-3">
        <div>
          <h2 className={PAGE_SECTION_TITLE_CLASS}>店舗のSNS連携</h2>
          <p className={PAGE_SECTION_DESCRIPTION_CLASS}>接続状態の確認・連携/解除を行います。</p>
          {!isInternal && (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              アカウントの連携/解除は可能です。連携先の追加や詳細設定はADMINのみ表示されます。
            </p>
          )}
        </div>

        {isLoadingIntegrations ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">読み込み中...</div>
        ) : visibleProviderCards.length === 0 ? (
          <div className="rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 text-sm text-gray-500 dark:text-gray-400">
            利用可能な連携先がありません。
          </div>
        ) : (
          <div className="grid gap-4">
            {visibleProviderCards.map((provider) => {
              const effectiveConnected = provider.isConnected || provider.configuration?.connectionStatus === 'CONNECTED';
              const connectionStatus = effectiveConnected
                ? 'CONNECTED'
                : provider.configuration?.connectionStatus || 'DISCONNECTED';
              const isConnectionUpdating =
                updatingIntegrationId === provider.catalog.id ||
                (provider.catalog.authKind === 'OAUTH2' && (isStartingOAuth || isDisconnectingOAuth));

              return (
                <div
                  key={provider.catalog.id}
                  data-testid={`provider-card-${provider.catalog.providerKey}`}
                  data-provider-key={provider.catalog.providerKey}
                  onClick={() => setSelectedProviderId(provider.catalog.id)}
                  className={`p-6 bg-white dark:bg-gray-800 border rounded-2xl shadow-sm transition-all cursor-pointer ${
                    selectedProviderId === provider.catalog.id
                      ? 'border-primary-300 ring-1 ring-primary-200 dark:border-primary-500 dark:ring-primary-900/40'
                      : 'border-gray-100 dark:border-gray-700'
                  }`}
                  title="クリックでこの連携先を下の設定パネルで編集します。"
                >
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        {hasBrandedPlatformLogo(provider.catalog.providerKey) && (
                          <SocialPlatformLogo platform={provider.catalog.providerKey} size={16} />
                        )}
                        <h3 className="font-bold text-gray-800 dark:text-white">
                          {getProviderDisplayName(provider.catalog.providerKey, provider.catalog.displayName)}
                        </h3>
                        {canManageProviders && (
                          <span className="text-xs px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700">
                            公開範囲: {PROVIDER_VISIBILITY_LABELS[provider.catalog.defaultVisibility]}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        接続状態: {CONNECTION_STATUS_LABELS[connectionStatus]}
                      </p>
                      <details className="text-xs text-gray-500 dark:text-gray-400">
                        <summary className="cursor-pointer select-none">技術情報を表示（必要なときのみ）</summary>
                        <div className="mt-2 space-y-1">
                          <p>内部ID: {provider.catalog.providerKey}</p>
                          <p>連携方式: {PROVIDER_KIND_LABELS[provider.catalog.providerKind]}</p>
                          <p>ログイン方式: {PROVIDER_AUTH_LABELS[provider.catalog.authKind]}</p>
                          <p>接続確認方式: {TEST_MODE_LABELS[provider.readiness.testMode]}</p>
                          <p>利用状態: {RUNTIME_MODE_LABELS[provider.readiness.runtimeMode]}</p>
                          {provider.configuration?.lastError ? (
                            <p className="text-red-600 dark:text-red-300">エラー内容: {provider.configuration.lastError}</p>
                          ) : null}
                        </div>
                      </details>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {effectiveConnected ? (
                        <button
                          data-testid={`provider-toggle-${provider.catalog.providerKey}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleConnection(provider.catalog.id);
                          }}
                          disabled={isConnectionUpdating || Boolean(integrationDisabledReason)}
                          title={integrationDisabledReason || undefined}
                          className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {isConnectionUpdating ? '処理中...' : '連携解除'}
                        </button>
                      ) : (
                        <button
                          data-testid={`provider-toggle-${provider.catalog.providerKey}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleConnection(provider.catalog.id);
                          }}
                          disabled={isConnectionUpdating || Boolean(integrationDisabledReason)}
                          title={integrationDisabledReason || undefined}
                          className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {isConnectionUpdating ? '処理中...' : '連携する'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
          <h2 className={PAGE_SECTION_TITLE_CLASS}>連携先設定</h2>
          <p className={PAGE_SECTION_DESCRIPTION_CLASS}>クリックで選択した連携先の設定（JSON）とシークレットを保存できます。</p>

          <select
            value={selectedProviderId}
            onChange={(e) => setSelectedProviderId(e.target.value)}
            className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
          >
            <option value="">連携先を選択してください</option>
            {providerCards.map((card) => (
              <option key={card.catalog.id} value={card.catalog.id}>
                {getProviderDisplayName(card.catalog.providerKey, card.catalog.displayName)} ({card.catalog.providerKey})
              </option>
            ))}
          </select>

          <textarea
            value={providerConfigJson}
            onChange={(e) => setProviderConfigJson(e.target.value)}
            className="w-full h-40 p-2.5 font-mono text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl"
            disabled={!selectedProviderCard}
          />

          <input
            value={providerSecretInput}
            onChange={(e) => setProviderSecretInput(e.target.value)}
            placeholder="シークレット（保存後は再表示不可）"
            className="w-full p-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl"
            disabled={!selectedProviderCard}
          />

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => void handleSaveProviderConfig()}
              disabled={!selectedProviderCard || isSavingProviderConfig || Boolean(integrationDisabledReason)}
              title={integrationDisabledReason || undefined}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Save className="h-4 w-4" />
              {isSavingProviderConfig ? '保存中...' : '設定を保存'}
            </button>
            <button
              type="button"
              onClick={() => void handleTestConnection()}
              disabled={!selectedProviderCard?.configuration?.id || isTestingConnection || Boolean(integrationDisabledReason)}
              title={integrationDisabledReason || undefined}
              className="px-4 py-2 text-sm font-semibold rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isTestingConnection ? '実行中...' : '接続テスト'}
            </button>
            <button
              type="button"
              onClick={() => void handleDiscoverTargets()}
              disabled={!selectedProviderCard?.configuration?.id || isDiscoveringTargets || Boolean(integrationDisabledReason)}
              title={integrationDisabledReason || undefined}
              className="px-4 py-2 text-sm font-semibold rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isDiscoveringTargets ? '取得中...' : 'IDを自動取得'}
            </button>
          </div>

          {!isSingleStoreSelected && (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              ※ 複数店舗選択中は操作できません。
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
          <h2 className={PAGE_SECTION_TITLE_CLASS}>連携先の追加（管理者）</h2>
          <p className={PAGE_SECTION_DESCRIPTION_CLASS}>必要に応じて連携先（provider）を追加できます。</p>
          {!canManageProviders ? (
            <div className={PAGE_WARNING_CLASS}>この操作はADMINのみ可能です。</div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="連携先キー（例: X_REVIEWS）"
                  value={newProviderKey}
                  onChange={(e) => setNewProviderKey(e.target.value)}
                  className="w-full p-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl"
                />
                <input
                  type="text"
                  placeholder="表示名（例: X Reviews）"
                  value={newProviderName}
                  onChange={(e) => setNewProviderName(e.target.value)}
                  className="w-full p-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={newProviderKind}
                  onChange={(e) => setNewProviderKind(e.target.value as ProviderKind)}
                  className="p-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm"
                >
                  <option value="GENERIC">汎用連携</option>
                  <option value="NATIVE">標準連携</option>
                </select>
                <select
                  value={newProviderAuthKind}
                  onChange={(e) => setNewProviderAuthKind(e.target.value as ProviderAuthKind)}
                  className="p-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm"
                >
                  <option value="API_KEY">APIキー</option>
                  <option value="OAUTH2">ログイン連携</option>
                  <option value="WEBHOOK">Webhook</option>
                  <option value="NONE">不要</option>
                </select>
                <select
                  value={newProviderVisibility}
                  onChange={(e) => setNewProviderVisibility(e.target.value as VisibilityState)}
                  className="p-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm"
                >
                  <option value="ADMIN_ONLY">内部のみ</option>
                  <option value="HIDDEN">非表示</option>
                  <option value="ENABLED">全体公開</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-300">
                <label className="flex items-center gap-2"><input type="checkbox" checked={newCanConnect} onChange={(e) => setNewCanConnect(e.target.checked)} />接続</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={newCanSyncInbox} onChange={(e) => setNewCanSyncInbox(e.target.checked)} />受信箱連携</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={newCanPublish} onChange={(e) => setNewCanPublish(e.target.checked)} />投稿</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={newCanReply} onChange={(e) => setNewCanReply(e.target.checked)} />返信</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={newCanFetchMetrics} onChange={(e) => setNewCanFetchMetrics(e.target.checked)} />指標取得</label>
              </div>
              <button
                onClick={() => void handleCreateProvider()}
                disabled={isCreatingProvider || !activeOrgId}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-xl disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Plus className="h-4 w-4" />
                {isCreatingProvider ? '追加中...' : '連携先を追加'}
              </button>
            </div>
          )}
        </div>
      </section>

      {isOAuthModalOpen && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-6 space-y-4 shadow-xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">連携を進めてください</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                    {oauthProviderLabel} の認可画面を開き、アクセスを許可してください。
                  </p>
                </div>
                <button
                  onClick={() => closeOAuthModal()}
                  className="h-9 w-9 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
                  aria-label="閉じる"
                >
                  ×
                </button>
              </div>
              <div className="rounded-xl bg-gray-50 dark:bg-gray-800 p-3 text-xs text-gray-600 dark:text-gray-300 break-all">
                {oauthAuthorizationUrl}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => closeOAuthModal()}
                  className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm font-semibold"
                >
                  後で
                </button>
                <button
                  onClick={handleOpenOAuthAuthorization}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold"
                >
                  <ExternalLink className="h-4 w-4" />
                  認可画面を開く
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};
