import { ViewState } from '../../types';

export const NAV_LABELS: Record<ViewState, string> = {
  DASHBOARD: 'ダッシュボード',
  BILLING: '契約プラン',
  ADVICE: '集客アドバイス',
  CALENDAR: 'カレンダー',
  SURVEY: 'アンケート',
  CREATE_POST: '新規投稿',
  POST_TEMPLATES: '投稿テンプレート',
  BRAND_KIT: 'ブランドキット',
  POST_LIST: '投稿一覧',
  INBOX: '受信箱',
  RANK_TRACKER: '検索順位チェック',
  USER_MANAGEMENT: 'ユーザー管理',
  STORE_MANAGEMENT: '店舗管理',
  PLATFORM_MANAGEMENT: 'プラットフォーム管理',
  GROUP_MANAGEMENT: 'グループ管理',
  MANAGEMENT_UNIT_MANAGEMENT: '管理ユニット管理',
  SETTINGS: '設定',
};

export const COMMON_COPY = {
  appName: 'TEPPEN MEO PLATFORM',
  externalBillingLabel: '別途（手動）で管理',
  providerLabel: '連携先（SNS）',
  providerManagementLabel: '連携先の管理',
  storeScopeLabel: '店舗ごと',
  oauthShortLabel: '連携認証',
  runtimeShortLabel: '利用状態',
  thresholdLabel: '口コミ案内の基準点',
  inboxLabel: '受信箱（コメント/メッセージ）',
  napLabel: '店舗情報（名称/住所/電話）',
  multiStoreSnsDisabled:
    '複数店舗選択中は、SNS連携/同期/投稿/返信/指標取得ができません。店舗を1つだけ選択してください。',
} as const;

export const SETTINGS_COPY = {
  providerTechnicalDetailTitle: '技術情報（詳細）',
  providerTechnicalDetailDescription: '通常運用では不要な技術情報です。障害対応時のみ確認してください。',
} as const;

export const SYSTEM_FEATURE_OPTIONS = [
  { key: 'dashboard', label: 'ダッシュボード', description: 'メニュー: ダッシュボード' },
  { key: 'create_post', label: '新規投稿', description: 'メニュー: 新規投稿' },
  { key: 'post_templates', label: '投稿テンプレート', description: 'メニュー: 投稿テンプレート' },
  { key: 'brand_kit', label: 'ブランドキット', description: 'メニュー: ブランドキット' },
  { key: 'post_list', label: '投稿一覧', description: 'メニュー: 投稿一覧' },
  { key: 'calendar', label: 'カレンダー', description: 'メニュー: カレンダー' },
  { key: 'inbox', label: '受信箱', description: 'メニュー: 受信箱' },
  { key: 'survey', label: 'アンケート', description: 'メニュー: アンケート' },
  { key: 'rank_tracker', label: '検索順位チェック', description: 'メニュー: 検索順位チェック' },
  { key: 'advice', label: '集客アドバイス', description: 'メニュー: 集客アドバイス' },
  { key: 'user_management', label: 'ユーザー管理', description: 'メニュー: ユーザー管理' },
  { key: 'store_management', label: '店舗管理', description: 'メニュー: 店舗管理' },
  { key: 'group_management', label: 'グループ管理', description: 'メニュー: グループ管理' },
  { key: 'management_unit_management', label: '管理ユニット管理', description: 'メニュー: 管理ユニット管理（ADMINのみ）' },
  { key: 'billing', label: '契約プラン', description: 'メニュー: 契約プラン' },
  { key: 'platform_management', label: 'プラットフォーム管理', description: 'メニュー: プラットフォーム管理' },
  { key: 'remote_posts_autofetch', label: '投稿一覧の外部投稿 自動取得', description: 'ONで投稿一覧を開いたときに外部投稿を自動取得（5分キャッシュ）' },
  { key: 'inbox_autosync', label: '受信箱の自動同期', description: 'ONで受信箱を開いたときに口コミ・コメントを自動同期' },
] as const;

export const TOUR_COPY = {
  stepLabel: 'ガイド',
  nextLabel: '次へ',
  previousLabel: '前へ',
  finishLabel: '完了',
} as const;
