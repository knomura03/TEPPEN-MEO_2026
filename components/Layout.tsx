import React, { useState, useEffect, useMemo } from 'react';
import { User, Role, ViewState, FeatureFlag, VisibilityState } from '../types';
import { 
  LayoutDashboard, 
  PenSquare, 
  List, 
  Users, 
  LogOut, 
  Menu,
  Calendar,
  MessageSquare,
  ClipboardList,
  Moon,
  Sun,
  HelpCircle,
  MapPin,
  Settings,
  Search,
  TrendingUp
} from 'lucide-react';
import { OnboardingTour } from './OnboardingTour';
import { NotificationCenter } from './NotificationCenter';
import { StoreSelector } from './StoreSelector';
import { useStore } from '../contexts/StoreContext';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { featureFlagsService, resolveFeatureState } from '../services/featureFlagsService';

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
  item: {
    id: string;
    label: string;
    icon: React.ElementType;
    allowed: Role[];
    featureKey: string;
  };
  currentView: ViewState;
  onNavigate: (view: ViewState) => void;
  onCloseMobileMenu: () => void;
}

const NavItem: React.FC<NavItemProps> = ({ 
  item, 
  currentView, 
  onNavigate, 
  onCloseMobileMenu 
}) => (
  <button
    id={`nav-${item.id}`}
    onClick={() => {
      onNavigate(item.id as ViewState);
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
  const { stores, activeStoreId, isLoadingStores, storesError, reloadStores } = useStore();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [featureFlags, setFeatureFlags] = useState<FeatureFlag[]>([]);
  const [isLoadingFlags, setIsLoadingFlags] = useState(false);

  const activeStore = useMemo(() => {
    if (!activeStoreId) return null;
    return stores.find((store) => store.id === activeStoreId) || null;
  }, [activeStoreId, stores]);

  const activeOrgId = activeStore?.orgId || null;

  useEffect(() => {
    const hasSeenTour = localStorage.getItem('hasSeenTour');
    if (!hasSeenTour) {
      setShowTour(true);
    }
  }, []);

  const handleTourComplete = () => {
    setShowTour(false);
    localStorage.setItem('hasSeenTour', 'true');
  };

  const startTour = () => setShowTour(true);

  useEffect(() => {
    const loadFlags = async () => {
      if (!isSupabaseConfigured || !activeOrgId) {
        setFeatureFlags([]);
        return;
      }
      setIsLoadingFlags(true);
      try {
        const rows = await featureFlagsService.listByOrg(activeOrgId, activeStore?.id);
        setFeatureFlags(rows);
      } catch (error) {
        console.error('[Layout] Failed to load feature flags:', error);
      } finally {
        setIsLoadingFlags(false);
      }
    };
    void loadFlags();
  }, [activeOrgId, activeStore?.id]);

  const menuItems = [
    { id: 'DASHBOARD', label: 'ダッシュボード', icon: LayoutDashboard, allowed: [Role.ADMIN, Role.MANAGER, Role.USER], featureKey: 'dashboard' },
    { id: 'CALENDAR', label: 'カレンダー', icon: Calendar, allowed: [Role.ADMIN, Role.MANAGER, Role.USER], featureKey: 'calendar' },
    { id: 'SURVEY', label: 'アンケート', icon: ClipboardList, allowed: [Role.ADMIN, Role.MANAGER, Role.USER], featureKey: 'survey' },
    { id: 'CREATE_POST', label: '新規投稿', icon: PenSquare, allowed: [Role.ADMIN, Role.MANAGER, Role.USER], featureKey: 'create_post' },
    { id: 'POST_LIST', label: '投稿一覧', icon: List, allowed: [Role.ADMIN, Role.MANAGER, Role.USER], featureKey: 'post_list' },
    { id: 'INBOX', label: '統合受信箱', icon: MessageSquare, allowed: [Role.ADMIN, Role.MANAGER, Role.USER], featureKey: 'inbox' },
    { id: 'RANK_TRACKER', label: '順位計測', icon: TrendingUp, allowed: [Role.ADMIN, Role.MANAGER, Role.USER], featureKey: 'rank_tracker' },
    { id: 'USER_MANAGEMENT', label: 'ユーザー・契約管理', icon: Users, allowed: [Role.ADMIN, Role.MANAGER], featureKey: 'user_management' },
  ];

  const canAccess = (allowedRoles: Role[]) => allowedRoles.includes(currentUser.role);
  const getFeatureVisibility = (featureKey: string): VisibilityState => {
    if (!isSupabaseConfigured || isLoadingFlags) return 'ENABLED';
    return resolveFeatureState(featureFlags, featureKey, activeStore?.id);
  };
  const canUseFeature = (featureKey: string) => {
    const visibility = getFeatureVisibility(featureKey);
    if (visibility === 'HIDDEN') return false;
    if (visibility === 'ADMIN_ONLY') return currentUser.role === Role.ADMIN;
    return true;
  };

  const viewLabels: Record<string, string> = {
    'DASHBOARD': 'ダッシュボード',
    'CALENDAR': 'カレンダー',
    'SURVEY': 'アンケート',
    'CREATE_POST': '新規投稿',
    'POST_LIST': '投稿一覧',
    'INBOX': '統合受信箱',
    'RANK_TRACKER': '順位計測',
    'USER_MANAGEMENT': 'ユーザー・契約管理',
    'SETTINGS': '設定'
  };

  const hasStoresError = isSupabaseConfigured && !isLoadingStores && Boolean(storesError);
  const needsStoreBootstrap = isSupabaseConfigured && !isLoadingStores && stores.length === 0 && !storesError;
  const visibleMenuItems = menuItems.filter((item) => canAccess(item.allowed) && canUseFeature(item.featureKey));
  const canOpenSettings =
    canUseFeature('settings_profile') ||
    canUseFeature('settings_store') ||
    canUseFeature('settings_integrations') ||
    (currentUser.role === Role.ADMIN && canUseFeature('settings_system'));

  return (
    <div className={`flex h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden transition-colors duration-200`}>
      <OnboardingTour isOpen={showTour} onComplete={handleTourComplete} />

      {/* Sidebar for Desktop */}
      <aside className="hidden md:flex flex-col w-72 bg-white dark:bg-gray-800 border-r border-gray-100 dark:border-gray-700 shadow-sm z-10">
        <div className="p-6 flex items-center gap-3">
          <div className="bg-gradient-to-tr from-primary-600 to-primary-400 p-2.5 rounded-xl shadow-lg shadow-primary-200 dark:shadow-none">
            <MapPin className="text-white h-6 w-6" />
          </div>
          <div>
            <span className="block text-xl font-bold text-gray-800 dark:text-white tracking-tight leading-none">TEPPEN</span>
            <span className="text-xs font-bold text-primary-600 dark:text-primary-400 tracking-widest">MEO PLATFORM</span>
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
              onClick={startTour}
              className="flex-1 flex items-center justify-center p-2 rounded-xl bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors border border-gray-100 dark:border-gray-600"
              title="ガイドを表示"
            >
              <HelpCircle size={18} />
            </button>
          </div>

          {canOpenSettings && (
            <button
              onClick={() => onNavigate('SETTINGS')}
              className="w-full flex items-center space-x-3 px-4 py-3 bg-white dark:bg-gray-700/50 rounded-xl border border-gray-100 dark:border-gray-600 hover:border-primary-300 hover:shadow-sm transition-all group text-left"
            >
              <img 
                src={currentUser.avatarUrl || 'https://via.placeholder.com/40'} 
                alt={currentUser.name} 
                className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-600 object-cover"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-800 dark:text-white truncate group-hover:text-primary-600 transition-colors">{currentUser.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate capitalize flex items-center gap-1">
                   {currentUser.role === Role.ADMIN && <span className="w-2 h-2 rounded-full bg-red-500"></span>}
                   {currentUser.role === Role.MANAGER && <span className="w-2 h-2 rounded-full bg-blue-500"></span>}
                   {currentUser.role === Role.USER && <span className="w-2 h-2 rounded-full bg-green-500"></span>}
                   {currentUser.role.toLowerCase()}
                </p>
              </div>
              <Settings size={16} className="text-gray-400 group-hover:text-primary-500" />
            </button>
          )}
          
          <button
            onClick={onLogout}
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
            <div className="bg-primary-600 p-1.5 rounded-lg">
                <MapPin className="text-white h-5 w-5" />
            </div>
            <span className="font-bold text-gray-800 dark:text-white tracking-tight">TEPPEN MEO</span>
          </div>
          <div className="flex items-center gap-3">
            <NotificationCenter />
            <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 text-gray-600 dark:text-gray-300">
              <Menu />
            </button>
          </div>
        </header>

        {/* Desktop Header Bar (New) */}
        <header className="hidden md:flex items-center justify-between py-4 px-8 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-100 dark:border-gray-800 sticky top-0 z-20">
            <h2 className="text-xl font-bold text-gray-800 dark:text-white tracking-tight">
                {viewLabels[currentView] || 'TEPPEN MEO'}
            </h2>
            <div className="flex items-center gap-4">
                <StoreSelector />
                <div className="relative group">
                    <Search className="absolute left-3 top-2.5 text-gray-400 h-4 w-4" />
                    <input 
                        type="text" 
                        placeholder="検索..." 
                        className="w-64 pl-10 pr-4 py-2 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                    />
                </div>
                <div className="h-6 w-px bg-gray-200 dark:bg-gray-700"></div>
                <NotificationCenter />
            </div>
        </header>

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
                      onClick={() => {
                          onNavigate('SETTINGS');
                          setIsMobileMenuOpen(false);
                      }}
                      className="w-full flex items-center space-x-3 px-4 py-3 mb-4 rounded-xl bg-gray-50 dark:bg-gray-800"
                  >
                      <img 
                      src={currentUser.avatarUrl || 'https://via.placeholder.com/40'} 
                      alt={currentUser.name} 
                      className="w-8 h-8 rounded-full"
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
                  onClick={onLogout}
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
          <div className="max-w-7xl mx-auto h-full pb-20 md:pb-0">
            {hasStoresError && (
              <div className="mb-6 p-4 md:p-5 rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 text-red-900 dark:text-red-100">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                  <div className="space-y-2">
                    <div className="font-bold text-sm md:text-base">店舗一覧の取得に失敗しました</div>
                    <div className="text-xs md:text-sm opacity-90 leading-relaxed">
                      Supabaseから店舗一覧（stores）を取得できていないため、店舗セレクタが「未設定」になり、投稿/カレンダー/店舗情報が空に見えます。
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
                      onClick={() => onNavigate('SETTINGS')}
                      className="px-4 py-2 text-xs md:text-sm font-bold rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors"
                    >
                      設定へ
                    </button>
                  </div>
                </div>
              </div>
            )}
            {needsStoreBootstrap && (
              <div className="mb-6 p-4 md:p-5 rounded-2xl border border-yellow-200 dark:border-yellow-900/50 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-900 dark:text-yellow-100">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                  <div className="space-y-2">
                    <div className="font-bold text-sm md:text-base">店舗が未設定です（設定画面から作成できます）</div>
                    <div className="text-xs md:text-sm opacity-90 leading-relaxed">
                      現在のバージョンでは、SQL Editorを使わずにGUIから初回店舗を作成できます。
                      「設定」→「店舗情報 (MEO)」へ進み、店舗名を入力して「店舗を作成」を押してください。
                    </div>
                    <ol className="text-xs md:text-sm list-decimal list-inside space-y-1 opacity-95">
                      <li>「設定」を開く</li>
                      <li>「店舗情報 (MEO)」タブを開く</li>
                      <li>店舗情報を入力して「店舗を作成」を押す</li>
                      <li>作成後に「店舗一覧を再読み込み」を押す</li>
                    </ol>
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
                    <button
                      type="button"
                      onClick={() => onNavigate('SETTINGS')}
                      className="px-4 py-2 text-xs md:text-sm font-bold rounded-xl bg-yellow-600 text-white hover:bg-yellow-700 transition-colors"
                    >
                      設定へ
                    </button>
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
