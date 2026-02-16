import { ViewState } from '../types';

export const SIDEBAR_NAV_ORDER_UPDATED_EVENT = 'sidebar-nav-order-updated';
const SIDEBAR_NAV_STORAGE_KEY = 'teppen.sidebar.nav.order.v1';
const SIDEBAR_NAV_LABEL_STORAGE_KEY = 'teppen.sidebar.nav.labels.v1';

export type SidebarNavView =
  | 'DASHBOARD'
  | 'CREATE_POST'
  | 'POST_TEMPLATES'
  | 'BRAND_KIT'
  | 'POST_LIST'
  | 'CALENDAR'
  | 'INBOX'
  | 'SURVEY'
  | 'RANK_TRACKER'
  | 'ADVICE'
  | 'USER_MANAGEMENT'
  | 'STORE_MANAGEMENT'
  | 'PLATFORM_MANAGEMENT'
  | 'GROUP_MANAGEMENT'
  | 'MANAGEMENT_UNIT_MANAGEMENT'
  | 'BILLING';

export const SIDEBAR_NAV_DEFAULT_ORDER: SidebarNavView[] = [
  'DASHBOARD',
  'CREATE_POST',
  'POST_TEMPLATES',
  'BRAND_KIT',
  'POST_LIST',
  'CALENDAR',
  'INBOX',
  'SURVEY',
  'RANK_TRACKER',
  'ADVICE',
  'USER_MANAGEMENT',
  'STORE_MANAGEMENT',
  'GROUP_MANAGEMENT',
  'MANAGEMENT_UNIT_MANAGEMENT',
  'PLATFORM_MANAGEMENT',
  'BILLING',
];

export const SIDEBAR_NAV_DEFAULT_LABELS: Record<SidebarNavView, string> = {
  DASHBOARD: 'ダッシュボード',
  CREATE_POST: '新規投稿',
  POST_TEMPLATES: '投稿テンプレート',
  BRAND_KIT: 'ブランドキット',
  POST_LIST: '投稿一覧',
  CALENDAR: 'カレンダー',
  INBOX: '受信箱',
  SURVEY: 'アンケート',
  RANK_TRACKER: '検索順位チェック',
  ADVICE: '集客アドバイス',
  USER_MANAGEMENT: 'ユーザー管理',
  STORE_MANAGEMENT: '店舗管理',
  PLATFORM_MANAGEMENT: 'プラットフォーム管理',
  GROUP_MANAGEMENT: 'グループ管理',
  MANAGEMENT_UNIT_MANAGEMENT: '管理ユニット管理',
  BILLING: '契約プラン',
};

const normalizeSidebarNavOrder = (input: unknown): SidebarNavView[] => {
  if (!Array.isArray(input)) return [...SIDEBAR_NAV_DEFAULT_ORDER];

  const validSet = new Set<SidebarNavView>(SIDEBAR_NAV_DEFAULT_ORDER);
  const unique: SidebarNavView[] = [];
  for (const value of input) {
    if (typeof value !== 'string') continue;
    if (!validSet.has(value as SidebarNavView)) continue;
    if (unique.includes(value as SidebarNavView)) continue;
    unique.push(value as SidebarNavView);
  }
  if (!unique.includes('STORE_MANAGEMENT')) {
    const userManagementIndex = unique.indexOf('USER_MANAGEMENT');
    if (userManagementIndex >= 0) {
      unique.splice(userManagementIndex + 1, 0, 'STORE_MANAGEMENT');
    } else {
      unique.push('STORE_MANAGEMENT');
    }
  }
  if (!unique.includes('GROUP_MANAGEMENT')) {
    const storeManagementIndex = unique.indexOf('STORE_MANAGEMENT');
    if (storeManagementIndex >= 0) {
      unique.splice(storeManagementIndex + 1, 0, 'GROUP_MANAGEMENT');
    } else {
      const userManagementIndex = unique.indexOf('USER_MANAGEMENT');
      if (userManagementIndex >= 0) {
        unique.splice(userManagementIndex + 1, 0, 'GROUP_MANAGEMENT');
      } else {
        unique.push('GROUP_MANAGEMENT');
      }
    }
  }
  if (!unique.includes('MANAGEMENT_UNIT_MANAGEMENT')) {
    const groupManagementIndex = unique.indexOf('GROUP_MANAGEMENT');
    if (groupManagementIndex >= 0) {
      unique.splice(groupManagementIndex + 1, 0, 'MANAGEMENT_UNIT_MANAGEMENT');
    } else {
      unique.push('MANAGEMENT_UNIT_MANAGEMENT');
    }
  }
  if (!unique.includes('PLATFORM_MANAGEMENT')) {
    const managementUnitIndex = unique.indexOf('MANAGEMENT_UNIT_MANAGEMENT');
    if (managementUnitIndex >= 0) {
      unique.splice(managementUnitIndex + 1, 0, 'PLATFORM_MANAGEMENT');
    } else {
      const storeManagementIndex = unique.indexOf('STORE_MANAGEMENT');
      if (storeManagementIndex >= 0) {
        unique.splice(storeManagementIndex + 1, 0, 'PLATFORM_MANAGEMENT');
      } else {
        unique.push('PLATFORM_MANAGEMENT');
      }
    }
  }
  for (const fallback of SIDEBAR_NAV_DEFAULT_ORDER) {
    if (!unique.includes(fallback)) unique.push(fallback);
  }
  return unique;
};

export type SidebarNavLabelMap = Record<SidebarNavView, string>;

const VIEW_TO_SIDEBAR_VIEW_MAP: Partial<Record<ViewState, SidebarNavView>> = {
  DASHBOARD: 'DASHBOARD',
  CREATE_POST: 'CREATE_POST',
  POST_TEMPLATES: 'POST_TEMPLATES',
  BRAND_KIT: 'BRAND_KIT',
  POST_LIST: 'POST_LIST',
  CALENDAR: 'CALENDAR',
  INBOX: 'INBOX',
  SURVEY: 'SURVEY',
  RANK_TRACKER: 'RANK_TRACKER',
  ADVICE: 'ADVICE',
  USER_MANAGEMENT: 'USER_MANAGEMENT',
  STORE_MANAGEMENT: 'STORE_MANAGEMENT',
  PLATFORM_MANAGEMENT: 'PLATFORM_MANAGEMENT',
  GROUP_MANAGEMENT: 'GROUP_MANAGEMENT',
  MANAGEMENT_UNIT_MANAGEMENT: 'MANAGEMENT_UNIT_MANAGEMENT',
  BILLING: 'BILLING',
};

const normalizeSidebarNavLabels = (input: unknown): SidebarNavLabelMap => {
  const next: SidebarNavLabelMap = { ...SIDEBAR_NAV_DEFAULT_LABELS };
  if (!input || typeof input !== 'object') return next;
  const typed = input as Record<string, unknown>;
  for (const viewId of SIDEBAR_NAV_DEFAULT_ORDER) {
    const raw = typed[viewId];
    if (typeof raw !== 'string') continue;
    const normalized = raw.trim();
    if (!normalized) continue;
    next[viewId] = normalized.slice(0, 24);
  }
  return next;
};

export const getSidebarNavOrder = (): SidebarNavView[] => {
  if (typeof window === 'undefined') return [...SIDEBAR_NAV_DEFAULT_ORDER];
  try {
    const raw = window.localStorage.getItem(SIDEBAR_NAV_STORAGE_KEY);
    if (!raw) return [...SIDEBAR_NAV_DEFAULT_ORDER];
    return normalizeSidebarNavOrder(JSON.parse(raw));
  } catch {
    return [...SIDEBAR_NAV_DEFAULT_ORDER];
  }
};

export const setSidebarNavOrder = (order: SidebarNavView[]): SidebarNavView[] => {
  const normalized = normalizeSidebarNavOrder(order);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SIDEBAR_NAV_STORAGE_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent(SIDEBAR_NAV_ORDER_UPDATED_EVENT));
  }
  return normalized;
};

export const resetSidebarNavOrder = (): SidebarNavView[] => {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(SIDEBAR_NAV_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(SIDEBAR_NAV_ORDER_UPDATED_EVENT));
  }
  return [...SIDEBAR_NAV_DEFAULT_ORDER];
};

export const getSidebarNavLabels = (): SidebarNavLabelMap => {
  if (typeof window === 'undefined') return { ...SIDEBAR_NAV_DEFAULT_LABELS };
  try {
    const raw = window.localStorage.getItem(SIDEBAR_NAV_LABEL_STORAGE_KEY);
    if (!raw) return { ...SIDEBAR_NAV_DEFAULT_LABELS };
    return normalizeSidebarNavLabels(JSON.parse(raw));
  } catch {
    return { ...SIDEBAR_NAV_DEFAULT_LABELS };
  }
};

export const setSidebarNavLabels = (labels: SidebarNavLabelMap): SidebarNavLabelMap => {
  const normalized = normalizeSidebarNavLabels(labels);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SIDEBAR_NAV_LABEL_STORAGE_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent(SIDEBAR_NAV_ORDER_UPDATED_EVENT));
  }
  return normalized;
};

export const resetSidebarNavLabels = (): SidebarNavLabelMap => {
  const defaults = { ...SIDEBAR_NAV_DEFAULT_LABELS };
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(SIDEBAR_NAV_LABEL_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(SIDEBAR_NAV_ORDER_UPDATED_EVENT));
  }
  return defaults;
};

export const getSidebarNavLabelByViewState = (view: ViewState): string | null => {
  const sidebarView = VIEW_TO_SIDEBAR_VIEW_MAP[view];
  if (!sidebarView) return null;
  const labels = getSidebarNavLabels();
  return labels[sidebarView] || SIDEBAR_NAV_DEFAULT_LABELS[sidebarView] || null;
};

export const applySidebarNavOrder = <T extends { id: ViewState }>(items: T[], order: SidebarNavView[]): T[] => {
  const indexMap = new Map<string, number>();
  order.forEach((id, index) => indexMap.set(id, index));
  return [...items].sort((a, b) => {
    const aIdx = indexMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bIdx = indexMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return aIdx - bIdx;
  });
};
