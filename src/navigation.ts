import {
  Bot,
  ChartLine as LineChart,
  Code2,
  Hash,
  LayoutDashboard,
  ListFilter,
  MessageSquare,
  Target,
  type LucideIcon,
} from 'lucide-react';

export type Page =
  | 'dashboard'
  | 'bots'
  | 'manual'
  | 'builder'
  | 'bulk'
  | 'quick'
  | 'apex'
  | 'phantom'
  | 'stpv3'
  | 'digits'
  | 'record'
  | 'settings'
  | 'digitsurge'
  | 'boomcrash'
  | 'asiandrift'
  | 'ai-builder';

export type NavItem = { key: Page; label: string; icon: LucideIcon; badge?: string };

export type NavSection = { title: string; items: NavItem[] };

/** Primary sidebar navigation — grouped by user intent. */
export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [{ key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    title: 'Trade',
    items: [
      { key: 'manual', label: 'Manual Trader', icon: Target },
      { key: 'bulk', label: 'Bulk Trader', icon: ListFilter },
    ],
  },
  {
    title: 'Automate',
    items: [
      { key: 'bots', label: 'Free Bots', icon: Bot },
      { key: 'builder', label: 'Bot Builder', icon: Code2 },
      { key: 'ai-builder', label: 'AI Bot Builder', icon: MessageSquare },
    ],
  },
  {
    title: 'Analyze',
    items: [
      { key: 'digits', label: 'Digits Analyser', icon: Hash },
      { key: 'record', label: 'Track Record', icon: LineChart },
    ],
  },
];

/** Flat list for lookups (breadcrumb, valid pages, etc.). */
export const ALL_PAGES: Page[] = [
  'dashboard',
  'bots',
  'manual',
  'builder',
  'ai-builder',
  'bulk',
  'quick',
  'apex',
  'phantom',
  'stpv3',
  'digits',
  'record',
  'settings',
  'digitsurge',
  'boomcrash',
  'asiandrift',
];

export const PAGE_LABELS: Record<Page, string> = {
  dashboard: 'Dashboard',
  bots: 'Free Bots',
  manual: 'Manual Trader',
  builder: 'Bot Builder',
  'ai-builder': 'AI Bot Builder',
  bulk: 'Bulk Trader',
  quick: 'Quick Bot',
  apex: 'Apex Bot',
  phantom: 'Phantom Scalper',
  stpv3: 'Trend Pullback V3',
  digits: 'Digits Analyser',
  record: 'Track Record',
  settings: 'Settings',
  digitsurge: 'Digit Surge',
  boomcrash: 'Boom/Crash Rider',
  asiandrift: 'Asian Drift',
};

/** Bot detail / secondary pages highlight Free Bots in the sidebar. */
const BOT_HUB_PAGES: Page[] = [
  'phantom',
  'stpv3',
  'digitsurge',
  'boomcrash',
  'asiandrift',
  'quick',
  'apex',
];

export function getPageLabel(page: Page): string {
  return PAGE_LABELS[page] ?? 'APEX';
}

export function isNavItemActive(currentPage: Page, navKey: Page): boolean {
  if (currentPage === navKey) return true;
  if (navKey === 'bots' && BOT_HUB_PAGES.includes(currentPage)) return true;
  return false;
}
