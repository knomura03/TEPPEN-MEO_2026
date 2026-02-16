import React, { useState, useEffect } from 'react';
import { User, Role, ViewState } from './types';
import { authService } from './services/authService';
import { Login } from './components/Login';
import { InviteOnboardingView } from './components/InviteOnboardingView';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { PostCreator } from './components/PostCreator';
import { PostTemplatesView } from './components/PostTemplatesView';
import { BrandKitView } from './components/BrandKitView';
import { PostList } from './components/PostList';
import { UserManagement } from './components/UserManagement';
import { StoreManagementView } from './components/StoreManagementView';
import { GroupManagementView } from './components/GroupManagementView';
import { ManagementUnitManagementView } from './components/ManagementUnitManagementView';
import { PlatformManagementView } from './components/PlatformManagementView';
import { CalendarView } from './components/CalendarView';
import { UnifiedInbox } from './components/UnifiedInbox';
import { SettingsView } from './components/SettingsView';
import { SurveyManagerView } from './components/SurveyManagerView';
import { PublicSurveyPage } from './components/PublicSurveyPage';
import { RankTrackerView } from './components/RankTrackerView';
import { BillingView } from './components/BillingView';
import { AdviceView } from './components/AdviceView';
import { LandingPage } from './components/LandingPage';
import { NotificationProvider } from './contexts/NotificationContext';
import { ToastContainer } from './components/Toast';
import { StoreProvider } from './contexts/StoreContext';
import './services/registerBuiltinProviderAdapters';

const resolvePublicSurveyToken = (): string | null => {
  if (typeof window === 'undefined') return null;

  const pathMatch = window.location.pathname.match(/^\/survey\/([A-Za-z0-9_-]+)$/);
  if (pathMatch?.[1]) return pathMatch[1];

  const hashMatch = window.location.hash.match(/^#\/survey\/([A-Za-z0-9_-]+)$/);
  if (hashMatch?.[1]) return hashMatch[1];

  return null;
};

const AVAILABLE_VIEWS: ViewState[] = [
  'DASHBOARD',
  'BILLING',
  'ADVICE',
  'CREATE_POST',
  'POST_TEMPLATES',
  'BRAND_KIT',
  'POST_LIST',
  'USER_MANAGEMENT',
  'STORE_MANAGEMENT',
  'PLATFORM_MANAGEMENT',
  'GROUP_MANAGEMENT',
  'MANAGEMENT_UNIT_MANAGEMENT',
  'CALENDAR',
  'INBOX',
  'SURVEY',
  'RANK_TRACKER',
  'SETTINGS',
];

const resolveViewFromQuery = (): ViewState => {
  if (typeof window === 'undefined') return 'DASHBOARD';
  const view = new URLSearchParams(window.location.search).get('view');
  if (!view) return 'DASHBOARD';
  return AVAILABLE_VIEWS.includes(view as ViewState) ? (view as ViewState) : 'DASHBOARD';
};

const getPathFromLocation = (): string => {
  if (typeof window === 'undefined') return '/';
  const rawHash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
  if (rawHash.includes('access_token=') || rawHash.includes('refresh_token=') || rawHash.includes('error=')) {
    return '/invite';
  }
  const hashPathMatch = window.location.hash.match(/^#(\/[^?]*)/);
  if (hashPathMatch?.[1]) return hashPathMatch[1];
  return window.location.pathname || '/';
};

const isLoginPath = (path: string): boolean => path === '/login' || path === '/login/';
const isInvitePath = (path: string): boolean => path === '/invite' || path === '/invite/';

const hasViewQuery = (): boolean => {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('view');
};

const navigate = (url: string, options?: { replace?: boolean }) => {
  if (typeof window === 'undefined') return;
  if (options?.replace) {
    window.history.replaceState({}, '', url);
  } else {
    window.history.pushState({}, '', url);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
};

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentPath, setCurrentPath] = useState<string>(() => getPathFromLocation());
  const [currentView, setCurrentView] = useState<ViewState>(() => resolveViewFromQuery());
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [publicSurveyToken, setPublicSurveyToken] = useState<string | null>(() => resolvePublicSurveyToken());
  const mustCompletePasswordSetup = Boolean(currentUser?.invitedAt && !currentUser.passwordSetAt);
  
  // Theme State
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') === 'dark';
    }
    return false;
  });

  // Apply Theme
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  const toggleTheme = () => setIsDarkMode(!isDarkMode);

  useEffect(() => {
    const handleRouteChange = () => {
      setPublicSurveyToken(resolvePublicSurveyToken());
      setCurrentPath(getPathFromLocation());
      setCurrentView(resolveViewFromQuery());
    };
    window.addEventListener('hashchange', handleRouteChange);
    window.addEventListener('popstate', handleRouteChange);
    return () => {
      window.removeEventListener('hashchange', handleRouteChange);
      window.removeEventListener('popstate', handleRouteChange);
    };
  }, []);

  // 初回ロード時にセッションチェック（モック）
  useEffect(() => {
    const checkAuth = async () => {
      if (publicSurveyToken) {
        setIsLoading(false);
        return;
      }
      const user = await authService.getCurrentUser();
      setCurrentUser(user);
      setIsLoading(false);
    };
    void checkAuth();
  }, [publicSurveyToken]);

  useEffect(() => {
    if (!currentUser) return;
    if (mustCompletePasswordSetup) {
      if (!isInvitePath(currentPath)) {
        navigate('/invite', { replace: true });
      }
      return;
    }
    if (!(isLoginPath(currentPath) || isInvitePath(currentPath))) return;
    navigate('/?view=DASHBOARD', { replace: true });
  }, [currentPath, currentUser, mustCompletePasswordSetup]);

  const handleLogin = (user: User) => {
    setCurrentUser(user);
    setCurrentView('DASHBOARD');
    navigate('/?view=DASHBOARD', { replace: true });
  };

  const handleLogout = () => {
    void authService.logout();
    setCurrentUser(null);
    setCurrentView('DASHBOARD');
    navigate('/', { replace: true });
  };

  if (publicSurveyToken) {
    return <PublicSurveyPage publicToken={publicSurveyToken} />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!currentUser) {
    if (isInvitePath(currentPath)) {
      return (
        <InviteOnboardingView
          onCompleted={handleLogin}
          onBackToLogin={() => navigate('/login', { replace: true })}
        />
      );
    }
    if (isLoginPath(currentPath) || hasViewQuery()) {
      return <Login onLogin={handleLogin} onBackToLanding={() => navigate('/')} />;
    }
    return <LandingPage onNavigateLogin={() => navigate('/login')} />;
  }

  if (mustCompletePasswordSetup) {
    return (
      <InviteOnboardingView
        onCompleted={handleLogin}
        onBackToLogin={() => {
          void authService.logout();
          setCurrentUser(null);
          navigate('/login', { replace: true });
        }}
      />
    );
  }

  // 権限に基づいてビューをレンダリング
  const renderContent = () => {
    switch (currentView) {
      case 'DASHBOARD':
        return <Dashboard isDarkMode={isDarkMode} />;
      case 'BILLING':
        return <BillingView currentUser={currentUser} />;
      case 'ADVICE':
        return <AdviceView currentUser={currentUser} />;
      case 'CALENDAR':
        return <CalendarView currentUser={currentUser} />;
      case 'CREATE_POST':
        return <PostCreator currentUser={currentUser} />;
      case 'POST_TEMPLATES':
        return <PostTemplatesView currentUser={currentUser} />;
      case 'BRAND_KIT':
        return <BrandKitView currentUser={currentUser} />;
      case 'POST_LIST':
        return <PostList currentUser={currentUser} />;
      case 'INBOX':
        return <UnifiedInbox currentUser={currentUser} />;
      case 'SURVEY':
        return <SurveyManagerView currentUser={currentUser} />;
      case 'RANK_TRACKER':
        return <RankTrackerView currentUser={currentUser} />;
      case 'SETTINGS':
        return <SettingsView currentUser={currentUser} onProfileUpdated={setCurrentUser} />;
      case 'USER_MANAGEMENT':
        // User Roleはアクセス不可
        if (currentUser.role === Role.USER) {
          return <div className="p-8 text-center text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/10 rounded-xl">アクセス権限がありません。</div>;
        }
        return <UserManagement currentUser={currentUser} />;
      case 'STORE_MANAGEMENT':
        return <StoreManagementView currentUser={currentUser} />;
      case 'PLATFORM_MANAGEMENT':
        return <PlatformManagementView currentUser={currentUser} />;
      case 'GROUP_MANAGEMENT':
        if (currentUser.role === Role.USER) {
          return <div className="p-8 text-center text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/10 rounded-xl">アクセス権限がありません。</div>;
        }
        return <GroupManagementView currentUser={currentUser} />;
      case 'MANAGEMENT_UNIT_MANAGEMENT':
        if (currentUser.role !== Role.ADMIN) {
          return <div className="p-8 text-center text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/10 rounded-xl">アクセス権限がありません。</div>;
        }
        return <ManagementUnitManagementView currentUser={currentUser} />;
      default:
        return <Dashboard isDarkMode={isDarkMode} />;
    }
  };

  return (
    <NotificationProvider>
      <StoreProvider currentUser={currentUser}>
        <Layout
          currentUser={currentUser}
          currentView={currentView}
          onNavigate={setCurrentView}
          onLogout={handleLogout}
          isDarkMode={isDarkMode}
          toggleTheme={toggleTheme}
        >
          {renderContent()}
        </Layout>
      </StoreProvider>
      <ToastContainer />
    </NotificationProvider>
  );
};

export default App;
