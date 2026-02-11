import { ViewState } from '../types';

export const SIDEBAR_NAV_ORDER_UPDATED_EVENT = 'sidebar-nav-order-updated';
const SIDEBAR_NAV_STORAGE_KEY = 'teppen.sidebar.nav.order.v1';

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
  'BILLING',
];

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
  for (const fallback of SIDEBAR_NAV_DEFAULT_ORDER) {
    if (!unique.includes(fallback)) unique.push(fallback);
  }
  return unique;
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

export const applySidebarNavOrder = <T extends { id: ViewState }>(items: T[], order: SidebarNavView[]): T[] => {
  const indexMap = new Map<string, number>();
  order.forEach((id, index) => indexMap.set(id, index));
  return [...items].sort((a, b) => {
    const aIdx = indexMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bIdx = indexMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return aIdx - bIdx;
  });
};
