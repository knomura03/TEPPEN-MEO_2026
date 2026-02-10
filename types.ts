
export enum Role {
  ADMIN = 'ADMIN',           // 内部: 全権管理者
  SUPERVISOR = 'SUPERVISOR', // 内部: 販売代理店（旧MANAGER）
  MANAGER = 'MANAGER',       // 顧客: ORGリーダー（店舗責任者）
  USER = 'USER'              // 顧客: 一般ユーザー
}

// Contract plan code. Source of truth is `billing_plans.code` (e.g., FREE, STANDARD, PRO).
export type PlanType = string;

export interface BillingPlan {
  id: string;
  code: string;
  name: string;
  amountMonthly: number;
  currency: string;
  isActive: boolean;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrgSubscription {
  id: string;
  orgId: string;
  billingPlanId?: string | null;
  billingPlan?: BillingPlan | null;
  status: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
  updatedAt: Date;
}

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

export type RankCollectionMode = 'REAL' | 'MOCK';
export type RankCollectionTriggerType = 'MANUAL' | 'SCHEDULED';
export type RankCollectionRunStatus = 'RUNNING' | 'SUCCESS' | 'FAILED';
export type RankCollectionResultStatus = 'SUCCESS' | 'FAILED';

export interface RankCollectionRun {
  id: string;
  storeId: string;
  triggerType: RankCollectionTriggerType;
  mode: RankCollectionMode;
  status: RankCollectionRunStatus;
  message?: string;
  requestedByUserId?: string;
  startedAt: Date;
  finishedAt?: Date;
  createdAt: Date;
}

export interface RankCollectionResult {
  id: string;
  runId: string;
  storeId: string;
  rankKeywordId: string;
  keyword: string;
  position?: number;
  mode: RankCollectionMode;
  status: RankCollectionResultStatus;
  message?: string;
  raw: Record<string, unknown>;
  createdAt: Date;
}

export interface RankCollectionExecutionResult {
  ok: boolean;
  runId: string;
  mode: RankCollectionMode;
  status: RankCollectionRunStatus;
  collectedCount: number;
  collectedCompetitorCount?: number;
  competitorSkippedReason?: string;
  message?: string;
}

export interface RankCollectionRunDetail {
  run: RankCollectionRun;
  results: RankCollectionResult[];
  competitorSnapshots: CompetitorMetricSnapshot[];
  competitorSkippedReason?: string;
}

export interface CompetitorTarget {
  id: string;
  storeId: string;
  name: string;
  note?: string;
  isActive: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompetitorMetricSnapshot {
  id: string;
  runId: string;
  storeId: string;
  competitorTargetId: string;
  competitorName: string;
  mapRank?: number;
  reviewCount: number;
  rating?: number;
  mode: RankCollectionMode;
  status: RankCollectionResultStatus;
  message?: string;
  raw: Record<string, unknown>;
  collectedAt: Date;
  createdAt: Date;
}

export type NapConsistencyRunStatus = 'RUNNING' | 'SUCCESS' | 'FAILED';
export type NapConsistencyResultStatus = 'MATCH' | 'MISMATCH' | 'MISSING';

export interface NapConsistencySummary {
  total: number;
  match: number;
  mismatch: number;
  missing: number;
}

export interface NapConsistencyRun {
  id: string;
  storeId: string;
  triggerType: 'MANUAL' | 'SCHEDULED';
  status: NapConsistencyRunStatus;
  message?: string;
  summary: NapConsistencySummary;
  requestedByUserId?: string;
  startedAt: Date;
  finishedAt?: Date;
  createdAt: Date;
}

export interface NapConsistencyResult {
  id: string;
  runId: string;
  storeId: string;
  providerCatalogId?: string;
  providerKey: string;
  providerName: string;
  expectedName?: string;
  expectedAddress?: string;
  expectedPhone?: string;
  observedName?: string;
  observedAddress?: string;
  observedPhone?: string;
  nameMatch?: boolean;
  addressMatch?: boolean;
  phoneMatch?: boolean;
  status: NapConsistencyResultStatus;
  mismatchFields: string[];
  message?: string;
  details: Record<string, unknown>;
  createdAt: Date;
}

export interface NapConsistencyExecutionResult {
  ok: boolean;
  runId: string;
  status: NapConsistencyRunStatus;
  summary: NapConsistencySummary;
  message?: string;
}

export type NapAlertStatus = 'OPEN' | 'ACKED' | 'RESOLVED';

export interface NapAlert {
  id: string;
  storeId: string;
  providerCatalogId?: string;
  providerKey: string;
  providerName: string;
  status: NapAlertStatus;
  lastResultStatus: NapConsistencyResultStatus;
  mismatchFields: string[];
  lastRunId?: string;
  lastResultId?: string;
  firstDetectedAt: Date;
  openedAt: Date;
  lastDetectedAt: Date;
  lastCheckedAt: Date;
  acknowledgedAt?: Date;
  acknowledgedByUserId?: string;
  resolvedAt?: Date;
  resolvedByUserId?: string;
  note?: string;
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
  headerImageUrl?: string;
  headerImageStoragePath?: string;
  questionText?: string;
  thanksTitle?: string;
  thanksBody?: string;
  thanksPositiveMessage?: string;
  thanksNegativeMessage?: string;
  thanksButtonText?: string;
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
  | 'BILLING'
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
