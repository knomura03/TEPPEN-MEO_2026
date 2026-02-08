
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

export interface StoreGroup {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  storeIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface RankKeyword {
  id: string;
  storeId: string;
  keyword: string;
  note?: string;
  isActive: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrgStorePolicy {
  orgId: string;
  defaultUserStoreLimit: number;
  allowUserStoreCreation: boolean;
  updatedBy?: string;
  updatedAt?: Date;
}

export interface UserStoreControl {
  orgId: string;
  userId: string;
  maxStores?: number;
  allowCsvStoreBulkCreate: boolean;
  effectiveStoreLimit?: number;
  currentStoreCount?: number;
  updatedBy?: string;
  updatedAt?: Date;
}

export interface StoreCsvRow {
  storeName: string;
  address: string;
  phone: string;
  category: string;
  businessHours?: string;
  website?: string;
  note?: string;
}

export interface StoreCsvValidationError {
  line: number;
  column: string;
  code: string;
  message: string;
}

export interface StoreCsvImportResult {
  ok: boolean;
  createdCount: number;
  errors: StoreCsvValidationError[];
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

export type ProviderKind = 'NATIVE' | 'GENERIC';
export type ProviderAuthKind = 'OAUTH2' | 'API_KEY' | 'WEBHOOK' | 'NONE';
export type VisibilityState = 'HIDDEN' | 'ADMIN_ONLY' | 'ENABLED';
export type ProviderConnectionStatus = 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
export type ProviderTestMode = 'REAL' | 'MOCK';
export type ProviderRuntimeMode = 'ACTIVE' | 'DEGRADED' | 'BLOCKED';

export interface ProviderCatalog {
  id: string;
  orgId: string;
  providerKey: string;
  displayName: string;
  providerKind: ProviderKind;
  authKind: ProviderAuthKind;
  defaultVisibility: VisibilityState;
  isActive: boolean;
}

export interface ProviderCapability {
  id: string;
  providerCatalogId: string;
  canConnect: boolean;
  canSyncInbox: boolean;
  canPublish: boolean;
  canReply: boolean;
  canFetchMetrics: boolean;
}

export interface ProviderConfiguration {
  id: string;
  storeId: string;
  providerCatalogId: string;
  config: Record<string, unknown>;
  hasGuiConfig: boolean;
  connectionStatus: ProviderConnectionStatus;
  lastTestedAt?: Date;
  lastError?: string;
  secretUpdatedAt?: Date;
}

export interface ProviderReadiness {
  providerKey: string;
  hasGuiConfig: boolean;
  hasAdapter: boolean;
  connectionStatus: ProviderConnectionStatus;
  testMode: ProviderTestMode;
  runtimeMode: ProviderRuntimeMode;
}

export interface FeatureFlag {
  id: string;
  orgId: string;
  storeId?: string;
  featureKey: string;
  state: VisibilityState;
  note?: string;
}

export interface StoreGroupFeatureFlagApplyResult {
  appliedStoreCount: number;
  skippedStoreCount: number;
}

export interface ProviderAdapter {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  syncInbox: () => Promise<void>;
  publishPost: () => Promise<void>;
  replyMessage: () => Promise<void>;
  healthCheck: () => Promise<void>;
}

export type OAuthSessionStatus = 'PENDING' | 'COMPLETED' | 'EXPIRED' | 'FAILED' | 'DISCONNECTED';

export interface OAuthStartResult {
  stateToken: string;
  authorizationUrl: string;
  providerKey: string;
  expiresAt?: Date;
}

export interface OAuthCompleteResult {
  ok: boolean;
  providerKey: string;
  storeId: string;
  integrationId: string;
}

export interface OAuthDisconnectResult {
  ok: boolean;
  providerKey: string;
  storeId: string;
}

export type SurveyStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface Survey {
  id: string;
  storeId: string;
  authorUserId?: string;
  title: string;
  description?: string;
  reviewRedirectUrl?: string;
  positiveThreshold: number;
  status: SurveyStatus;
  publicToken?: string;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  responseCount: number;
}

export type SurveyBranchType = 'POSITIVE' | 'NEGATIVE';
export type SurveyEventType = 'VIEW' | 'REDIRECT_CLICK';

export interface SurveyResponse {
  id: string;
  surveyId: string;
  rating: number;
  comment?: string;
  branchType: SurveyBranchType;
  source: string;
  createdAt: Date;
}

export interface SurveyAnalytics {
  surveyId: string;
  viewCount: number;
  responseCount: number;
  completionRate: number;
  positiveCount: number;
  negativeCount: number;
  positiveRate: number;
  negativeRate: number;
  redirectClickCount: number;
  redirectClickRate: number;
}

export enum PostStatus {
  DRAFT = 'DRAFT',
  SCHEDULED = 'SCHEDULED',
  PUBLISHED = 'PUBLISHED',
  FAILED = 'FAILED'
}

export type PostApprovalStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
export type PostApprovalActionType = 'SUBMIT' | 'APPROVE' | 'REJECT' | 'COMMENT';

export interface Post {
  id: string;
  storeId?: string;
  content: string;
  imageUrls: string[];
  platforms: SocialPlatform[];
  scheduledDate?: Date;
  publishedDate?: Date;
  status: PostStatus;
  approvalStatus: PostApprovalStatus;
  submittedForApprovalAt?: Date;
  approvedAt?: Date;
  approvedByUserId?: string;
  rejectedAt?: Date;
  rejectedByUserId?: string;
  rejectionReason?: string;
  authorId: string;
}

export interface BrandKit {
  id: string;
  orgId: string;
  toneGuide?: string;
  bannedWords: string[];
  recommendedHashtags: string[];
  defaultSignature?: string;
  updatedBy?: string;
  updatedAt?: Date;
}

export interface PostContentTemplate {
  id: string;
  orgId: string;
  title: string;
  body: string;
  defaultPlatforms: SocialPlatform[];
  isActive: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PostContentLintResult {
  matchedBannedWords: string[];
  missingRecommendedHashtags: string[];
}

export type PostPublishMode = 'REAL' | 'MOCK';
export type PostPublishResultStatus = 'SUCCESS' | 'FAILED';

export interface PostPublishLog {
  id: string;
  postId: string;
  storeId: string;
  provider: string;
  mode: PostPublishMode;
  status: PostPublishResultStatus;
  message?: string;
  externalPostId?: string;
  requestedByUserId?: string;
  createdAt: Date;
}

export interface PublishExecutionResult {
  ok: boolean;
  provider: string;
  mode: PostPublishMode;
  status: PostPublishResultStatus;
  externalPostId?: string;
  message?: string;
}

export interface ReplyExecutionResult {
  ok: boolean;
  provider: string;
  mode: PostPublishMode;
  status: PostPublishResultStatus;
  externalReplyId?: string;
  message?: string;
}

export interface InboxReplyLog {
  id: string;
  messageId: string;
  storeId: string;
  provider: string;
  mode: PostPublishMode;
  status: PostPublishResultStatus;
  message?: string;
  externalReplyId?: string;
  requestedByUserId?: string;
  createdAt: Date;
}

export type InboxSlaStatus = 'ON_TRACK' | 'AT_RISK' | 'OVERDUE' | 'COMPLETED';

export interface InboxAssignableUser {
  id: string;
  name: string;
  role: Role;
}

export interface BulkPostCreateResult {
  createdPosts: Post[];
  targetStoreCount: number;
}

export interface PostApprovalComment {
  id: string;
  postId: string;
  actorUserId?: string;
  actionType: PostApprovalActionType;
  comment?: string;
  createdAt: Date;
}

export type ReplyDraftStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'DISMISSED';

export interface InboxMessage {
  id: string;
  platform: SocialPlatform;
  senderName: string;
  senderAvatar?: string;
  content: string;
  receivedAt: Date;
  isReplied: boolean;
  replyContent?: string;
  replyDraftContent?: string;
  replyDraftStatus?: ReplyDraftStatus;
  replyDraftGeneratedAt?: Date;
  replyDraftApprovedAt?: Date;
  tags?: string[];
  assignedUserId?: string;
  assignedUserName?: string;
  dueAt?: Date;
  slaStatus?: InboxSlaStatus;
}

export type ViewState =
  | 'DASHBOARD'
  | 'CREATE_POST'
  | 'POST_LIST'
  | 'USER_MANAGEMENT'
  | 'CALENDAR'
  | 'INBOX'
  | 'SURVEY'
  | 'RANK_TRACKER'
  | 'SETTINGS';

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
