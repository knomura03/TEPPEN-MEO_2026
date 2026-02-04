import { User, Role, PlanType, StoreInfo } from '../types';
import { MOCK_USERS } from '../constants';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import type { User as SupabaseAuthUser } from '@supabase/supabase-js';

class AuthService {
  private currentUser: User | null = null;
  private demoStorageKey = 'social_sync_user';

  private mapSupabaseUser(user: SupabaseAuthUser): User {
    const email = user.email || '';
    const username = email.includes('@') ? email.split('@')[0] : (email || user.id);

    const roleFromMeta = user.user_metadata?.role;
    const role = roleFromMeta && Object.values(Role).includes(roleFromMeta) ? (roleFromMeta as Role) : Role.USER;

    const planFromMeta = user.user_metadata?.plan;
    const plan: PlanType = planFromMeta || 'FREE';

    const storeInfoFromMeta = (user.user_metadata?.storeInfo || {}) as StoreInfo;

    const lastLoginAt = user.last_sign_in_at ? new Date(user.last_sign_in_at) : new Date();

    return {
      id: user.id,
      username,
      name: user.user_metadata?.name || username,
      email,
      role,
      avatarUrl: user.user_metadata?.avatarUrl,
      plan,
      lastLoginAt,
      storeInfo: storeInfoFromMeta,
    };
  }

  private deserializeDemoUser(stored: unknown): User | null {
    if (!stored || typeof stored !== 'object') return null;
    const u = stored as any;
    if (!u.id || !u.role) return null;
    return {
      ...u,
      lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt) : new Date(),
    } as User;
  }

  async login(email: string, password: string): Promise<User> {
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Supabaseが未設定のため、メールログインできません。');
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (!data.user) throw new Error('ログインに失敗しました。');
    this.currentUser = this.mapSupabaseUser(data.user);
    return this.currentUser;
  }

  // 開発用デモログイン（Supabase未設定時のUI確認用）
  async loginDemo(username: string): Promise<User | null> {
    const user = MOCK_USERS.find((u) => u.username === username);
    if (!user) return null;
    this.currentUser = user;
    localStorage.setItem(this.demoStorageKey, JSON.stringify({ ...user, lastLoginAt: user.lastLoginAt.toISOString() }));
    return user;
  }

  async logout(): Promise<void> {
    this.currentUser = null;

    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
      return;
    }

    localStorage.removeItem(this.demoStorageKey);
  }

  async getCurrentUser(): Promise<User | null> {
    if (this.currentUser) return this.currentUser;

    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.auth.getSession();
      if (error) return null;
      const sessionUser = data.session?.user;
      if (!sessionUser) return null;
      this.currentUser = this.mapSupabaseUser(sessionUser);
      return this.currentUser;
    }

    const storedUser = localStorage.getItem(this.demoStorageKey);
    if (!storedUser) return null;
    try {
      const parsed = JSON.parse(storedUser);
      this.currentUser = this.deserializeDemoUser(parsed);
      return this.currentUser;
    } catch {
      return null;
    }
  }

  // 権限チェックヘルパー
  canManageUsers(user: User): boolean {
    return user.role === Role.ADMIN || user.role === Role.MANAGER;
  }

  canManageSettings(user: User): boolean {
    return user.role === Role.ADMIN;
  }
}

export const authService = new AuthService();
