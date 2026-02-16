import { PostStatus, Role, ViewState } from '../../types';
import { NAV_LABELS } from './copy';
import { getSidebarNavLabelByViewState } from '../../services/navigationOrderService';

const ROLE_LABEL_MAP: Record<Role, string> = {
  ADMIN: '管理者',
  SUPERVISOR: '運用責任者',
  MANAGER: '店舗責任者',
  USER: '一般ユーザー',
};

const POST_STATUS_LABEL_MAP: Record<PostStatus, string> = {
  DRAFT: '下書き',
  SCHEDULED: '予約済み',
  PUBLISHED: '公開済み',
  FAILED: '公開失敗',
};

export const formatRoleLabel = (role: Role): string => ROLE_LABEL_MAP[role] || role;

export const formatViewLabel = (view: ViewState): string => {
  const customized = getSidebarNavLabelByViewState(view);
  if (customized) return customized;
  return NAV_LABELS[view] || view;
};

export const formatPostStatusLabel = (status: PostStatus): string => POST_STATUS_LABEL_MAP[status] || status;

export const formatDateYmd = (date: Date | null | undefined): string => {
  if (!date) return '-';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
};
