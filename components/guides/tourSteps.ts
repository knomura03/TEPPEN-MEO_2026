import { ViewState } from '../../types';
import { NAV_LABELS } from '../ui/copy';

export type TourPlacement = 'top' | 'bottom' | 'left' | 'right' | 'center';

export interface TourStep {
  id: string;
  title: string;
  content: string;
  targetId?: string;
  position?: TourPlacement;
}

const PAGE_SUMMARY_BY_VIEW: Record<ViewState, string> = {
  DASHBOARD: '店舗の状況をまとめて確認できます。数字の増減を見て、優先して取り組む項目を決めましょう。',
  BILLING: '契約プランの確認と変更ができます。請求自体は別途（手動）で管理します。',
  CALENDAR: '投稿予定を日付で確認できます。予約投稿の抜け漏れ確認に使います。',
  SURVEY: 'アンケートの作成・公開・結果確認を行います。回答状況を見ながら内容を改善できます。',
  CREATE_POST: 'SNS投稿を作成して下書き保存・予約ができます。',
  POST_LIST: '投稿の状態確認や承認、編集、公開操作をまとめて行えます。',
  INBOX: 'SNSのコメントやメッセージをまとめて確認し、返信できます。',
  RANK_TRACKER: '検索順位と店舗情報の状態を確認できます。',
  USER_MANAGEMENT: 'ユーザー追加、権限管理、契約関連の確認を行えます。',
  SETTINGS: 'プロフィール、店舗情報、SNS連携など、運用設定を管理します。',
};

const SIDEBAR_STEPS: TourStep[] = [
  {
    id: 'sidebar-navigation',
    title: '画面メニュー',
    content: '左のメニューから使いたい機能へ移動できます。',
    targetId: 'nav-DASHBOARD',
    position: 'right',
  },
  {
    id: 'sidebar-theme',
    title: '表示テーマ',
    content: '明るい表示と暗い表示を切り替えられます。',
    targetId: 'theme-toggle',
    position: 'top',
  },
  {
    id: 'sidebar-guide-button',
    title: 'ガイドを再表示',
    content: '使い方をもう一度確認したい時は、このボタンからいつでも再表示できます。',
    targetId: 'open-guide-button',
    position: 'top',
  },
  {
    id: 'sidebar-settings',
    title: 'アカウント設定',
    content: 'プロフィールや各種設定はここから開きます。',
    targetId: 'open-settings-button',
    position: 'top',
  },
  {
    id: 'sidebar-logout',
    title: 'ログアウト',
    content: 'ログアウト時は確認ダイアログが表示されます。誤操作を防ぐため必ず確認してください。',
    targetId: 'sidebar-logout-button',
    position: 'top',
  },
];

export const getTourStepsForView = (view: ViewState): TourStep[] => {
  const pageStep: TourStep = {
    id: `page-${view.toLowerCase()}`,
    title: `${NAV_LABELS[view]}の使い方`,
    content: PAGE_SUMMARY_BY_VIEW[view],
    targetId: 'page-main-content',
    position: 'center',
  };

  return [pageStep, ...SIDEBAR_STEPS];
};
