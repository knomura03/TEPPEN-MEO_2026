import React, { useState, useEffect } from 'react';
import { User, Role, ViewState } from './types';
import { authService } from './services/authService';
import { Login } from './components/Login';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { PostCreator } from './components/PostCreator';
import { PostList } from './components/PostList';
import { UserManagement } from './components/UserManagement';
import { CalendarView } from './components/CalendarView';
import { UnifiedInbox } from './components/UnifiedInbox';
import { SettingsView } from './components/SettingsView';
import { SurveyManagerView } from './components/SurveyManagerView';
import { PublicSurveyPage } from './components/PublicSurveyPage';
import { RankTrackerView } from './components/RankTrackerView';
import { BillingView } from './components/BillingView';
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

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentView, setCurrentView] = useState<ViewState>('DASHBOARD');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [publicSurveyToken, setPublicSurveyToken] = useState<string | null>(() => resolvePublicSurveyToken());
  
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
    const handleRouteChange = () => setPublicSurveyToken(resolvePublicSurveyToken());
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

  const handleLogin = (user: User) => {
    setCurrentUser(user);
    setCurrentView('DASHBOARD');
  };

  const handleLogout = () => {
    void authService.logout();
    setCurrentUser(null);
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
    return <Login onLogin={handleLogin} />;
  }

  // 権限に基づいてビューをレンダリング
  const renderContent = () => {
    switch (currentView) {
      case 'DASHBOARD':
        return <Dashboard isDarkMode={isDarkMode} />;
      case 'BILLING':
        return <BillingView currentUser={currentUser} />;
      case 'CALENDAR':
        return <CalendarView currentUser={currentUser} />;
      case 'CREATE_POST':
        return <PostCreator currentUser={currentUser} />;
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
      default:
        return <Dashboard isDarkMode={isDarkMode} />;
    }
  };

  return (
    <NotificationProvider>
      <StoreProvider>
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
