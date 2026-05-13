import {
  Users,
  Briefcase,
  Sparkles,
  Settings,
  Calendar,
  FileText,
  ClipboardList,
  BarChart2,
  LineChart,
  Wallet,
  Plug,
  Building2,
  Bot,
  BookOpen,
  Mail,
  Palette,
  CheckSquare,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

export interface NavChild {
  href: string;
  label: string;
  exact?: boolean;
}

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  /** Sub-items that expand inline */
  children?: NavChild[];
  /** Show as AI assistant item with chip avatar */
  isAI?: boolean;
  /** Badge key for dynamic counts (e.g. 'leads', 'followUps') */
  badgeKey?: string;
}

// ── Realtor sidebar nav ──────────────────────────────────────────────────────
//
// Five items. Chippi is the home — "Today" isn't a separate destination, it's
// the morning view of the agent surface. Tours/Calendar/Notes/Reviews/
// Analytics/Intake are reachable by URL but don't earn a nav slot; they'll be
// absorbed into the agent surface in Phase 5 as inline tools the agent calls.
//
// Properties is now a primary nav item (standalone catalogue view).
// Settings stays as the only true configuration destination. Sub-pages live
// behind an in-page tab strip in app/s/[slug]/settings/layout.tsx.

export const realtorNavItems: NavItem[] = [
  {
    href: '/chippi',
    label: 'Chippi',
    icon: Sparkles,
    isAI: true,
    badgeKey: 'pendingDrafts',
  },
  {
    href: '/contacts',
    label: 'People',
    icon: Users,
    badgeKey: 'leads',
  },
  {
    href: '/deals',
    label: 'Deals',
    icon: Briefcase,
  },
  {
    href: '/properties',
    label: 'Properties',
    icon: Building2,
    badgeKey: 'properties',
    children: [
      { href: '/deals/new', label: 'Add property' },
      { href: '/properties/commissions', label: 'Commissions' },
    ],
  },
  // Documents — the founder's desk. Nine documents, four groups. Lives above
  // Settings because it's a daily destination once the company has shape;
  // Settings is configuration that's visited rarely.
  {
    href: '/documents',
    label: 'Documents',
    icon: BookOpen,
  },
  {
    href: '/tasks',
    label: 'Tasks',
    icon: CheckSquare,
  },
  {
    href: '/brand',
    label: 'Brand',
    icon: Palette,
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: Settings,
  },
];

/**
 * Secondary realtor nav — visually subordinate "More" section. Calendar
 * absorbs Tours (a tour is just a calendar event with a property + contact
 * attached). Intake collapses to a single destination: the overview is the
 * home of the form (link + recent submissions) and the only other surface
 * that earns its place is /customize, reachable inline from the overview.
 * Sub-pages for Share / Tracking / Submissions were configuration disguised
 * as features and have been cut.
 *
 * The standalone Properties list is gone. Realtors who use Chippi properties
 * use them via deals — properties enter the system through /deals/new and are
 * read from deal-detail. The only standalone properties surface that earns
 * its place is the YTD commissions roll-up (a revenue view, not a property
 * catalogue), which lives on its own here.
 */
export const realtorMoreNavItems: NavItem[] = [
  { href: '/calendar', label: 'Calendar', icon: Calendar },
  { href: '/agents', label: 'Agents', icon: Bot },
  { href: '/integrations', label: 'Integrations', icon: Plug },
  { href: '/intake', label: 'Intake form', icon: ClipboardList },
  { href: '/analytics', label: 'Analytics', icon: LineChart },
  { href: '/campaigns', label: 'Campaigns', icon: Mail },
];

// ── Header right-side menu ───────────────────────────────────────────────────

export const secondaryNavItems = [
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

/** Primary items with shorter labels for the mobile bottom bar. */
export const mobileNavItems = [
  { href: '/chippi', label: 'Chippi', icon: Sparkles },
  { href: '/contacts', label: 'People', icon: Users },
  { href: '/deals', label: 'Deals', icon: Briefcase },
  { href: '/properties', label: 'Properties', icon: Building2 },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;
