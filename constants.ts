
import {
  User,
  Role,
  SocialAccount,
  Post,
  PostStatus,
  InboxMessage,
  ProviderCatalog,
  ProviderCapability,
  VisibilityState,
} from './types';

export const MOCK_USERS: User[] = [
  {
    id: 'u1',
    username: 'admin',
    name: '神宮寺 開発 (Admin)',
    email: 'dev@teppen.meo',
    role: Role.ADMIN,
    avatarUrl: 'https://picsum.photos/100/100?random=1',
    plan: 'ENTERPRISE',
    lastLoginAt: new Date(),
    storeInfo: {
      address: '東京都港区六本木1-1-1',
      phone: '03-1234-5678',
      category: 'ITサービス',
      businessHours: '10:00 - 19:00'
    }
  },
  {
    id: 'u2',
    username: 'manager',
    name: '西園寺 代理店 (Manager)',
    email: 'agency@partner.com',
    role: Role.MANAGER,
    avatarUrl: 'https://picsum.photos/100/100?random=2',
    plan: 'PROFESSIONAL',
    lastLoginAt: new Date(Date.now() - 86400000), // 1日前
    storeInfo: {
      address: '大阪府大阪市北区梅田2-2-2',
      phone: '06-8765-4321',
      category: 'マーケティング代理店'
    }
  },
  {
    id: 'u3',
    username: 'user',
    name: '伊集院 オーナー (User)',
    email: 'owner@shop-teppen.jp',
    role: Role.USER,
    avatarUrl: 'https://picsum.photos/100/100?random=3',
    plan: 'STARTER',
    lastLoginAt: new Date(Date.now() - 172800000), // 2日前
    storeInfo: {
      address: '福岡県福岡市博多区博多駅前3-3-3',
      phone: '092-111-2222',
      category: '飲食店',
      businessHours: '11:00 - 23:00'
    }
  }
];

export const MOCK_ACCOUNTS: SocialAccount[] = [
  { id: 'sa1', platform: 'INSTAGRAM', name: 'TEPPEN公式', handle: '@teppen_official', isConnected: true },
  { id: 'sa2', platform: 'FACEBOOK', name: 'TEPPEN Facebook', handle: 'Teppen Page', isConnected: true },
  { id: 'sa3', platform: 'GOOGLE_BUSINESS', name: 'TEPPEN総本店', handle: 'Google Maps', isConnected: true },
];

export const MOCK_POSTS: Post[] = [
  {
    id: 'p1',
    content: '春の新作メニューが登場しました！🌸 #新作 #ランチ #TEPPEN',
    imageUrls: ['https://picsum.photos/400/300?random=10'],
    platforms: ['INSTAGRAM', 'FACEBOOK'],
    publishedDate: new Date('2023-04-01T10:00:00'),
    status: PostStatus.PUBLISHED,
    approvalStatus: 'APPROVED',
    approvedAt: new Date('2023-03-31T12:00:00'),
    authorId: 'u1'
  },
  {
    id: 'p2',
    content: 'ゴールデンウィークの営業時間のお知らせです。',
    imageUrls: [],
    platforms: ['GOOGLE_BUSINESS'],
    scheduledDate: new Date('2023-04-25T09:00:00'),
    status: PostStatus.SCHEDULED,
    approvalStatus: 'PENDING',
    submittedForApprovalAt: new Date('2023-04-24T18:00:00'),
    authorId: 'u2'
  },
  {
    id: 'p3',
    content: '雨の日限定クーポン配布中！足元にお気をつけてお越しください☔️',
    imageUrls: ['https://picsum.photos/400/300?random=11'],
    platforms: ['INSTAGRAM'],
    scheduledDate: new Date(new Date().setDate(new Date().getDate() + 2)), // 2日後
    status: PostStatus.SCHEDULED,
    approvalStatus: 'APPROVED',
    approvedAt: new Date(),
    authorId: 'u1'
  }
];

export const MOCK_MESSAGES: InboxMessage[] = [
  {
    id: 'm1',
    platform: 'INSTAGRAM',
    senderName: '田中 みさき',
    content: 'このメニューはディナータイムでも注文できますか？',
    receivedAt: new Date(new Date().setHours(new Date().getHours() - 2)),
    isReplied: false,
    replyDraftContent: 'お問い合わせありがとうございます。ディナータイムでもご注文いただけます。ご来店を心よりお待ちしております。',
    replyDraftStatus: 'PENDING_APPROVAL',
    replyDraftGeneratedAt: new Date(new Date().setHours(new Date().getHours() - 1)),
    tags: ['要返信', 'メニュー'],
    dueAt: new Date(new Date().setHours(new Date().getHours() + 6)),
    slaStatus: 'AT_RISK',
    senderAvatar: 'https://picsum.photos/50/50?random=20'
  },
  {
    id: 'm2',
    platform: 'GOOGLE_BUSINESS',
    senderName: 'Kenji S.',
    content: '駐車場はありますか？',
    receivedAt: new Date(new Date().setHours(new Date().getHours() - 5)),
    isReplied: true,
    replyContent: 'はい、店舗裏に3台分の駐車スペースがございます。',
    tags: ['完了'],
    slaStatus: 'COMPLETED',
    senderAvatar: 'https://picsum.photos/50/50?random=21'
  },
  {
    id: 'm3',
    platform: 'FACEBOOK',
    senderName: 'Sample User',
    content: '素晴らしい雰囲気ですね！また行きます。',
    receivedAt: new Date(new Date().setDate(new Date().getDate() - 1)),
    isReplied: false,
    tags: ['好意的'],
    dueAt: new Date(new Date().setHours(new Date().getHours() - 2)),
    slaStatus: 'OVERDUE',
    senderAvatar: 'https://picsum.photos/50/50?random=22'
  }
];

// 日本の祝日（簡易モック）
export const HOLIDAYS: Record<string, string> = {
  '1/1': '元日',
  '2/11': '建国記念の日',
  '2/23': '天皇誕生日',
  '3/20': '春分の日',
  '4/29': '昭和の日',
  '5/3': '憲法記念日',
  '5/4': 'みどりの日',
  '5/5': 'こどもの日',
  '7/15': '海の日',
  '8/11': '山の日',
  '9/16': '敬老の日',
  '9/22': '秋分の日',
  '10/14': 'スポーツの日',
  '11/3': '文化の日',
  '11/23': '勤労感謝の日',
};

export const DEFAULT_PROVIDER_CATALOGS: ProviderCatalog[] = [
  {
    id: 'builtin-gbp',
    orgId: '',
    providerKey: 'GBP',
    displayName: 'Google Business Profile',
    providerKind: 'NATIVE',
    authKind: 'OAUTH2',
    defaultVisibility: 'ADMIN_ONLY',
    isActive: true,
  },
  {
    id: 'builtin-instagram',
    orgId: '',
    providerKey: 'INSTAGRAM',
    displayName: 'Instagram',
    providerKind: 'NATIVE',
    authKind: 'OAUTH2',
    defaultVisibility: 'ADMIN_ONLY',
    isActive: true,
  },
  {
    id: 'builtin-facebook',
    orgId: '',
    providerKey: 'FACEBOOK',
    displayName: 'Facebook',
    providerKind: 'NATIVE',
    authKind: 'OAUTH2',
    defaultVisibility: 'ADMIN_ONLY',
    isActive: true,
  },
];

export const DEFAULT_PROVIDER_CAPABILITIES: ProviderCapability[] = [
  {
    id: 'cap-gbp',
    providerCatalogId: 'builtin-gbp',
    canConnect: true,
    canSyncInbox: true,
    canPublish: false,
    canReply: true,
    canFetchMetrics: true,
  },
  {
    id: 'cap-instagram',
    providerCatalogId: 'builtin-instagram',
    canConnect: true,
    canSyncInbox: true,
    canPublish: true,
    canReply: false,
    canFetchMetrics: true,
  },
  {
    id: 'cap-facebook',
    providerCatalogId: 'builtin-facebook',
    canConnect: true,
    canSyncInbox: true,
    canPublish: true,
    canReply: true,
    canFetchMetrics: true,
  },
];

export const DEFAULT_FEATURE_VISIBILITY: Record<string, VisibilityState> = {
  dashboard: 'ENABLED',
  calendar: 'ENABLED',
  survey: 'ENABLED',
  create_post: 'ENABLED',
  post_list: 'ENABLED',
  inbox: 'ENABLED',
  user_management: 'ENABLED',
  settings_profile: 'ENABLED',
  settings_store: 'ENABLED',
  settings_integrations: 'ENABLED',
  settings_system: 'ADMIN_ONLY',
  provider_management: 'ADMIN_ONLY',
};
