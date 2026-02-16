import React, { useEffect, useState } from 'react';
import { Lock, Loader2 } from 'lucide-react';
import { User } from '../types';
import { authService } from '../services/authService';
import { isSupabaseConfigured, supabase } from '../services/supabaseClient';

interface InviteOnboardingViewProps {
  onCompleted: (user: User) => void;
  onBackToLogin: () => void;
}

const toReadableError = (raw: string): string => {
  const message = decodeURIComponent(raw || '').trim();
  if (!message) return '招待リンクが無効、または期限切れです。管理者に再発行を依頼してください。';
  return message;
};

export const InviteOnboardingView: React.FC<InviteOnboardingViewProps> = ({
  onCompleted,
  onBackToLogin,
}) => {
  const [isInitializing, setIsInitializing] = useState(true);
  const [inviteError, setInviteError] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [email, setEmail] = useState('');

  useEffect(() => {
    const bootstrap = async () => {
      if (!isSupabaseConfigured || !supabase) {
        setInviteError('Supabase設定が不足しているため、招待リンクを処理できません。');
        setIsInitializing(false);
        return;
      }

      const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
      const hashParams = new URLSearchParams(hash);
      const accessToken = hashParams.get('access_token') || '';
      const refreshToken = hashParams.get('refresh_token') || '';
      const hashError = hashParams.get('error') || '';
      const hashErrorDescription = hashParams.get('error_description') || '';

      if (hashError) {
        setInviteError(toReadableError(hashErrorDescription || hashError));
        setIsInitializing(false);
        return;
      }

      if (accessToken && refreshToken) {
        const { error: setSessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (setSessionError) {
          setInviteError(toReadableError(setSessionError.message));
          setIsInitializing(false);
          return;
        }
        window.history.replaceState({}, '', '/invite');
      }

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session?.user) {
        setInviteError(toReadableError(sessionError?.message || '招待セッションが見つかりません。'));
        setIsInitializing(false);
        return;
      }

      setEmail(sessionData.session.user.email || '');
      setInviteError('');
      setIsInitializing(false);
    };

    void bootstrap();
  }, []);

  const handleSetPassword = async () => {
    if (!isSupabaseConfigured || !supabase) return;
    const normalized = password.trim();
    if (normalized.length < 8) {
      setInviteError('パスワードは8文字以上で入力してください。');
      return;
    }
    if (normalized !== passwordConfirm.trim()) {
      setInviteError('パスワード確認が一致しません。');
      return;
    }

    setIsSavingPassword(true);
    setInviteError('');
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: normalized });
      if (updateError) {
        setInviteError(toReadableError(updateError.message));
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id;
      if (userId) {
        await supabase
          .from('profiles')
          .update({ password_set_at: new Date().toISOString() })
          .eq('id', userId);
      }

      const appUser = await authService.refreshCurrentUser();
      if (appUser) {
        onCompleted(appUser);
        return;
      }

      onBackToLogin();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'パスワード設定に失敗しました。';
      setInviteError(toReadableError(message));
    } finally {
      setIsSavingPassword(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-lg p-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">初回ログイン設定</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          招待リンクを確認しました。利用開始のため、パスワードを設定してください。
        </p>
        {email && (
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            対象アカウント: {email}
          </p>
        )}

        {isInitializing ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            セッションを確認しています...
          </div>
        ) : inviteError ? (
          <div className="mt-6 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-300">
            {inviteError}
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                新しいパスワード
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  data-testid="invite-password-input"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600"
                  placeholder="8文字以上"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                新しいパスワード（確認）
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  data-testid="invite-password-confirm-input"
                  type="password"
                  value={passwordConfirm}
                  onChange={(event) => setPasswordConfirm(event.target.value)}
                  className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600"
                  placeholder="確認用"
                />
              </div>
            </div>
            <button
              data-testid="invite-password-submit"
              type="button"
              onClick={() => void handleSetPassword()}
              disabled={isSavingPassword}
              className="w-full py-3 rounded-xl bg-primary-600 hover:bg-primary-700 text-white font-medium disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSavingPassword ? '保存中...' : 'パスワードを設定して開始'}
            </button>
          </div>
        )}

        <div className="mt-6">
          <button
            type="button"
            onClick={onBackToLogin}
            className="text-sm text-primary-700 dark:text-primary-300 hover:underline"
          >
            ログイン画面へ戻る
          </button>
        </div>
      </div>
    </div>
  );
};
