import React, { useState } from 'react';
import { User } from '../types';
import { authService } from '../services/authService';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { MapPin, Lock, User as UserIcon, Loader2 } from 'lucide-react';

interface LoginProps {
  onLogin: (user: User) => void;
  onBackToLanding?: () => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin, onBackToLanding }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('password');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    setTimeout(async () => {
      try {
        const user = await authService.login(email, password);
        onLogin(user);
      } catch (err: any) {
        setError(err?.message || 'ログインに失敗しました');
        setIsLoading(false);
      }
    }, 800);
  };

  const handleDemoLogin = async (username: string) => {
    setError('');
    setIsLoading(true);
    setTimeout(async () => {
      const user = await authService.loginDemo(username);
      if (user) {
        onLogin(user);
      } else {
        setError('デモログインに失敗しました');
        setIsLoading(false);
      }
    }, 300);
  };

  const showDemoLogin = import.meta.env.DEV;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4 relative overflow-hidden">
        {/* Background Decoration */}
        <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-primary-600 to-primary-900 z-0"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary-500/20 rounded-full blur-3xl pointer-events-none z-0"></div>

      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 border border-gray-100 dark:border-gray-700 relative z-10">
        {onBackToLanding && (
          <button
            type="button"
            onClick={onBackToLanding}
            className="mb-6 text-sm font-semibold text-primary-700 hover:text-primary-800 dark:text-primary-300 dark:hover:text-primary-200"
          >
            ← トップへ戻る
          </button>
        )}
        <div className="text-center mb-10 pt-4">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 mb-6 shadow-xl shadow-primary-500/30 text-white">
            <MapPin className="h-10 w-10" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">TEPPEN MEO</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm font-medium">店舗集客を最大化する次世代プラットフォーム</p>
        </div>

        {!isSupabaseConfigured && (
          <div className="mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 text-sm rounded-xl border border-yellow-200 dark:border-yellow-800">
            Supabaseが未設定のため、メールログインは利用できません。開発中はデモログインでUI確認できます。
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">メールアドレス</label>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <UserIcon className="h-5 w-5 text-gray-400 group-focus-within:text-primary-500 transition-colors" />
              </div>
              <input
                data-testid="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10 block w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl p-3.5 focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all outline-none dark:text-white"
                placeholder="you@example.com"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">パスワード</label>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Lock className="h-5 w-5 text-gray-400 group-focus-within:text-primary-500 transition-colors" />
              </div>
              <input
                data-testid="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-10 block w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl p-3.5 focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all outline-none dark:text-white"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          {error && (
            <div className="p-4 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 text-sm rounded-xl flex items-center border border-red-100 dark:border-red-900/50">
                <span className="mr-2 text-lg">⚠️</span> {error}
            </div>
          )}

          <button
            data-testid="login-submit"
            type="submit"
            disabled={isLoading}
            className="w-full flex justify-center py-4 px-4 border border-transparent rounded-xl shadow-lg shadow-primary-500/30 text-sm font-bold text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-all disabled:opacity-70 disabled:shadow-none hover:-translate-y-0.5"
          >
            {isLoading ? <Loader2 className="animate-spin" /> : 'ログインして管理画面へ'}
          </button>
        </form>

        {showDemoLogin && (
          <div className="mt-8 pt-6 border-t border-gray-100 dark:border-gray-700 text-center text-xs text-gray-500 dark:text-gray-400">
            <p className="mb-3 font-medium">開発用デモログイン:</p>
            <div className="flex justify-center gap-3">
              <button
                type="button"
                className="hover:text-primary-600 bg-gray-100 dark:bg-gray-700 px-3 py-1 rounded-full transition-colors"
                onClick={() => handleDemoLogin('admin')}
              >
                Admin
              </button>
              <button
                type="button"
                className="hover:text-primary-600 bg-gray-100 dark:bg-gray-700 px-3 py-1 rounded-full transition-colors"
                onClick={() => handleDemoLogin('manager')}
              >
                Manager
              </button>
              <button
                type="button"
                className="hover:text-primary-600 bg-gray-100 dark:bg-gray-700 px-3 py-1 rounded-full transition-colors"
                onClick={() => handleDemoLogin('user')}
              >
                User
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
