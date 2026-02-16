import { ViewState } from '../../types';
import { NAV_LABELS } from '../ui/copy';
import definitions from './tourSteps.json';

export type TourPlacement = 'top' | 'bottom' | 'left' | 'right' | 'center';

export interface TourStep {
  id: string;
  title: string;
  content: string;
  targetId?: string;
  position?: TourPlacement;
}

type PageStepTemplate = {
  title: string;
  content: string;
  targetId?: string;
  position?: TourPlacement;
};

type TourDefinitions = {
  pageSummaryByView: Partial<Record<ViewState, string>>;
  sidebarSteps: TourStep[];
  pageStepsByView: Partial<Record<ViewState, PageStepTemplate[]>>;
};

const TOUR_DEFINITIONS = definitions as TourDefinitions;
const FALLBACK_SUMMARY = 'この画面の主な機能を確認できます。';

const VIEW_STATES: ViewState[] = [
  'DASHBOARD',
  'BILLING',
  'CALENDAR',
  'SURVEY',
  'CREATE_POST',
  'POST_TEMPLATES',
  'BRAND_KIT',
  'POST_LIST',
  'INBOX',
  'RANK_TRACKER',
  'ADVICE',
  'USER_MANAGEMENT',
  'STORE_MANAGEMENT',
  'GROUP_MANAGEMENT',
  'MANAGEMENT_UNIT_MANAGEMENT',
  'SETTINGS',
];

const PAGE_SUMMARY_BY_VIEW: Record<ViewState, string> = VIEW_STATES.reduce((acc, view) => {
  const value = TOUR_DEFINITIONS.pageSummaryByView[view];
  acc[view] = typeof value === 'string' && value.trim().length > 0 ? value : FALLBACK_SUMMARY;
  return acc;
}, {} as Record<ViewState, string>);

const PAGE_STEPS_BY_VIEW: Record<ViewState, PageStepTemplate[]> = VIEW_STATES.reduce((acc, view) => {
  const steps = TOUR_DEFINITIONS.pageStepsByView[view];
  acc[view] = Array.isArray(steps) ? steps : [];
  return acc;
}, {} as Record<ViewState, PageStepTemplate[]>);

const SIDEBAR_STEPS: TourStep[] = Array.isArray(TOUR_DEFINITIONS.sidebarSteps) ? TOUR_DEFINITIONS.sidebarSteps : [];

export const getTourStepsForView = (view: ViewState): TourStep[] => {
  const pageTemplates = PAGE_STEPS_BY_VIEW[view];
  const pageSteps = (pageTemplates?.length ? pageTemplates : [
    {
      title: `${NAV_LABELS[view]}の使い方`,
      content: PAGE_SUMMARY_BY_VIEW[view],
    },
  ]).map((step, index) => ({
    id: `page-${view.toLowerCase()}-${index + 1}`,
    title: step.title,
    content: step.content,
    targetId: step.targetId || 'page-main-content',
    position: step.position || 'center',
  }));

  return [...pageSteps, ...SIDEBAR_STEPS];
};
