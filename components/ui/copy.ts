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

export const TOUR_COPY = {
  stepLabel: 'ガイド',
  nextLabel: '次へ',
  previousLabel: '前へ',
  finishLabel: '完了',
} as const;
