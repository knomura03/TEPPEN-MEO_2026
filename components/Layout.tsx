import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { User, Role, ViewState, FeatureFlag, ManagementUnitBranding, VisibilityState } from '../types';
import { 
  LayoutDashboard, 
  PenSquare, 
  FileText,
  BookOpenText,
  List, 
  Users, 
  Building2,
  Store,
  LogOut, 
  Menu,
  Calendar,
  MessageSquare,
  ClipboardList,
  Moon,
  Sun,
  HelpCircle,
  Settings,
  ShieldCheck,
  Link2,
  TrendingUp,
  CreditCard,
  Lightbulb
} from 'lucide-react';
import { OnboardingTour } from './OnboardingTour';
import { NotificationCenter } from './NotificationCenter';
import { HeaderScopeSelectors } from './HeaderScopeSelectors';
import { useStore } from '../contexts/StoreContext';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { featureFlagsService, resolveFeatureState } from '../services/featureFlagsService';
import { billingService } from '../services/billingService';
import { managementUnitService, MANAGEMENT_UNIT_BRANDING_UPDATED_EVENT } from '../services/managementUnitService';
import { COMMON_COPY, NAV_LABELS } from './ui/copy';
import { formatRoleLabel, formatViewLabel } from './ui/formatters';
import { Avatar } from './ui/Avatar';
import {
  SIDEBAR_NAV_ORDER_UPDATED_EVENT,
  applySidebarNavOrder,
  getSidebarNavLabels,
  getSidebarNavOrder,
} from '../services/navigationOrderService';

interface LayoutProps {
  currentUser: User;
  currentView: ViewState;
  onNavigate: (view: ViewState) => void;
  onLogout: () => void;
  isDarkMode: boolean;
  toggleTheme: () => void;
  children: React.ReactNode;
}

interface NavItemProps {
  item: MenuItem;
  currentView: ViewState;
  onNavigate: (view: ViewState) => void;
  onCloseMobileMenu: () => void;
}

type MenuItem = {
  id: ViewState;
  label: string;
  icon: React.ElementType;
  allowed: Role[];
  featureKey: string;
};

const NavItem: React.FC<NavItemProps> = ({ 
  item, 
  currentView, 
  onNavigate, 
  onCloseMobileMenu 
}) => (
  <button
    id={`nav-${item.id}`}
    onClick={() => {
      onNavigate(item.id);
      onCloseMobileMenu();
    }}
    className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
      currentView === item.id 
        ? 'bg-gradient-to-r from-primary-600 to-primary-500 text-white shadow-md shadow-primary-200 dark:shadow-none' 
        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/50'
    }`}
  >
    <item.icon size={20} className={currentView === item.id ? 'text-white' : 'group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors'} />
    <span className="font-medium">{item.label}</span>
  </button>
);

export const Layout: React.FC<LayoutProps> = ({ 
  currentUser, 
  currentView, 
  onNavigate, 
  onLogout, 
  isDarkMode,
  toggleTheme,
  children 
}) => {
  const {
    stores,
    filteredGroups,
    selectedManagementUnitIds,
    selectedOrgIds,
    activeStoreId,
    selectedStoreIds,
    isLoadingStores,
    storesError,
    reloadStores,
  } = useStore();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [featureFlags, setFeatureFlags] = useState<FeatureFlag[]>([]);
  const [isLoadingFlags, setIsLoadingFlags] = useState(false);
  const [planFeatureRules, setPlanFeatureRules] = useState<Record<string, boolean>>({});
  const [sidebarOrder, setSidebarOrder] = useState(() => getSidebarNavOrder());
  const [sidebarLabels, setSidebarLabels] = useState(() => getSidebarNavLabels());

  const activeStore = useMemo(() => {
    if (!activeStoreId) return null;
    return stores.find((store) => store.id === activeStoreId) || null;
  }, [activeStoreId, stores]);

  const effectiveBrandingUnitId = useMemo(() => {
    if (currentUser.role === Role.ADMIN) {
      return selectedManagementUnitIds.length === 1 ? selectedManagementUnitIds[0] : null;
    }
    const groupById = new Map(filteredGroups.map((group) => [group.id, group]));
    const unitIdSet = new Set<string>();
    for (const orgId of selectedOrgIds) {
      const unitId = groupById.get(orgId)?.managementUnitId;
      if (unitId) unitIdSet.add(unitId);
    }
    if (unitIdSet.size === 1) return Array.from(unitIdSet)[0];
    return null;
  }, [currentUser.role, filteredGroups, selectedManagementUnitIds, selectedOrgIds]);

  const [branding, setBranding] = useState<ManagementUnitBranding | null>(null);

  const reloadBranding = useCallback(async () => {
    if (!isSupabaseConfigured || !effectiveBrandingUnitId) {
      setBranding(null);
      return;
    }
    try {
      const row = await managementUnitService.getBranding(effectiveBrandingUnitId);
      setBranding(row);
    } catch (error) {
      console.warn('[Layout] Failed to load management unit branding:', error);
      setBranding(null);
    }
  }, [effectiveBrandingUnitId]);

  useEffect(() => {
    void reloadBranding();
  }, [reloadBranding]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { managementUnitId?: string } | undefined;
      if (!detail?.managementUnitId) return;
      if (detail.managementUnitId !== effectiveBrandingUnitId) return;
      void reloadBranding();
    };
    window.addEventListener(MANAGEMENT_UNIT_BRANDING_UPDATED_EVENT, handler as EventListener);
    return () => {
      window.removeEventListener(MANAGEMENT_UNIT_BRANDING_UPDATED_EVENT, handler as EventListener);
    };
  }, [effectiveBrandingUnitId, reloadBranding]);

  const effectiveServiceName = branding?.serviceName?.trim() || 'TEPPEN MEO';
  const effectiveLogoSrc = useMemo(() => {
    if (!branding?.logoPath) return '/logo.svg';
    try {
      return managementUnitService.getBrandingLogoPublicUrl(branding.logoPath, branding.updatedAt.getTime());
    } catch {
      return '/logo.svg';
    }
  }, [branding?.logoPath, branding?.updatedAt]);

  useEffect(() => {
    const hasSeenTour = localStorage.getItem('hasSeenTour');
    if (!hasSeenTour) {
      setShowTour(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncSidebarOrder = () => {
      setSidebarOrder(getSidebarNavOrder());
      setSidebarLabels(getSidebarNavLabels());
    };
    window.addEventListener(SIDEBAR_NAV_ORDER_UPDATED_EVENT, syncSidebarOrder);
    return () => {
      window.removeEventListener(SIDEBAR_NAV_ORDER_UPDATED_EVENT, syncSidebarOrder);
    };
  }, []);

  const handleTourComplete = () => {
    setShowTour(false);
    localStorage.setItem('hasSeenTour', 'true');
  };

  const startTour = () => setShowTour(true);

  const handleLogoutClick = () => {
    const accepted = window.confirm('ログアウトしますか？');
    if (!accepted) return;
    onLogout();
  };

  useEffect(() => {
    const loadFlags = async () => {
      if (!isSupabaseConfigured || !activeStore?.orgId) {
        setFeatureFlags([]);
        return;
      }
      setIsLoadingFlags(true);
      try {
        const rows = await featureFlagsService.listByOrg(activeStore.orgId, activeStore.id);
        setFeatureFlags(rows);
      } catch (error) {
        console.error('[Layout] Failed to load feature flags:', error);
      } finally {
        setIsLoadingFlags(false);
      }
    };
    void loadFlags();
  }, [activeStore?.id, activeStore?.orgId]);

  useEffect(() => {
    const loadPlanRules = async () => {
      if (!isSupabaseConfigured || !activeStoreId) {
        setPlanFeatureRules({});
        return;
      }
      try {
        const subscription = await billingService.getStoreSubscription(activeStoreId);
        setPlanFeatureRules(subscription?.billingPlan?.featureRules || {});
      } catch (error) {
        console.error('[Layout] Failed to load plan feature rules:', error);
        setPlanFeatureRules({});
      }
    };
    void loadPlanRules();
  }, [activeStoreId]);

  const menuItems = useMemo<MenuItem[]>(
    () => [
      { id: 'DASHBOARD', label: sidebarLabels.DASHBOARD || NAV_LABELS.DASHBOARD, icon: LayoutDashboard, allowed: [Role.ADMIN, Role.SUPERVISOR, Role.MANAGER, Role.USER], featureKey: 'dashboard' },
      { id: 'CREATE_POST', label: sidebarLabels.CREATE_POST || NAV_LABELS.CREATE_POST, icon: PenSquare, allowed: [Role.ADMIN, Role.SUPERVISOR, Role.MANAGER, Role.USER], featureKey: 'create_post' },
      { id: 'POST_TEMPLATES', label: sidebarLabels.POST_TEMPLATES || NAV_LABELS.POST_TEMPLATES, icon: FileText, allowed: [Role.ADMIN, Role.SUPERVISOR, Role.MANAGER, Role.USER], featureKey: 'post_templates' },
      { id: 'BRAND_KIT', label: sidebarLabels.BRAND_KIT || NAV_LABELS.BRAND_KIT, icon: BookOpenText, allowed: [Role.ADMIN, Role.SUPERVISOR, Role.MANAGER, Role.USER], featureKey: 'brand_kit' },
      { id: 'POST_LIST', label: sidebarLabels.POST_LIST || NAV_LABELS.POST_LIST, icon: List, allowed: [Role.ADMIN, Role.SUPERVISOR, Role.MANAGER, Role.USER], featureKey: 'post_list' },
      { id: 'CALENDAR', label: sidebarLabels.CALENDAR || NAV_LABELS.CALENDAR, icon: Calendar, allowed: [Role.ADMIN, Role.SUPERVISOR, Role.MANAGER, Role.USER], featureKey: 'calendar' },
      { id: 'INBOX', label: sidebarLabels.INBOX || NAV_LABELS.INBOX, icon: MessageSquare, allowed: [Role.ADMIN, Role.SUPERVISOR, Role.MANAGER, Role.USER], featureKey: 'inbox' },
      { id: 'SURVEY', label: sidebarLabels.SURVEY || NAV_LABELS.SURVEY, icon: ClipboardList, allowed: [Role.ADMIN, Role.SUPERVISOR, Role.MANAGER, Role.USER], featureKey: 'survey' },
      { id: 'RANK_TRACKER', label: sidebarLabels.RANK_TRACKER || NAV_LABELS.RANK_TRACKER, icon: TrendingUp, allowed: [Role.ADMIN, Role.SUPERVISOR, Role.MANAGER, Role.USER], featureKey: 'rank_tracker' },
      { id: 'ADVICE', label: sidebarLabels.ADVICE || NAV_LABELS.ADVICE, icon: Lightbulb, allowed: [Role.ADMIN, Role.SUPERVISOR, Role.MANAGER, Role.USER], featureKey: 'advice' },
      { id: 'USER_MANAGEMENT', label: sidebarLabels.USER_MANAGEMENT || NAV_LABELS.USER_MANAGEMENT, icon: Users, allowed: [Role.ADMIN, Role.SUPERVISOR, Role.MANAGER], featureKey: 'user_management' },
      { id: 'STORE_MANAGEMENT', label: sidebarLabels.STORE_MANAGEMENT || NAV_LABELS.STORE_MANAGEMENT, icon: Store, allowed: [Role.ADMIN, Role.SUPERVISOR, Role.MANAGER, Role.USER], featureKey: 'store_management' },
      { id: 'PLATFORM_MANAGEMENT', label: sidebarLabels.PLATFORM_MANAGEMENT || NAV_LABELS.PLATFORM_MANAGEMENT, icon: Link2, allowed: [Role.ADMIN, Role.SUPERVISOR, Role.MANAGER, Role.USER], featureKey: 'settings_integrations' },
      { id: 'GROUP_MANAGEMENT', label: sidebarLabels.GROUP_MANAGEMENT || NAV_LABELS.GROUP_MANAGEMENT, icon: Building2, allowed: [Role.ADMIN, Role.SUPERVISOR, Role.MANAGER], featureKey: 'group_management' },
      { id: 'MANAGEMENT_UNIT_MANAGEMENT', label: sidebarLabels.MANAGEMENT_UNIT_MANAGEMENT || NAV_LABELS.MANAGEMENT_UNIT_MANAGEMENT, icon: ShieldCheck, allowed: [Role.ADMIN], featureKey: 'management_unit_management' },
      { id: 'BILLING', label: sidebarLabels.BILLING || NAV_LABELS.BILLING, icon: CreditCard, allowed: [Role.ADMIN, Role.SUPERVISOR, Role.MANAGER, Role.USER], featureKey: 'billing' },
    ],
    [sidebarLabels]
  );

  const canAccess = (allowedRoles: Role[]) => allowedRoles.includes(currentUser.role);
  const getFeatureVisibility = (featureKey: string): VisibilityState => {
    if (!isSupabaseConfigured || isLoadingFlags) return 'ENABLED';
    return resolveFeatureState(featureFlags, featureKey, activeStore?.id);
  };
  const canUseFeature = (featureKey: string) => {
    const visibility = getFeatureVisibility(featureKey);
    if (visibility === 'HIDDEN') return false;
    if (visibility === 'ADMIN_ONLY') return currentUser.role === Role.ADMIN || currentUser.role === Role.SUPERVISOR;
    if (currentUser.role !== Role.ADMIN && currentUser.role !== Role.SUPERVISOR) {
      if (featureKey in planFeatureRules && planFeatureRules[featureKey] === false) {
        return false;
      }
    }
    return true;
  };

  const hasStoresError = isSupabaseConfigured && !isLoadingStores && Boolean(storesError);
  const needsStoreBootstrap = isSupabaseConfigured && !isLoadingStores && stores.length === 0 && !storesError;
  const isMultiStoreSelected = selectedStoreIds.length > 1;
  const orderedMenuItems = useMemo(() => applySidebarNavOrder(menuItems, sidebarOrder), [menuItems, sidebarOrder]);
  const visibleMenuItems = orderedMenuItems.filter((item) => canAccess(item.allowed) && canUseFeature(item.featureKey));
  const canOpenSettings =
    canUseFeature('settings_profile') ||
    ((currentUser.role === Role.ADMIN || currentUser.role === Role.SUPERVISOR) && canUseFeature('settings_system'));
  const canOpenStoreManagement = canUseFeature('store_management') && [Role.ADMIN, Role.SUPERVISOR, Role.MANAGER, Role.USER].includes(currentUser.role);
  const canOpenGroupManagement = canUseFeature('group_management') && [Role.ADMIN, Role.SUPERVISOR, Role.MANAGER].includes(currentUser.role);

  return (
    <div className={`flex h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden transition-colors duration-200`}>
      <OnboardingTour isOpen={showTour} onComplete={handleTourComplete} currentView={currentView} />

      {/* Sidebar for Desktop */}
      <aside className="hidden md:flex flex-col w-72 bg-white dark:bg-gray-800 border-r border-gray-100 dark:border-gray-700 shadow-sm z-10">
        <div className="p-6 flex items-center gap-3">
          <img src={effectiveLogoSrc} alt={effectiveServiceName} className="h-9 w-auto" />
          <div className="text-sm font-bold text-gray-900 dark:text-white leading-tight">
            {effectiveServiceName}
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-2 overflow-y-auto py-4">
          {visibleMenuItems.map((item) => (
            <NavItem
              key={item.id}
              item={item}
              currentView={currentView}
              onNavigate={onNavigate}
              onCloseMobileMenu={() => setIsMobileMenuOpen(false)}
            />
          ))}
        </nav>

        <div className="p-4 border-t border-gray-100 dark:border-gray-700 space-y-3 bg-gray-50/50 dark:bg-gray-900/20">
          <div className="flex gap-2">
            <button
              id="theme-toggle"
              onClick={toggleTheme}
              className="flex-1 flex items-center justify-center p-2 rounded-xl bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors border border-gray-100 dark:border-gray-600"
              title={isDarkMode ? "ライトモードへ" : "ダークモードへ"}
            >
              {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              id="open-guide-button"
              onClick={startTour}
              className="flex-1 flex items-center justify-center p-2 rounded-xl bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors border border-gray-100 dark:border-gray-600"
              title="ガイドを表示"
            >
              <HelpCircle size={18} />
            </button>
          </div>

          {canOpenSettings && (
            <button
              id="open-settings-button"
              data-testid="open-settings"
              onClick={() => onNavigate('SETTINGS')}
              className="w-full flex items-center space-x-3 px-4 py-3 bg-white dark:bg-gray-700/50 rounded-xl border border-gray-100 dark:border-gray-600 hover:border-primary-300 hover:shadow-sm transition-all group text-left"
            >
              <Avatar
                src={currentUser.avatarUrl}
                alt={currentUser.name}
                sizeClassName="w-10 h-10"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-800 dark:text-white truncate group-hover:text-primary-600 transition-colors">{currentUser.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate capitalize flex items-center gap-1">
                   {currentUser.role === Role.ADMIN && <span className="w-2 h-2 rounded-full bg-red-500"></span>}
                   {currentUser.role === Role.SUPERVISOR && <span className="w-2 h-2 rounded-full bg-purple-500"></span>}
                   {currentUser.role === Role.MANAGER && <span className="w-2 h-2 rounded-full bg-blue-500"></span>}
                   {currentUser.role === Role.USER && <span className="w-2 h-2 rounded-full bg-green-500"></span>}
                   {formatRoleLabel(currentUser.role)}
                </p>
              </div>
              <Settings size={16} className="text-gray-400 group-hover:text-primary-500" />
            </button>
          )}
          
          <button
            id="sidebar-logout-button"
            onClick={handleLogoutClick}
            className="w-full flex items-center justify-center space-x-2 px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-lg transition-colors"
          >
            <LogOut size={14} />
            <span>ログアウト</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-white/50 dark:bg-gray-900">
        {/* Mobile Header */}
        <header className="md:hidden bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 p-4 flex items-center justify-between z-20 shadow-sm">
          <div className="flex items-center space-x-2">
            <img src={effectiveLogoSrc} alt={effectiveServiceName} className="h-7 w-auto" />
            <div className="text-sm font-bold text-gray-900 dark:text-white leading-tight">
              {effectiveServiceName}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <NotificationCenter />
            <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 text-gray-600 dark:text-gray-300">
              <Menu />
            </button>
          </div>
        </header>

        <div className="hidden md:block sticky top-0 z-20">
          {/* Desktop Header Bar */}
          <header className="flex items-center justify-between py-4 px-8 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-100 dark:border-gray-800">
            <h2 className="text-xl font-bold text-gray-800 dark:text-white tracking-tight">
              {formatViewLabel(currentView)}
            </h2>
            <div className="flex items-center gap-3">
              <HeaderScopeSelectors currentUser={currentUser} />
              <div className="h-6 w-px bg-gray-200 dark:bg-gray-700"></div>
              <NotificationCenter />
            </div>
          </header>
          {isMultiStoreSelected && (
            <div
              data-testid="multi-store-sns-disabled-banner"
              className="px-8 py-2 bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-900/40 text-yellow-900 dark:text-yellow-100 text-sm"
            >
              {COMMON_COPY.multiStoreSnsDisabled}
            </div>
          )}
        </div>

        {/* Mobile Menu Overlay */}
        {isMobileMenuOpen && (
          <div className="md:hidden absolute inset-0 bg-white dark:bg-gray-900 z-10 flex flex-col pt-20 p-4 animate-fade-in">
             <nav className="space-y-2">
              {visibleMenuItems.map((item) => (
                <NavItem
                  key={item.id}
                  item={item}
                  currentView={currentView}
                  onNavigate={onNavigate}
                  onCloseMobileMenu={() => setIsMobileMenuOpen(false)}
                />
              ))}
              <div className="border-t border-gray-100 dark:border-gray-700 my-4 pt-4">
                {canOpenSettings && (
                  <button
                      data-testid="open-settings-mobile"
                      onClick={() => {
                          onNavigate('SETTINGS');
                          setIsMobileMenuOpen(false);
                      }}
                      className="w-full flex items-center space-x-3 px-4 py-3 mb-4 rounded-xl bg-gray-50 dark:bg-gray-800"
                  >
                      <Avatar
                        src={currentUser.avatarUrl}
                        alt={currentUser.name}
                        sizeClassName="w-8 h-8"
                      />
                      <span className="text-sm font-bold text-gray-800 dark:text-white">設定・プロフィール</span>
                  </button>
                )}

                <div className="flex justify-between mb-4">
                   <button onClick={toggleTheme} className="flex items-center gap-2 text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-4 py-2 rounded-lg w-full justify-center">
                      {isDarkMode ? <Sun size={20}/> : <Moon size={20}/>}
                      <span>テーマ切替</span>
                   </button>
                </div>
                <button
                  onClick={handleLogoutClick}
                  className="w-full flex items-center justify-center space-x-3 px-4 py-3 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/10 rounded-xl"
                >
                  <LogOut size={20} />
                  <span>ログアウト</span>
                </button>
              </div>
            </nav>
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-4 md:p-8 relative">
          <div id="page-main-content" className="max-w-7xl mx-auto h-full pb-20 md:pb-0">
            {hasStoresError && (
              <div className="mb-6 p-4 md:p-5 rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 text-red-900 dark:text-red-100">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                  <div className="space-y-2">
                    <div className="font-bold text-sm md:text-base">店舗一覧の取得に失敗しました</div>
                    <div className="text-xs md:text-sm opacity-90 leading-relaxed">
                      Supabaseから店舗一覧（stores）を取得できていないため、店舗セレクタが「未設定」になり、投稿/カレンダー/店舗管理などが空に見えます。
                    </div>
                    <div className="text-[11px] md:text-xs opacity-90 leading-relaxed break-all">
                      <span className="font-bold">詳細:</span> {storesError}
                    </div>
                    <ol className="text-xs md:text-sm list-decimal list-inside space-y-1 opacity-95">
                      <li>右上の「店舗取得エラー」をクリック（再読み込み）</li>
                      <li>直らない場合は、一度ログアウト→ログインを試す</li>
                      <li>それでも直らない場合は、Supabase側（RLS/権限/テーブル）に問題がある可能性が高い</li>
                    </ol>
                  </div>
                  <div className="flex gap-2 md:flex-col md:items-stretch">
                    <button
                      type="button"
                      onClick={() => void reloadStores()}
                      className="px-4 py-2 text-xs md:text-sm font-bold rounded-xl bg-white/80 dark:bg-gray-900/40 border border-red-200 dark:border-red-900/60 hover:bg-white dark:hover:bg-gray-900/60 transition-colors"
                    >
                      再読み込み
                    </button>
                    <button
                      type="button"
                      onClick={() => onNavigate('STORE_MANAGEMENT')}
                      className="px-4 py-2 text-xs md:text-sm font-bold rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors"
                    >
                      店舗管理へ
                    </button>
                  </div>
                </div>
              </div>
            )}
            {needsStoreBootstrap && (
              <div className="mb-6 p-4 md:p-5 rounded-2xl border border-yellow-200 dark:border-yellow-900/50 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-900 dark:text-yellow-100">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                  <div className="space-y-2">
                    <div className="font-bold text-sm md:text-base">
                      店舗が未設定です
                    </div>
                    {currentUser.role === Role.USER ? (
                      <div className="text-xs md:text-sm opacity-90 leading-relaxed">
                        担当店舗がまだ割り当てられていません。管理者に店舗の割り当てを依頼してください。
                      </div>
                    ) : currentUser.role === Role.MANAGER ? (
                      <div className="text-xs md:text-sm opacity-90 leading-relaxed">
                        左メニューの「店舗管理」から店舗を作成できます（グループが必要です）。グループが未作成の場合は管理者へ連絡してください。
                      </div>
                    ) : (
                      <div className="text-xs md:text-sm opacity-90 leading-relaxed">
                        左メニューの「グループ管理」で「グループ＋初期店舗」を作成するか、「店舗管理」で既存グループへ店舗を追加してください。
                      </div>
                    )}
                    <div className="text-xs md:text-sm opacity-90">
                      それでも作成できない場合は、エラーメッセージを添えて管理者へ連絡してください。
                    </div>
                  </div>
                  <div className="flex gap-2 md:flex-col md:items-stretch">
                    <button
                      type="button"
                      onClick={() => void reloadStores()}
                      className="px-4 py-2 text-xs md:text-sm font-bold rounded-xl bg-white/80 dark:bg-gray-900/40 border border-yellow-200 dark:border-yellow-900/60 hover:bg-white dark:hover:bg-gray-900/60 transition-colors"
                    >
                      店舗一覧を再読み込み
                    </button>
                    {canOpenStoreManagement && currentUser.role !== Role.USER && (
                      <button
                        type="button"
                        onClick={() => onNavigate('STORE_MANAGEMENT')}
                        className="px-4 py-2 text-xs md:text-sm font-bold rounded-xl bg-yellow-600 text-white hover:bg-yellow-700 transition-colors"
                      >
                        店舗管理を開く
                      </button>
                    )}
                    {canOpenGroupManagement && (currentUser.role === Role.ADMIN || currentUser.role === Role.SUPERVISOR) && (
                      <button
                        type="button"
                        onClick={() => onNavigate('GROUP_MANAGEMENT')}
                        className="px-4 py-2 text-xs md:text-sm font-bold rounded-xl bg-yellow-600 text-white hover:bg-yellow-700 transition-colors"
                      >
                        グループ管理を開く
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};
