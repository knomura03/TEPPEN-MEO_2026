
export enum Role {
  ADMIN = 'ADMIN',     // 開発者・全権管理者
  MANAGER = 'MANAGER', // 販売者・代理店
  USER = 'USER'        // 店舗オーナー
}

export type PlanType = 'FREE' | 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';

export interface StoreInfo {
  address?: string;
  phone?: string;
  website?: string;
  category?: string;
  businessHours?: string;
}

// DB上の店舗（MVP）
export interface Store {
  id: string;
  orgId: string;
  name: string;
  address?: string;
  phone?: string;
  website?: string;
  category?: string;
  businessHours?: string;
}

export interface User {
  id: string;
  username: string;
  name: string;
  email: string;
  role: Role;
  avatarUrl?: string;
  plan: PlanType;
  lastLoginAt: Date;
  storeInfo?: StoreInfo;
}

export type SocialPlatform = 'INSTAGRAM' | 'FACEBOOK' | 'GOOGLE_BUSINESS' | 'TIKTOK';

export interface SocialAccount {
  id: string;
  platform: SocialPlatform;
  name: string;
  handle: string;
  isConnected: boolean;
}

export enum PostStatus {
  DRAFT = 'DRAFT',
  SCHEDULED = 'SCHEDULED',
  PUBLISHED = 'PUBLISHED',
  FAILED = 'FAILED'
}

export interface Post {
  id: string;
  content: string;
  imageUrls: string[];
  platforms: SocialPlatform[];
  scheduledDate?: Date;
  publishedDate?: Date;
  status: PostStatus;
  authorId: string;
}

export interface InboxMessage {
  id: string;
  platform: SocialPlatform;
  senderName: string;
  senderAvatar?: string;
  content: string;
  receivedAt: Date;
  isReplied: boolean;
  replyContent?: string;
}

export type ViewState = 'DASHBOARD' | 'CREATE_POST' | 'POST_LIST' | 'USER_MANAGEMENT' | 'CALENDAR' | 'INBOX' | 'SETTINGS';

// チャート用データ型
export interface AnalyticsData {
  name: string;
  value: number;
}

// 通知関連
export type NotificationType = 'SUCCESS' | 'ERROR' | 'INFO' | 'WARNING';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: Date;
  isRead: boolean;
}
