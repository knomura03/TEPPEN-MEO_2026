import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  User,
  Role,
  FeatureFlag,
  BrandKit,
  PostContentTemplate,
  SocialPlatform,
  ProviderCatalog,
  ProviderCapability,
  ProviderConfiguration,
  ProviderReadiness,
  ProviderAuthKind,
  ProviderKind,
  VisibilityState,
} from '../types';
import {
  DEFAULT_FEATURE_VISIBILITY,
  DEFAULT_PROVIDER_CAPABILITIES,
  DEFAULT_PROVIDER_CATALOGS,
} from '../constants';
import { Save, Lock, User as UserIcon, Mail, Link as LinkIcon, AlertTriangle, Key, Shield, MapPin, Store, CreditCard, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';
import { useStore } from '../contexts/StoreContext';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { storesService } from '../services/storesService';
import { profilesService } from '../services/profilesService';
import { authService } from '../services/authService';
import { integrationsService } from '../services/integrationsService';
import { providerCatalogService } from '../services/providerCatalogService';
import { providerConfigurationService } from '../services/providerConfigurationService';
import { buildProviderReadiness } from '../services/providerReadinessService';
import { featureFlagsService, resolveFeatureState } from '../services/featureFlagsService';
import { oauthConnectionService } from '../services/oauthConnectionService';
import { brandKitService } from '../services/brandKitService';
import { getErrorMessage } from '../services/errorMessage';
import { ModalPortal } from './ModalPortal';

interface SettingsViewProps {
  currentUser: User;
  onProfileUpdated?: (user: User) => void;
}

type ProviderCard = {
  catalog: ProviderCatalog;
  capability: ProviderCapability;
  configuration?: ProviderConfiguration;
  readiness: ProviderReadiness;
  isConnected: boolean;
};
type SettingsTab = 'PROFILE' | 'STORE' | 'INTEGRATIONS' | 'SYSTEM';

const FEATURE_FLAG_OPTIONS: { key: string; label: string; description: string }[] = [
  { key: 'dashboard', label: 'ダッシュボード', description: 'メニュー: ダッシュボード' },
  { key: 'calendar', label: 'カレンダー', description: 'メニュー: カレンダー' },
  { key: 'survey', label: 'アンケート', description: 'メニュー: アンケート' },
  { key: 'create_post', label: '新規投稿', description: 'メニュー: 新規投稿' },
  { key: 'post_list', label: '投稿一覧', description: 'メニュー: 投稿一覧' },
  { key: 'inbox', label: '統合受信箱', description: 'メニュー: 統合受信箱' },
  { key: 'rank_tracker', label: '順位計測', description: 'メニュー: 順位計測' },
  { key: 'user_management', label: 'ユーザー管理', description: 'メニュー: ユーザー・契約管理' },
  { key: 'settings_system', label: 'システム管理', description: '設定タブ: システム管理' },
  { key: 'provider_management', label: 'Provider管理', description: 'SNS連携設定タブの管理機能' },
];

const TEMPLATE_PLATFORM_OPTIONS: SocialPlatform[] = ['INSTAGRAM', 'FACEBOOK', 'GOOGLE_BUSINESS', 'TIKTOK'];

const TEMPLATE_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  GOOGLE_BUSINESS: 'Google Business Profile',
  TIKTOK: 'TikTok',
};

export const SettingsView: React.FC<SettingsViewProps> = ({ currentUser, onProfileUpdated }) => {
  const { addNotification } = useNotification();
  const { activeStoreId, reloadStores, stores } = useStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>('PROFILE');
  const lastProfileLoadErrorRef = useRef<string | null>(null);
  const lastStoreLoadErrorRef = useRef<string | null>(null);

  const getProfileSaveErrorMessage = (error: unknown) => {
    const rawMessage = typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: string }).message || '')
        : '';
    if (!rawMessage) return 'ユーザー情報の保存に失敗しました。';

    const message = rawMessage.toLowerCase();
    if (message.includes('invalid login credentials')) {
      return '現在のパスワードが正しくありません。';
    }
    if (message.includes('rate limit')) {
      return 'メール送信の上限に達しました。数分〜1時間ほど待ってから再試行してください（既に届いた確認メールがあればそちらで完了できます）。';
    }
    if (message.includes('already requested')) {
      return 'メール変更は既に申請されています。旧メールに届いた確認メールのリンクを先にクリックしてください。';
    }
    if (message.includes('email') && message.includes('already')) {
      return 'このメールアドレスは既に使用されています。';
    }
    return `ユーザー情報の保存に失敗しました。(${rawMessage})`;
  };

  const getStoreCreateLimitMessage = (error: unknown) => {
    const raw = getErrorMessage(error);
    const normalized = raw.toUpperCase();
    if (!normalized.includes('STORE_LIMIT_EXCEEDED')) return null;

    const current = raw.match(/current=(\d+)/i)?.[1];
    const limit = raw.match(/limit=(\d+)/i)?.[1];
    const shortage = raw.match(/shortage=(\d+)/i)?.[1];

    if (!current || !limit || !shortage) {
      return '店舗作成上限に達しています。管理者に上限変更を依頼してください。';
    }

    return `店舗作成上限に達しています。（現在 ${current}件 / 上限 ${limit}件 / 超過 ${shortage}件）`;
  };
  
  // Profile State
  const [name, setName] = useState(currentUser.name);
  const [email, setEmail] = useState(currentUser.email);
  const [newEmail, setNewEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Store Info State
  const [storeName, setStoreName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [businessHours, setBusinessHours] = useState('');
  const [category, setCategory] = useState('');
  const [isLoadingStore, setIsLoadingStore] = useState(false);
  const [isSavingStore, setIsSavingStore] = useState(false);

  const activeOrgId = useMemo(() => {
    if (!activeStoreId) return null;
    const store = stores.find((item) => item.id === activeStoreId);
    return store?.orgId || null;
  }, [activeStoreId, stores]);

  // Integrations / Provider State
  const [providerCards, setProviderCards] = useState<ProviderCard[]>([]);
  const [isLoadingIntegrations, setIsLoadingIntegrations] = useState(false);
  const [updatingIntegrationId, setUpdatingIntegrationId] = useState<string | null>(null);
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
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [providerConfigJson, setProviderConfigJson] = useState('{}');
  const [providerSecretInput, setProviderSecretInput] = useState('');
  const [isSavingProviderConfig, setIsSavingProviderConfig] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [oauthStateToken, setOauthStateToken] = useState('');
  const [oauthAuthorizationUrl, setOauthAuthorizationUrl] = useState('');
  const [oauthProviderLabel, setOauthProviderLabel] = useState('');
  const [oauthAuthCode, setOauthAuthCode] = useState('');
  const [isOAuthModalOpen, setIsOAuthModalOpen] = useState(false);
  const [isStartingOAuth, setIsStartingOAuth] = useState(false);
  const [isCompletingOAuth, setIsCompletingOAuth] = useState(false);
  const [isDisconnectingOAuth, setIsDisconnectingOAuth] = useState(false);

  // Feature flag state
  const [featureFlags, setFeatureFlags] = useState<FeatureFlag[]>([]);
  const [isLoadingFlags, setIsLoadingFlags] = useState(false);
  const [updatingFeatureKey, setUpdatingFeatureKey] = useState<string | null>(null);

  // System State (Admin Only)
  const [apiKey, setApiKey] = useState('****************************');
  const [brandKit, setBrandKit] = useState<BrandKit | null>(null);
  const [templates, setTemplates] = useState<PostContentTemplate[]>([]);
  const [isLoadingBrandAssets, setIsLoadingBrandAssets] = useState(false);
  const [isSavingBrandKit, setIsSavingBrandKit] = useState(false);
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);
  const [removingTemplateId, setRemovingTemplateId] = useState<string | null>(null);
  const [toneGuideInput, setToneGuideInput] = useState('');
  const [bannedWordsInput, setBannedWordsInput] = useState('');
  const [recommendedHashtagsInput, setRecommendedHashtagsInput] = useState('');
  const [signatureInput, setSignatureInput] = useState('');
  const [templateTitleInput, setTemplateTitleInput] = useState('');
  const [templateBodyInput, setTemplateBodyInput] = useState('');
  const [templatePlatforms, setTemplatePlatforms] = useState<SocialPlatform[]>([]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      addNotification('入力エラー', '表示名を入力してください。', 'WARNING');
      return;
    }

    const trimmedCurrentPassword = currentPassword.trim();
    const trimmedNewPassword = newPassword.trim();
    const trimmedNewEmail = newEmail.trim();
    const trimmedEmail = email.trim();

    const wantsPasswordChange = trimmedNewPassword.length > 0;
    const wantsEmailChange = trimmedNewEmail.length > 0 && trimmedNewEmail !== trimmedEmail;
    const hasCurrentPassword = trimmedCurrentPassword.length > 0;

    if ((wantsPasswordChange || wantsEmailChange) && !hasCurrentPassword) {
      addNotification('入力エラー', '現在のパスワードを入力してください。', 'WARNING');
      return;
    }
    if (hasCurrentPassword && !wantsPasswordChange && !wantsEmailChange) {
      addNotification('入力エラー', '変更内容がありません。', 'WARNING');
      return;
    }
    if (wantsPasswordChange && trimmedNewPassword.length < 6) {
      addNotification('入力エラー', '新しいパスワードは6文字以上で入力してください。', 'WARNING');
      return;
    }
    if (wantsEmailChange) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedNewEmail)) {
        addNotification('入力エラー', '新しいメールアドレスの形式が正しくありません。', 'WARNING');
        return;
      }
    }

    if (!isSupabaseConfigured) {
      addNotification('プロフィール更新', 'Supabase未設定のため変更できません。', 'INFO');
      return;
    }

    setIsSavingProfile(true);
    try {
      if (wantsPasswordChange) {
        try {
          await authService.changePassword(trimmedCurrentPassword, trimmedNewPassword);
          setCurrentPassword('');
          setNewPassword('');
          addNotification('パスワード更新', 'パスワードを更新しました。', 'SUCCESS');
        } catch (error) {
          addNotification('パスワード更新エラー', getProfileSaveErrorMessage(error), 'ERROR');
        }
      }

      if (wantsEmailChange) {
        try {
          await authService.changeEmail(trimmedCurrentPassword, trimmedNewEmail);
          setNewEmail('');
          addNotification('メール変更', '確認メールを送信しました。リンクをクリックして完了してください。', 'INFO');
        } catch (error) {
          addNotification('メール変更エラー', getProfileSaveErrorMessage(error), 'ERROR');
        }
      }

      const nextEmail = trimmedEmail ? trimmedEmail : '';
      const profile = await profilesService.upsertProfile(currentUser.id, {
        name: name.trim(),
        email: nextEmail ? nextEmail : null,
        avatarUrl: currentUser.avatarUrl ?? null,
      });
      const updatedUser: User = {
        ...currentUser,
        name: profile.name || name.trim(),
        email: profile.email || nextEmail || trimmedEmail,
        avatarUrl: profile.avatarUrl || currentUser.avatarUrl,
      };
      setName(updatedUser.name);
      setEmail(updatedUser.email);
      onProfileUpdated?.(updatedUser);
      addNotification('プロフィール更新', 'ユーザー情報を保存しました。', 'SUCCESS');
    } catch (error) {
      addNotification('保存エラー', getProfileSaveErrorMessage(error), 'ERROR');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleSaveStore = (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeName.trim()) {
      addNotification('入力エラー', '店舗名を入力してください。', 'WARNING');
      return;
    }
    if (!isSupabaseConfigured) {
      addNotification('店舗情報更新', 'Supabase未設定のためローカル表示のみ更新しました。', 'INFO');
      return;
    }

    const normalizeText = (value: string) => {
      const trimmed = value.trim();
      return trimmed.length === 0 ? null : trimmed;
    };

    setIsSavingStore(true);
    const isCreateMode = !activeStoreId;
    const request = isCreateMode
      ? storesService.createStore({
          name: storeName.trim(),
          address: normalizeText(address) || undefined,
          phone: normalizeText(phone) || undefined,
          category: normalizeText(category) || undefined,
          businessHours: normalizeText(businessHours) || undefined,
          orgId: activeOrgId || undefined,
          orgName: `${currentUser.name} の組織`,
        })
      : storesService.updateStore(activeStoreId, {
          name: storeName.trim(),
          address: normalizeText(address),
          phone: normalizeText(phone),
          category: normalizeText(category),
          businessHours: normalizeText(businessHours),
        });

    request
      .then(async (updated) => {
        setStoreName(updated.name);
        setAddress(updated.address || '');
        setPhone(updated.phone || '');
        setCategory(updated.category || '');
        setBusinessHours(updated.businessHours || '');
        await reloadStores();
        addNotification(
          isCreateMode ? '店舗作成完了' : '店舗情報更新',
          isCreateMode ? '新しい店舗を作成しました。' : 'MEO対策用の店舗情報を更新しました。',
          'SUCCESS'
        );
      })
      .catch((error) => {
        const limitMessage = getStoreCreateLimitMessage(error);
        if (limitMessage) {
          addNotification('店舗上限エラー', limitMessage, 'ERROR');
          return;
        }
        const message = getErrorMessage(error);
        console.error('[SettingsView] Failed to save store:', error);
        addNotification(
          isCreateMode ? '店舗作成エラー' : '保存エラー',
          `店舗情報の保存に失敗しました。${message ? `（${message}）` : ''}`,
          'ERROR'
        );
      })
      .finally(() => {
        setIsSavingStore(false);
      });
  };

  useEffect(() => {
    const loadProfile = async () => {
      if (!isSupabaseConfigured) {
        setName(currentUser.name);
        setEmail(currentUser.email);
        setNewEmail('');
        return;
      }

      setIsLoadingProfile(true);
      try {
        const profile = await profilesService.getProfile(currentUser.id);
        setName(profile?.name || currentUser.name);
        setEmail(profile?.email || currentUser.email);
        setNewEmail('');
      } catch (error) {
        const message = getErrorMessage(error);
        if (lastProfileLoadErrorRef.current !== message) {
          lastProfileLoadErrorRef.current = message;
          console.error('[SettingsView] Failed to load profile:', error);
          addNotification('読み込みエラー', `プロフィール情報の取得に失敗しました。${message ? `（${message}）` : ''}`, 'ERROR');
        }
      } finally {
        setIsLoadingProfile(false);
      }
    };

    void loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.id]);

  useEffect(() => {
    const loadStoreInfo = async () => {
      if (!activeStoreId) {
        setStoreName('');
        setAddress('');
        setPhone('');
        setCategory('');
        setBusinessHours('');
        return;
      }

      if (!isSupabaseConfigured) {
        setStoreName('TEPPEN総本店');
        setAddress(currentUser.storeInfo?.address || '');
        setPhone(currentUser.storeInfo?.phone || '');
        setCategory(currentUser.storeInfo?.category || '');
        setBusinessHours(currentUser.storeInfo?.businessHours || '');
        return;
      }

      setIsLoadingStore(true);
      try {
        const store = await storesService.getById(activeStoreId);
        if (store) {
          setStoreName(store.name);
          setAddress(store.address || '');
          setPhone(store.phone || '');
          setCategory(store.category || '');
          setBusinessHours(store.businessHours || '');
        } else {
          addNotification('店舗情報', '店舗データが見つかりません。', 'WARNING');
        }
      } catch (error) {
        const message = getErrorMessage(error);
        if (lastStoreLoadErrorRef.current !== message) {
          lastStoreLoadErrorRef.current = message;
          console.error('[SettingsView] Failed to load store:', error);
          addNotification('読み込みエラー', `店舗情報の取得に失敗しました。${message ? `（${message}）` : ''}`, 'ERROR');
        }
      } finally {
        setIsLoadingStore(false);
      }
    };

    void loadStoreInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStoreId]);

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

  const loadProviderCards = async () => {
    if (!isSupabaseConfigured) {
      setProviderCards(fallbackProviderCards);
      return;
    }
    if (!activeOrgId) {
      setProviderCards([]);
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
          isConnected: integrationMap.get(row.catalog.providerKey) ?? configuration?.connectionStatus === 'CONNECTED',
        };
      });
      setProviderCards(nextCards);
      if (!selectedProviderId && nextCards.length > 0) {
        setSelectedProviderId(nextCards[0].catalog.id);
      }
    } catch (error) {
      console.error('[SettingsView] Failed to load provider cards:', error);
      addNotification('読み込みエラー', 'Provider設定の取得に失敗しました。', 'ERROR');
    } finally {
      setIsLoadingIntegrations(false);
    }
  };

  useEffect(() => {
    void loadProviderCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStoreId, activeOrgId]);

  useEffect(() => {
    const loadFlags = async () => {
      if (!isSupabaseConfigured || !activeOrgId) {
        setFeatureFlags([]);
        return;
      }
      setIsLoadingFlags(true);
      try {
        const rows = await featureFlagsService.listByOrg(activeOrgId, activeStoreId || undefined);
        setFeatureFlags(rows);
      } catch (error) {
        console.error('[SettingsView] Failed to load feature flags:', error);
        addNotification('読み込みエラー', '機能公開設定の取得に失敗しました。', 'ERROR');
      } finally {
        setIsLoadingFlags(false);
      }
    };
    void loadFlags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId, activeStoreId]);

  const applyBrandKitInputs = (nextBrandKit: BrandKit | null) => {
    setToneGuideInput(nextBrandKit?.toneGuide || '');
    setBannedWordsInput((nextBrandKit?.bannedWords || []).join(', '));
    setRecommendedHashtagsInput((nextBrandKit?.recommendedHashtags || []).join(', '));
    setSignatureInput(nextBrandKit?.defaultSignature || '');
  };

  const loadBrandAssets = async () => {
    if (!isSupabaseConfigured || !activeOrgId || currentUser.role !== Role.ADMIN) {
      setBrandKit(null);
      setTemplates([]);
      applyBrandKitInputs(null);
      setTemplateTitleInput('');
      setTemplateBodyInput('');
      setTemplatePlatforms([]);
      return;
    }

    setIsLoadingBrandAssets(true);
    try {
      const [kit, templateRows] = await Promise.all([
        brandKitService.getBrandKit(activeOrgId),
        brandKitService.listTemplates(activeOrgId),
      ]);
      setBrandKit(kit);
      setTemplates(templateRows);
      applyBrandKitInputs(kit);
      setTemplateTitleInput('');
      setTemplateBodyInput('');
      setTemplatePlatforms([]);
    } catch (error) {
      console.error('[SettingsView] Failed to load brand assets:', error);
      addNotification('読み込みエラー', `ブランドキット/テンプレートの取得に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    } finally {
      setIsLoadingBrandAssets(false);
    }
  };

  useEffect(() => {
    void loadBrandAssets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId, currentUser.role]);

  const closeOAuthModal = (force = false) => {
    if (isCompletingOAuth && !force) return;
    setIsOAuthModalOpen(false);
    setOauthStateToken('');
    setOauthAuthorizationUrl('');
    setOauthProviderLabel('');
    setOauthAuthCode('');
  };

  const handleToggleConnection = (providerCatalogId: string) => {
    const target = providerCards.find((card) => card.catalog.id === providerCatalogId);
    if (!target) return;

    if (!isSupabaseConfigured) {
      addNotification('未設定', 'Supabase未設定のため、連携状態を変更できません。', 'WARNING');
      return;
    }

    if (!activeStoreId) {
      addNotification('店舗未選択', '店舗が選択されていません。', 'WARNING');
      return;
    }

    if (target.catalog.authKind === 'OAUTH2') {
      if (target.isConnected) {
        setIsDisconnectingOAuth(true);
        oauthConnectionService
          .disconnect({
            storeId: activeStoreId,
            providerKey: target.catalog.providerKey,
          })
          .then(() => {
            addNotification('OAuth連携解除', `${target.catalog.displayName} のOAuth連携を解除しました。`, 'INFO');
          })
          .catch((error) => {
            console.error('[SettingsView] Failed to disconnect OAuth provider:', error);
            addNotification('連携解除エラー', `OAuth連携の解除に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
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
        })
        .then((result) => {
          setOauthStateToken(result.stateToken);
          setOauthAuthorizationUrl(result.authorizationUrl);
          setOauthProviderLabel(target.catalog.displayName);
          setOauthAuthCode('');
          setIsOAuthModalOpen(true);
          addNotification('OAuth開始', `${target.catalog.displayName} の認可セッションを開始しました。`, 'INFO');
        })
        .catch((error) => {
          console.error('[SettingsView] Failed to start OAuth provider flow:', error);
          addNotification('OAuth開始エラー', `OAuth開始に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
        })
        .finally(() => {
          setIsStartingOAuth(false);
        });
      return;
    }

    setUpdatingIntegrationId(providerCatalogId);
    integrationsService
      .setConnection(activeStoreId, target.catalog.providerKey, !target.isConnected)
      .then((updated) => {
        addNotification(
          updated.isConnected ? '連携完了' : '連携解除',
          `${target.catalog.displayName}との連携を${updated.isConnected ? '開始' : '解除'}しました。`,
          updated.isConnected ? 'SUCCESS' : 'INFO'
        );
      })
      .catch((error) => {
        console.error('[SettingsView] Failed to update integration connection:', error);
        addNotification('連携エラー', '連携状態の更新に失敗しました。', 'ERROR');
      })
      .finally(async () => {
        setUpdatingIntegrationId(null);
        await loadProviderCards();
      });
  };

  const handleCompleteOAuth = async () => {
    if (!oauthStateToken) {
      addNotification('OAuthエラー', 'state token が見つかりません。連携をやり直してください。', 'ERROR');
      return;
    }
    if (!oauthAuthCode.trim()) {
      addNotification('入力エラー', '認可コードを入力してください。', 'WARNING');
      return;
    }

    setIsCompletingOAuth(true);
    try {
      await oauthConnectionService.complete({
        stateToken: oauthStateToken,
        authCode: oauthAuthCode.trim(),
      });
      addNotification('OAuth連携完了', `${oauthProviderLabel || 'Provider'} の接続が完了しました。`, 'SUCCESS');
      closeOAuthModal(true);
      await loadProviderCards();
    } catch (error) {
      console.error('[SettingsView] Failed to complete OAuth provider flow:', error);
      addNotification('OAuth完了エラー', `OAuth連携の完了に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    } finally {
      setIsCompletingOAuth(false);
    }
  };

  const handleCreateProvider = async () => {
    if (!isSupabaseConfigured) {
      addNotification('未設定', 'Supabase未設定のため、Providerを追加できません。', 'WARNING');
      return;
    }
    if (!activeOrgId) {
      addNotification('組織未選択', '店舗を選択してからProviderを追加してください。', 'WARNING');
      return;
    }
    if (!newProviderKey.trim() || !newProviderName.trim()) {
      addNotification('入力エラー', 'Provider key と表示名を入力してください。', 'WARNING');
      return;
    }
    const normalizedKey = newProviderKey.trim().toUpperCase();
    if (!/^[A-Z0-9_]+$/.test(normalizedKey)) {
      addNotification('入力エラー', 'Provider key は英大文字・数字・アンダースコアのみ使用できます。', 'WARNING');
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
      addNotification('Provider追加', `${normalizedKey} を追加しました。`, 'SUCCESS');
      setNewProviderKey('');
      setNewProviderName('');
      setNewProviderKind('GENERIC');
      setNewProviderAuthKind('API_KEY');
      setNewProviderVisibility('ADMIN_ONLY');
      setNewCanConnect(true);
      setNewCanSyncInbox(true);
      setNewCanPublish(false);
      setNewCanReply(false);
      setNewCanFetchMetrics(false);
      await loadProviderCards();
    } catch (error) {
      console.error('[SettingsView] Failed to create provider:', error);
      addNotification('追加エラー', `Provider追加に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    } finally {
      setIsCreatingProvider(false);
    }
  };

  const handleChangeProviderVisibility = async (providerCatalogId: string, visibility: VisibilityState) => {
    try {
      await providerCatalogService.updateVisibility(providerCatalogId, visibility);
      addNotification('公開状態更新', 'Providerの公開状態を更新しました。', 'SUCCESS');
      await loadProviderCards();
    } catch (error) {
      console.error('[SettingsView] Failed to update provider visibility:', error);
      addNotification('更新エラー', `公開状態の更新に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    }
  };

  const selectedProviderCard = useMemo(() => {
    return providerCards.find((card) => card.catalog.id === selectedProviderId) || null;
  }, [providerCards, selectedProviderId]);

  useEffect(() => {
    if (providerCards.length === 0) {
      if (selectedProviderId) setSelectedProviderId('');
      return;
    }
    const exists = providerCards.some((card) => card.catalog.id === selectedProviderId);
    if (!exists) {
      setSelectedProviderId(providerCards[0].catalog.id);
    }
  }, [providerCards, selectedProviderId]);

  useEffect(() => {
    if (!selectedProviderCard) {
      setProviderConfigJson('{}');
      setProviderSecretInput('');
      return;
    }
    setProviderConfigJson(JSON.stringify(selectedProviderCard.configuration?.config || {}, null, 2));
    setProviderSecretInput('');
  }, [selectedProviderCard]);

  const handleSaveProviderConfiguration = async () => {
    if (!isSupabaseConfigured) {
      addNotification('未設定', 'Supabase未設定のため、Provider設定を保存できません。', 'WARNING');
      return;
    }
    if (!activeStoreId) {
      addNotification('店舗未選択', '店舗が選択されていません。', 'WARNING');
      return;
    }
    if (!selectedProviderCard) {
      addNotification('選択エラー', 'Providerを選択してください。', 'WARNING');
      return;
    }
    let parsedConfig: Record<string, unknown> = {};
    try {
      parsedConfig = providerConfigJson.trim() ? (JSON.parse(providerConfigJson) as Record<string, unknown>) : {};
    } catch {
      addNotification('入力エラー', '設定JSONの形式が不正です。', 'WARNING');
      return;
    }

    setIsSavingProviderConfig(true);
    try {
      const configuration = await providerConfigurationService.upsertConfiguration({
        storeId: activeStoreId,
        providerCatalogId: selectedProviderCard.catalog.id,
        config: parsedConfig,
        updatedBy: currentUser.id,
      });
      if (providerSecretInput.trim().length > 0) {
        await providerConfigurationService.upsertSecret({
          providerConfigurationId: configuration.id,
          secret: providerSecretInput.trim(),
        });
      }
      addNotification('設定更新', `${selectedProviderCard.catalog.displayName} の設定を保存しました。`, 'SUCCESS');
      await loadProviderCards();
    } catch (error) {
      console.error('[SettingsView] Failed to save provider configuration:', error);
      addNotification('保存エラー', `Provider設定の保存に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    } finally {
      setIsSavingProviderConfig(false);
      setProviderSecretInput('');
    }
  };

  const handleTestProviderConnection = async () => {
    if (!isSupabaseConfigured) {
      addNotification('未設定', 'Supabase未設定のため、接続テストを実行できません。', 'WARNING');
      return;
    }
    if (!selectedProviderCard) {
      addNotification('選択エラー', 'Providerを選択してください。', 'WARNING');
      return;
    }
    if (!selectedProviderCard.configuration?.id) {
      addNotification('未設定', '先に設定を保存してください。', 'WARNING');
      return;
    }
    setIsTestingConnection(true);
    try {
      const status = await providerConfigurationService.testConnection({
        providerConfigurationId: selectedProviderCard.configuration.id,
      });
      addNotification('接続テスト', `${selectedProviderCard.catalog.displayName} の接続状態: ${status}`, status === 'CONNECTED' ? 'SUCCESS' : 'WARNING');
      await loadProviderCards();
    } catch (error) {
      console.error('[SettingsView] Failed to test provider connection:', error);
      addNotification('接続テストエラー', `接続テストに失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleUpdateFeatureFlag = async (featureKey: string, nextState: VisibilityState) => {
    if (!activeOrgId) {
      addNotification('組織未選択', '店舗を選択してから更新してください。', 'WARNING');
      return;
    }
    setUpdatingFeatureKey(featureKey);
    try {
      await featureFlagsService.upsert({
        orgId: activeOrgId,
        featureKey,
        state: nextState,
        updatedBy: currentUser.id,
      });
      const rows = await featureFlagsService.listByOrg(activeOrgId, activeStoreId || undefined);
      setFeatureFlags(rows);
      addNotification('公開状態更新', `${featureKey} を ${nextState} に更新しました。`, 'SUCCESS');
    } catch (error) {
      console.error('[SettingsView] Failed to update feature flag:', error);
      addNotification('更新エラー', `機能公開状態の更新に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    } finally {
      setUpdatingFeatureKey(null);
    }
  };

  const toggleTemplatePlatform = (platform: SocialPlatform) => {
    setTemplatePlatforms((prev) => (
      prev.includes(platform)
        ? prev.filter((value) => value !== platform)
        : [...prev, platform]
    ));
  };

  const handleSaveBrandKit = async () => {
    if (!isSupabaseConfigured) {
      addNotification('未設定', 'Supabase未設定のため保存できません。', 'WARNING');
      return;
    }
    if (!activeOrgId) {
      addNotification('組織未選択', '店舗を選択してから保存してください。', 'WARNING');
      return;
    }

    setIsSavingBrandKit(true);
    try {
      const updated = await brandKitService.upsertBrandKit({
        orgId: activeOrgId,
        toneGuide: toneGuideInput,
        bannedWords: brandKitService.parseListInput(bannedWordsInput),
        recommendedHashtags: brandKitService.parseListInput(recommendedHashtagsInput),
        defaultSignature: signatureInput,
        updatedBy: currentUser.id,
      });
      setBrandKit(updated);
      applyBrandKitInputs(updated);
      addNotification('ブランドキット更新', 'ブランドキットを保存しました。', 'SUCCESS');
    } catch (error) {
      console.error('[SettingsView] Failed to save brand kit:', error);
      addNotification('保存エラー', `ブランドキットの保存に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    } finally {
      setIsSavingBrandKit(false);
    }
  };

  const handleCreateTemplate = async () => {
    if (!isSupabaseConfigured) {
      addNotification('未設定', 'Supabase未設定のため作成できません。', 'WARNING');
      return;
    }
    if (!activeOrgId) {
      addNotification('組織未選択', '店舗を選択してから作成してください。', 'WARNING');
      return;
    }
    if (!templateTitleInput.trim() || !templateBodyInput.trim()) {
      addNotification('入力エラー', 'テンプレート名と本文を入力してください。', 'WARNING');
      return;
    }

    setIsCreatingTemplate(true);
    try {
      const created = await brandKitService.createTemplate({
        orgId: activeOrgId,
        title: templateTitleInput.trim(),
        body: templateBodyInput.trim(),
        defaultPlatforms: Array.from(new Set(templatePlatforms)),
        createdBy: currentUser.id,
      });
      setTemplates((prev) => [created, ...prev]);
      setTemplateTitleInput('');
      setTemplateBodyInput('');
      setTemplatePlatforms([]);
      addNotification('テンプレート作成', 'テンプレートを作成しました。', 'SUCCESS');
    } catch (error) {
      console.error('[SettingsView] Failed to create template:', error);
      addNotification('作成エラー', `テンプレートの作成に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    } finally {
      setIsCreatingTemplate(false);
    }
  };

  const handleRemoveTemplate = async (templateId: string) => {
    setRemovingTemplateId(templateId);
    try {
      await brandKitService.removeTemplate(templateId);
      setTemplates((prev) => prev.filter((template) => template.id !== templateId));
      addNotification('テンプレート削除', 'テンプレートを削除しました。', 'INFO');
    } catch (error) {
      console.error('[SettingsView] Failed to remove template:', error);
      addNotification('削除エラー', `テンプレートの削除に失敗しました。${getErrorMessage(error) ? `（${getErrorMessage(error)}）` : ''}`, 'ERROR');
    } finally {
      setRemovingTemplateId(null);
    }
  };

  const visibleProviderCards = useMemo(() => {
    return providerCards.filter((card) => {
      if (currentUser.role === Role.ADMIN) return true;
      return card.catalog.defaultVisibility === 'ENABLED';
    });
  }, [currentUser.role, providerCards]);

  const canAccessByFlag = (featureKey: string) => {
    const state = resolveFeatureState(featureFlags, featureKey, activeStoreId || undefined);
    if (state === 'HIDDEN') return false;
    if (state === 'ADMIN_ONLY') return currentUser.role === Role.ADMIN;
    return true;
  };

  const canShowProfileTab = canAccessByFlag('settings_profile');
  const canShowStoreTab = canAccessByFlag('settings_store');
  const canShowIntegrationsTab = canAccessByFlag('settings_integrations');
  const canShowSystemTab = currentUser.role === Role.ADMIN && canAccessByFlag('settings_system');
  const canManageProviders = currentUser.role === Role.ADMIN && canAccessByFlag('provider_management');
  const integrationDisabledReason = !isSupabaseConfigured
    ? 'Supabase未設定のため操作できません。VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を設定してください。'
    : !activeStoreId
      ? '店舗未選択です。店舗情報(MEO)で店舗作成後に選択してください。'
      : null;
  const createProviderDisabledReason = !isSupabaseConfigured
    ? 'Supabase未設定のため追加できません。'
    : !activeOrgId
      ? '店舗選択後に追加できます。'
      : null;
  const saveProviderDisabledReason = !isSupabaseConfigured
    ? 'Supabase未設定のため保存できません。'
    : !selectedProviderCard
      ? 'Providerを選択してください。'
      : !activeStoreId
        ? '店舗選択後に保存できます。'
        : null;
  const testProviderDisabledReason = !isSupabaseConfigured
    ? 'Supabase未設定のため接続テストできません。'
    : !selectedProviderCard
      ? 'Providerを選択してください。'
      : !selectedProviderCard.configuration?.id
        ? '先に「設定を保存」を実行してください。'
        : null;
  const brandAssetDisabledReason = !isSupabaseConfigured
    ? 'Supabase未設定のため保存できません。'
    : !activeOrgId
      ? '店舗を選択してから操作してください。'
      : null;
  const visibleTabs = useMemo<SettingsTab[]>(() => {
    const tabs: SettingsTab[] = [];
    if (canShowProfileTab) tabs.push('PROFILE');
    if (canShowStoreTab) tabs.push('STORE');
    if (canShowIntegrationsTab) tabs.push('INTEGRATIONS');
    if (canShowSystemTab) tabs.push('SYSTEM');
    return tabs;
  }, [canShowProfileTab, canShowStoreTab, canShowIntegrationsTab, canShowSystemTab]);

  useEffect(() => {
    if (visibleTabs.length === 0) return;
    if (!visibleTabs.includes(activeTab)) {
      setActiveTab(visibleTabs[0]);
    }
  }, [activeTab, visibleTabs]);

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-white">設定</h1>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden flex flex-col md:flex-row min-h-[600px]">
        {/* Sidebar */}
        <div className="w-full md:w-64 bg-gray-50 dark:bg-gray-900/50 border-r border-gray-100 dark:border-gray-700 p-4">
          <nav className="space-y-2">
            {canShowProfileTab && (
              <button
                data-testid="settings-tab-profile"
                onClick={() => setActiveTab('PROFILE')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  activeTab === 'PROFILE' 
                    ? 'bg-white dark:bg-gray-800 text-primary-600 shadow-sm font-semibold' 
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <UserIcon size={18} />
                <span>プロフィール・プラン</span>
              </button>
            )}
            {canShowStoreTab && (
              <button
                data-testid="settings-tab-store"
                onClick={() => setActiveTab('STORE')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  activeTab === 'STORE' 
                    ? 'bg-white dark:bg-gray-800 text-primary-600 shadow-sm font-semibold' 
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <Store size={18} />
                <span>店舗情報 (MEO)</span>
              </button>
            )}
            {canShowIntegrationsTab && (
              <button
                data-testid="settings-tab-integrations"
                onClick={() => setActiveTab('INTEGRATIONS')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  activeTab === 'INTEGRATIONS' 
                    ? 'bg-white dark:bg-gray-800 text-primary-600 shadow-sm font-semibold' 
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <LinkIcon size={18} />
                <span>SNS連携設定</span>
              </button>
            )}
            {canShowSystemTab && (
              <button
                data-testid="settings-tab-system"
                onClick={() => setActiveTab('SYSTEM')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  activeTab === 'SYSTEM' 
                    ? 'bg-white dark:bg-gray-800 text-primary-600 shadow-sm font-semibold' 
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <Shield size={18} />
                <span>システム管理</span>
              </button>
            )}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 p-8 overflow-y-auto">
          {activeTab === 'PROFILE' && (
            <div className="max-w-2xl space-y-8">
               {/* Plan Info */}
               <div className="bg-gradient-to-r from-primary-600 to-primary-500 rounded-2xl p-6 text-white shadow-lg">
                   <div className="flex justify-between items-start">
                       <div>
                           <p className="text-primary-100 text-sm font-medium mb-1">現在のプラン</p>
                           <h3 className="text-2xl font-bold">{currentUser.plan || 'FREE'} PLAN</h3>
                           <p className="text-sm text-primary-100 mt-2">次回更新日: 2024年12月31日</p>
                       </div>
                       <CreditCard className="text-primary-200 w-12 h-12 opacity-50" />
                   </div>
               </div>

              <div>
                <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-1">基本情報</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">アカウントの表示名や連絡先情報を管理します。</p>
              </div>

              <form onSubmit={handleSaveProfile} className="space-y-6">
                <div className="flex items-center gap-6">
                  <img 
                    src={currentUser.avatarUrl} 
                    alt="avatar" 
                    className="w-20 h-20 rounded-full object-cover border-4 border-gray-100 dark:border-gray-700 shadow-sm"
                  />
                  <button type="button" className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors">
                    画像を変更
                  </button>
                </div>

                <div className="grid gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">表示名</label>
                    <div className="relative">
                      <UserIcon className="absolute left-3 top-3 text-gray-400" size={18} />
                      <input 
                        type="text" 
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={isLoadingProfile || isSavingProfile}
                        className="pl-10 w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">メールアドレス</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 text-gray-400" size={18} />
                      <input 
                        type="email" 
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled
                        className="pl-10 w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">※ログイン用メールは下で変更できます（確認メールで確定）。</p>
                  </div>
                </div>

                <div className="pt-6 border-t border-gray-100 dark:border-gray-700">
                   <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-4">メールアドレス変更</h3>
                   <div className="grid gap-4 mb-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">新しいメールアドレス</label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-3 text-gray-400" size={18} />
                          <input 
                            type="email" 
                            value={newEmail}
                            onChange={(e) => setNewEmail(e.target.value)}
                            placeholder="example@domain.com"
                            disabled={isSavingProfile}
                            className="pl-10 w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                          />
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">※変更には現在のパスワードが必要です。</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">※確認メールは現在のメールアドレスに届きます。</p>
                      </div>
                   </div>

                   <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-4">パスワード変更</h3>
                   <div className="grid gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">現在のパスワード</label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-3 text-gray-400" size={18} />
                          <input 
                            type="password" 
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            disabled={isSavingProfile}
                            className="pl-10 w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">新しいパスワード</label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-3 text-gray-400" size={18} />
                          <input 
                            type="password" 
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            disabled={isSavingProfile}
                            className="pl-10 w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                          />
                        </div>
                      </div>
                   </div>
                </div>

                <div className="flex justify-end pt-4">
                  <button
                    type="submit"
                    disabled={isLoadingProfile || isSavingProfile}
                    className="flex items-center gap-2 px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-xl shadow-lg shadow-primary-200 dark:shadow-none transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <Save size={18} />
                    {isSavingProfile ? '保存中...' : '保存する'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'STORE' && (
              <div className="max-w-2xl space-y-8">
                  <div>
                    <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-1">店舗情報設定</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Googleマップ等に反映される正確な店舗情報を入力してください。</p>
                  </div>
                  {!activeStoreId && (
                    <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-200 text-sm rounded-xl p-4">
                      店舗が未作成です。下のフォームで最初の店舗を作成してください。
                    </div>
                  )}
                  {isLoadingStore && (
                    <div className="text-sm text-gray-500 dark:text-gray-400">店舗情報を読み込み中...</div>
                  )}

                  <form onSubmit={handleSaveStore} className="space-y-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">店舗名 (NAP: Name)</label>
                        <input 
                            type="text" 
                            value={storeName}
                            onChange={(e) => setStoreName(e.target.value)}
                            disabled={isLoadingStore || isSavingStore}
                            className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">住所 (NAP: Address)</label>
                        <div className="relative">
                            <MapPin className="absolute left-3 top-3 text-gray-400" size={18} />
                            <input 
                                type="text" 
                                value={address}
                                onChange={(e) => setAddress(e.target.value)}
                                placeholder="例: 東京都港区六本木..."
                                disabled={isLoadingStore || isSavingStore}
                                className="pl-10 w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                            />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">電話番号 (NAP: Phone)</label>
                            <input 
                                type="text" 
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                placeholder="03-xxxx-xxxx"
                                disabled={isLoadingStore || isSavingStore}
                                className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">カテゴリ</label>
                            <input 
                                type="text" 
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                placeholder="例: イタリア料理店"
                                disabled={isLoadingStore || isSavingStore}
                                className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                            />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">営業時間</label>
                        <textarea 
                            value={businessHours}
                            onChange={(e) => setBusinessHours(e.target.value)}
                            placeholder="月: 10:00-19:00&#10;火: 10:00-19:00..."
                            disabled={isLoadingStore || isSavingStore}
                            className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all h-32"
                        />
                      </div>

                      <div className="flex justify-end pt-4">
                        <button
                          type="submit"
                          disabled={isLoadingStore || isSavingStore}
                          className="flex items-center gap-2 px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-xl shadow-lg shadow-primary-200 dark:shadow-none transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            <Save size={18} />
                            {isSavingStore ? '保存中...' : activeStoreId ? '店舗情報を保存' : '店舗を作成'}
                        </button>
                    </div>
                  </form>
              </div>
          )}

          {activeTab === 'INTEGRATIONS' && (
            <div className="max-w-5xl space-y-6">
              <div>
                <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-1">Provider連携設定</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">store単位で接続状態を管理し、検証モードと本番モードを可視化します。</p>
              </div>
              {!isSupabaseConfigured && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 text-sm rounded-xl p-4">
                  Supabase未接続です。`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` を設定して再起動してください。未接続中はモック表示になり、連携ボタンや保存ボタンは無効化されます。
                </div>
              )}
              {isSupabaseConfigured && !activeStoreId && (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-200 text-sm rounded-xl p-4">
                  店舗が選択されていません。右上の店舗セレクタで選択するか、先に「店舗情報(MEO)」で店舗を作成してください。
                </div>
              )}
              {isLoadingIntegrations && (
                <div className="text-sm text-gray-500 dark:text-gray-400">連携状態を読み込み中...</div>
              )}

              <div className="grid gap-4">
                {visibleProviderCards.map((provider) => (
                  <div
                    key={provider.catalog.id}
                    data-testid={`provider-card-${provider.catalog.providerKey}`}
                    data-provider-key={provider.catalog.providerKey}
                    onClick={() => setSelectedProviderId(provider.catalog.id)}
                    className={`p-5 bg-white dark:bg-gray-700 border rounded-2xl shadow-sm transition-all cursor-pointer ${
                      selectedProviderId === provider.catalog.id
                        ? 'border-primary-300 ring-1 ring-primary-200 dark:border-primary-500 dark:ring-primary-900/40'
                        : 'border-gray-100 dark:border-gray-600'
                    }`}
                    title="クリックでこのProviderを下の設定パネルで編集します。"
                  >
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-gray-800 dark:text-white">{provider.catalog.displayName}</h3>
                          <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600">
                            {provider.catalog.providerKey}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600">
                            {provider.catalog.providerKind}
                          </span>
                          {canManageProviders && (
                            <span className="text-xs px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700">
                              公開: {provider.catalog.defaultVisibility}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          auth: {provider.catalog.authKind} / test: {provider.readiness.testMode} / runtime: {provider.readiness.runtimeMode}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          connection: {provider.configuration?.connectionStatus || 'DISCONNECTED'}
                          {provider.configuration?.lastError ? ` / error: ${provider.configuration.lastError}` : ''}
                        </p>
                        <p
                          data-testid={`provider-connection-status-${provider.catalog.providerKey}`}
                          className="sr-only"
                        >
                          {provider.configuration?.connectionStatus || 'DISCONNECTED'}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {(() => {
                          const isConnectionUpdating =
                            updatingIntegrationId === provider.catalog.id ||
                            (provider.catalog.authKind === 'OAUTH2' && (isStartingOAuth || isDisconnectingOAuth));
                          return (
                            <>
                        {canManageProviders && (
                          <select
                            data-testid={`provider-visibility-${provider.catalog.providerKey}`}
                            value={provider.catalog.defaultVisibility}
                            onChange={(e) => void handleChangeProviderVisibility(provider.catalog.id, e.target.value as VisibilityState)}
                            className="px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg"
                          >
                            <option value="HIDDEN">HIDDEN</option>
                            <option value="ADMIN_ONLY">ADMIN_ONLY</option>
                            <option value="ENABLED">ENABLED</option>
                          </select>
                        )}
                        {provider.isConnected ? (
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
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                ))}
                {!isLoadingIntegrations && visibleProviderCards.length === 0 && (
                  <div className="text-sm text-gray-500 dark:text-gray-400">表示可能なproviderがありません。</div>
                )}
              </div>

              {canManageProviders && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 pt-4 border-t border-gray-100 dark:border-gray-700">
                  <div className="p-5 bg-gray-50 dark:bg-gray-900/40 rounded-2xl border border-gray-200 dark:border-gray-700 space-y-4">
                    <h3 className="font-bold text-gray-800 dark:text-white">Provider追加（Admin）</h3>
                    <div className="grid gap-3">
                      <input
                        type="text"
                        placeholder="Provider key（例: X_REVIEWS）"
                        value={newProviderKey}
                        onChange={(e) => setNewProviderKey(e.target.value)}
                        className="w-full p-2.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg"
                      />
                      <input
                        type="text"
                        placeholder="表示名（例: X Reviews）"
                        value={newProviderName}
                        onChange={(e) => setNewProviderName(e.target.value)}
                        className="w-full p-2.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg"
                      />
                      <div className="grid grid-cols-3 gap-2">
                        <select
                          value={newProviderKind}
                          onChange={(e) => setNewProviderKind(e.target.value as ProviderKind)}
                          className="p-2.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm"
                        >
                          <option value="GENERIC">GENERIC</option>
                          <option value="NATIVE">NATIVE</option>
                        </select>
                        <select
                          value={newProviderAuthKind}
                          onChange={(e) => setNewProviderAuthKind(e.target.value as ProviderAuthKind)}
                          className="p-2.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm"
                        >
                          <option value="API_KEY">API_KEY</option>
                          <option value="OAUTH2">OAUTH2</option>
                          <option value="WEBHOOK">WEBHOOK</option>
                          <option value="NONE">NONE</option>
                        </select>
                        <select
                          value={newProviderVisibility}
                          onChange={(e) => setNewProviderVisibility(e.target.value as VisibilityState)}
                          className="p-2.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm"
                        >
                          <option value="ADMIN_ONLY">ADMIN_ONLY</option>
                          <option value="HIDDEN">HIDDEN</option>
                          <option value="ENABLED">ENABLED</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-300">
                        <label className="flex items-center gap-2"><input type="checkbox" checked={newCanConnect} onChange={(e) => setNewCanConnect(e.target.checked)} />connect</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={newCanSyncInbox} onChange={(e) => setNewCanSyncInbox(e.target.checked)} />sync inbox</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={newCanPublish} onChange={(e) => setNewCanPublish(e.target.checked)} />publish</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={newCanReply} onChange={(e) => setNewCanReply(e.target.checked)} />reply</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={newCanFetchMetrics} onChange={(e) => setNewCanFetchMetrics(e.target.checked)} />metrics</label>
                      </div>
                    </div>
                    <button
                      onClick={() => void handleCreateProvider()}
                      disabled={isCreatingProvider || Boolean(createProviderDisabledReason)}
                      title={createProviderDisabledReason || undefined}
                      className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isCreatingProvider ? '追加中...' : 'Providerを追加'}
                    </button>
                  </div>

                  <div className="p-5 bg-gray-50 dark:bg-gray-900/40 rounded-2xl border border-gray-200 dark:border-gray-700 space-y-4">
                    <h3 className="font-bold text-gray-800 dark:text-white">Provider設定（Admin）</h3>
                    {selectedProviderCard && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        編集中: {selectedProviderCard.catalog.displayName} ({selectedProviderCard.catalog.providerKey})
                      </p>
                    )}
                    <select
                      data-testid="provider-admin-select"
                      value={selectedProviderId}
                      onChange={(e) => setSelectedProviderId(e.target.value)}
                      className="w-full p-2.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg"
                    >
                      <option value="">Providerを選択してください</option>
                      {providerCards.map((card) => (
                        <option key={card.catalog.id} value={card.catalog.id}>
                          {card.catalog.displayName} ({card.catalog.providerKey})
                        </option>
                      ))}
                    </select>
                    <textarea
                      data-testid="provider-config-json"
                      value={providerConfigJson}
                      onChange={(e) => setProviderConfigJson(e.target.value)}
                      className="w-full h-32 p-2.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg font-mono text-xs"
                    />
                    <input
                      data-testid="provider-config-secret"
                      type="password"
                      value={providerSecretInput}
                      onChange={(e) => setProviderSecretInput(e.target.value)}
                      placeholder="シークレット（保存後は再表示不可）"
                      className="w-full p-2.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg"
                    />
                    <div className="flex gap-2">
                      <button
                        data-testid="provider-config-save"
                        onClick={() => void handleSaveProviderConfiguration()}
                        disabled={isSavingProviderConfig || Boolean(saveProviderDisabledReason)}
                        title={saveProviderDisabledReason || undefined}
                        className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {isSavingProviderConfig ? '保存中...' : '設定を保存'}
                      </button>
                      <button
                        data-testid="provider-config-test"
                        onClick={() => void handleTestProviderConnection()}
                        disabled={isTestingConnection || Boolean(testProviderDisabledReason)}
                        title={testProviderDisabledReason || undefined}
                        className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {isTestingConnection ? 'テスト中...' : '接続テスト'}
                      </button>
                    </div>
                    {(saveProviderDisabledReason || testProviderDisabledReason) && (
                      <div className="space-y-1">
                        {saveProviderDisabledReason && (
                          <p className="text-xs text-amber-700 dark:text-amber-300">設定保存不可: {saveProviderDisabledReason}</p>
                        )}
                        {testProviderDisabledReason && (
                          <p className="text-xs text-amber-700 dark:text-amber-300">接続テスト不可: {testProviderDisabledReason}</p>
                        )}
                      </div>
                    )}
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      実データ検証は GUI設定済み provider のみ対象です。未設定providerは自動でモック検証になります。Supabase未接続時はすべてモック表示です。
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'SYSTEM' && currentUser.role === Role.ADMIN && (
             <div className="max-w-4xl space-y-8">
               <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 p-4 rounded-xl flex gap-3">
                 <AlertTriangle className="text-orange-600 dark:text-orange-400 flex-shrink-0" />
                 <div>
                   <h3 className="font-bold text-orange-800 dark:text-orange-300 text-sm">開発者エリア</h3>
                   <p className="text-xs text-orange-700 dark:text-orange-400 mt-1">この設定を変更するとシステム全体に影響が及びます。</p>
                 </div>
               </div>

               <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                 <div className="space-y-4">
                   <h2 className="text-xl font-bold text-gray-800 dark:text-white">API設定（将来拡張）</h2>
                   <div>
                     <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Google Gemini API Key</label>
                     <div className="flex gap-2">
                       <div className="relative flex-1">
                          <Key className="absolute left-3 top-3 text-gray-400" size={18} />
                          <input 
                            type="password" 
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            className="pl-10 w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl font-mono text-sm"
                          />
                       </div>
                       <button className="px-4 py-2 bg-gray-800 text-white rounded-xl text-sm hover:bg-gray-900 transition-colors">更新</button>
                     </div>
                   </div>
                 </div>

                 <div className="space-y-4">
                  <h2 className="text-xl font-bold text-gray-800 dark:text-white">機能公開制御（Feature Flag）</h2>
                  {isLoadingFlags && <p className="text-sm text-gray-500 dark:text-gray-400">Feature flagを読み込み中...</p>}
                  <div className="space-y-2">
                    {FEATURE_FLAG_OPTIONS.map((option) => {
                      const currentState = resolveFeatureState(featureFlags, option.key, activeStoreId || undefined);
                      const defaultState = DEFAULT_FEATURE_VISIBILITY[option.key] || 'ENABLED';
                      return (
                        <div key={option.key} className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 p-3 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl">
                          <div>
                            <p className="text-sm font-medium text-gray-800 dark:text-white">{option.label}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{option.description} / default: {defaultState}</p>
                          </div>
                          <select
                            value={currentState}
                            disabled={updatingFeatureKey === option.key || !activeOrgId}
                            onChange={(e) => void handleUpdateFeatureFlag(option.key, e.target.value as VisibilityState)}
                            className="px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-60"
                          >
                            <option value="HIDDEN">HIDDEN</option>
                            <option value="ADMIN_ONLY">ADMIN_ONLY</option>
                            <option value="ENABLED">ENABLED</option>
                          </select>
                        </div>
                      );
                    })}
                  </div>
                 </div>
               </div>

               <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                 <div className="p-5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-2xl space-y-4">
                   <div className="flex items-center justify-between gap-3">
                     <h2 className="text-xl font-bold text-gray-800 dark:text-white">ブランドキット</h2>
                     {isLoadingBrandAssets && <span className="text-xs text-gray-500 dark:text-gray-400">読み込み中...</span>}
                   </div>
                   <p className="text-xs text-gray-500 dark:text-gray-400">
                     投稿作成で参照するトーン/NGワード/推奨ハッシュタグ/署名を組織単位で管理します。
                   </p>
                   <div className="space-y-3">
                     <div>
                       <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">トーンガイド</label>
                       <textarea
                         data-testid="brandkit-tone-guide"
                         value={toneGuideInput}
                         onChange={(e) => setToneGuideInput(e.target.value)}
                         rows={3}
                         placeholder="例: 誠実・端的・過度な煽り禁止"
                         className="w-full p-2.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg"
                       />
                     </div>
                     <div>
                       <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">NGワード（カンマ/改行区切り）</label>
                       <textarea
                         data-testid="brandkit-banned-words"
                         value={bannedWordsInput}
                         onChange={(e) => setBannedWordsInput(e.target.value)}
                         rows={3}
                         placeholder="例: 絶対, 100%保証"
                         className="w-full p-2.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg"
                       />
                     </div>
                     <div>
                       <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">推奨ハッシュタグ（カンマ/改行区切り）</label>
                       <textarea
                         data-testid="brandkit-recommended-hashtags"
                         value={recommendedHashtagsInput}
                         onChange={(e) => setRecommendedHashtagsInput(e.target.value)}
                         rows={3}
                         placeholder="例: #TEPPENMEO, #地域名グルメ"
                         className="w-full p-2.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg"
                       />
                     </div>
                     <div>
                       <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">デフォルト署名</label>
                       <textarea
                         data-testid="brandkit-signature"
                         value={signatureInput}
                         onChange={(e) => setSignatureInput(e.target.value)}
                         rows={2}
                         placeholder="例: ご来店を心よりお待ちしております。"
                         className="w-full p-2.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg"
                       />
                     </div>
                   </div>
                   <button
                     data-testid="brandkit-save"
                     type="button"
                     onClick={() => void handleSaveBrandKit()}
                     disabled={isSavingBrandKit || Boolean(brandAssetDisabledReason)}
                     title={brandAssetDisabledReason || undefined}
                     className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                   >
                     <Save size={16} />
                     {isSavingBrandKit ? '保存中...' : 'ブランドキットを保存'}
                   </button>
                   {brandKit && (
                     <p className="text-xs text-gray-500 dark:text-gray-400">
                       最終更新: {brandKit.updatedAt ? brandKit.updatedAt.toLocaleString('ja-JP') : '-'}
                     </p>
                   )}
                 </div>

                 <div className="p-5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-2xl space-y-4">
                   <h2 className="text-xl font-bold text-gray-800 dark:text-white">投稿テンプレート</h2>
                   <p className="text-xs text-gray-500 dark:text-gray-400">
                     新規投稿画面のテンプレート候補として表示されます。削除は論理削除です。
                   </p>
                   <div className="space-y-3">
                     <input
                       data-testid="template-title"
                       type="text"
                       value={templateTitleInput}
                       onChange={(e) => setTemplateTitleInput(e.target.value)}
                       placeholder="テンプレート名（例: 新商品告知）"
                       className="w-full p-2.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg"
                     />
                     <textarea
                       data-testid="template-body"
                       value={templateBodyInput}
                       onChange={(e) => setTemplateBodyInput(e.target.value)}
                       rows={4}
                       placeholder="テンプレート本文"
                       className="w-full p-2.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg"
                     />
                     <div className="flex flex-wrap gap-2">
                       {TEMPLATE_PLATFORM_OPTIONS.map((platform) => (
                         <label key={platform} className="inline-flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-lg">
                           <input
                             type="checkbox"
                            checked={templatePlatforms.includes(platform)}
                            onChange={() => toggleTemplatePlatform(platform)}
                            data-testid={`template-platform-${platform}`}
                          />
                           {TEMPLATE_PLATFORM_LABELS[platform]}
                         </label>
                       ))}
                     </div>
                     <button
                       data-testid="template-create"
                       type="button"
                       onClick={() => void handleCreateTemplate()}
                       disabled={isCreatingTemplate || Boolean(brandAssetDisabledReason)}
                       title={brandAssetDisabledReason || undefined}
                       className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                     >
                       <Plus size={16} />
                       {isCreatingTemplate ? '作成中...' : 'テンプレートを作成'}
                     </button>
                   </div>

                   <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-600">
                     {templates.length === 0 && (
                       <p className="text-xs text-gray-500 dark:text-gray-400">テンプレートはまだありません。</p>
                     )}
                     {templates.map((template) => (
                       <div key={template.id} className="p-3 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/60">
                         <div className="flex items-start justify-between gap-3">
                           <div className="min-w-0">
                             <p className="text-sm font-semibold text-gray-800 dark:text-white">{template.title}</p>
                             <p className="text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap break-words mt-1">{template.body}</p>
                             <div className="flex flex-wrap gap-1 mt-2">
                               {template.defaultPlatforms.length > 0 ? template.defaultPlatforms.map((platform) => (
                                 <span
                                   key={`${template.id}-${platform}`}
                                   className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700"
                                 >
                                   {TEMPLATE_PLATFORM_LABELS[platform]}
                                 </span>
                               )) : (
                                 <span className="text-[10px] text-gray-500 dark:text-gray-400">投稿先指定なし</span>
                               )}
                             </div>
                           </div>
                           <button
                             data-testid={`template-remove-${template.id}`}
                             type="button"
                             onClick={() => void handleRemoveTemplate(template.id)}
                             disabled={removingTemplateId === template.id}
                             className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-md hover:bg-red-100 dark:hover:bg-red-900/40 disabled:opacity-60"
                           >
                             <Trash2 size={12} />
                             {removingTemplateId === template.id ? '削除中' : '削除'}
                           </button>
                         </div>
                       </div>
                     ))}
                   </div>
                 </div>
               </div>

               <div>
                  <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-4">システムメンテナンス</h2>
                  <div className="flex gap-4">
                    <button className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50">キャッシュクリア</button>
                    <button className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50">ログダウンロード</button>
                  </div>
               </div>
             </div>
          )}

          {isOAuthModalOpen && (
            <ModalPortal>
              <div data-testid="oauth-modal" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                <div className="w-full max-w-xl rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-xl p-6 space-y-4">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">OAuth連携: {oauthProviderLabel}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      認可URLを開いた後、取得した認可コードを入力して接続を完了してください。
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">認可URL</label>
                    <a
                      data-testid="oauth-auth-url"
                      href={oauthAuthorizationUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 text-sm text-primary-700 dark:text-primary-300 break-all hover:underline"
                    >
                      <ExternalLink size={14} />
                      {oauthAuthorizationUrl}
                    </a>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">認可コード</label>
                    <input
                      data-testid="oauth-auth-code"
                      type="text"
                      value={oauthAuthCode}
                      onChange={(e) => setOauthAuthCode(e.target.value)}
                      placeholder="認可コードを貼り付け"
                      className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl"
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      data-testid="oauth-cancel"
                      type="button"
                      onClick={closeOAuthModal}
                      disabled={isCompletingOAuth}
                      className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-60"
                    >
                      キャンセル
                    </button>
                    <button
                      data-testid="oauth-complete"
                      type="button"
                      onClick={() => void handleCompleteOAuth()}
                      disabled={isCompletingOAuth || !oauthAuthCode.trim()}
                      className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isCompletingOAuth ? '接続中...' : '接続を完了'}
                    </button>
                  </div>
                </div>
              </div>
            </ModalPortal>
          )}
        </div>
      </div>
    </div>
  );
};
