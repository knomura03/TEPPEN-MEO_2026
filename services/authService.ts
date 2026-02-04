import { User, Role } from '../types';
import { MOCK_USERS } from '../constants';

class AuthService {
  private currentUser: User | null = null;

  // ログイン処理（モック）
  // 実際にはAPIリクエストを行う
  async login(username: string): Promise<User | null> {
    // 簡易的な認証ロジック: ユーザー名が存在すればログイン成功とする
    // パスワードチェックはデモのため省略
    const user = MOCK_USERS.find(u => u.username === username);
    if (user) {
      this.currentUser = user;
      localStorage.setItem('social_sync_user', JSON.stringify(user));
      return user;
    }
    return null;
  }

  logout(): void {
    this.currentUser = null;
    localStorage.removeItem('social_sync_user');
  }

  async getCurrentUser(): Promise<User | null> {
    if (this.currentUser) return this.currentUser;

    const storedUser = localStorage.getItem('social_sync_user');
    if (storedUser) {
      this.currentUser = JSON.parse(storedUser);
      return this.currentUser;
    }
    return null;
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