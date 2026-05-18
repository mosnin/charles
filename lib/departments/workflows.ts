/**
 * Department workflows — the sub-tab definitions for each department detail
 * page. One file, one source of truth. The route at /s/[slug]/d/[dept]
 * reads from here, the tab nav reads from here, the dispatcher reads from
 * here. Add a tab here, it shows up everywhere.
 */

import type { DepartmentSlug } from '@/lib/departments/autonomy';

export interface DepartmentWorkflowTab {
  /** URL segment, e.g. 'enrich'. Lowercase, no spaces. */
  slug: string;
  /** Display label as the founder reads it on the tab pill. */
  label: string;
  /** Optional one-line description for empty states / page headers. */
  description?: string;
}

export interface DepartmentConfig {
  slug: DepartmentSlug;
  /** Human-readable name — matches DEPARTMENT_NAMES in autonomy.ts. */
  name: string;
  /** One-sentence blurb shown under the page title. */
  blurb: string;
  tabs: readonly DepartmentWorkflowTab[];
  /** Slug of the tab to show when none is requested. Must be in tabs. */
  defaultTab: string;
}

export const DEPARTMENT_CONFIGS: Record<DepartmentSlug, DepartmentConfig> = {
  sales: {
    slug: 'sales',
    name: 'Sales',
    blurb: 'Outbound, follow-up, pipeline.',
    tabs: [
      { slug: 'enrich', label: 'Enrich contacts' },
      { slug: 'research', label: 'Research contacts' },
      { slug: 'outreach', label: 'Send Outreach Emails' },
      { slug: 'campaigns', label: 'Campaigns' },
    ],
    defaultTab: 'enrich',
  },
  marketing: {
    slug: 'marketing',
    name: 'Marketing',
    blurb: 'Copy, image, social, landing.',
    tabs: [
      { slug: 'campaigns', label: 'Campaigns' },
      { slug: 'social', label: 'Social posts' },
      { slug: 'images', label: 'Image gen' },
      { slug: 'analytics', label: 'Analytics' },
    ],
    defaultTab: 'campaigns',
  },
  engineering: {
    slug: 'engineering',
    name: 'Engineering',
    blurb: 'Code, repos, deploys, infra.',
    tabs: [
      { slug: 'repos', label: 'Repos' },
      { slug: 'deploys', label: 'Deploys' },
      { slug: 'env', label: 'Env & DNS' },
      { slug: 'database', label: 'Database' },
    ],
    defaultTab: 'repos',
  },
  design: {
    slug: 'design',
    name: 'Design',
    blurb: 'Logo, brand, UI.',
    tabs: [
      { slug: 'brand', label: 'Brand kit' },
      { slug: 'assets', label: 'Generated assets' },
      { slug: 'docs', label: 'Style docs' },
    ],
    defaultTab: 'brand',
  },
  support: {
    slug: 'support',
    name: 'Support',
    blurb: 'Inbox, helpdesk, customer comms.',
    tabs: [
      { slug: 'inbox', label: 'Inbox' },
      { slug: 'templates', label: 'Templates' },
    ],
    defaultTab: 'inbox',
  },
  ops_finance: {
    slug: 'ops_finance',
    name: 'Ops/Finance',
    blurb: 'Stripe, expenses, runway.',
    tabs: [
      { slug: 'revenue', label: 'Revenue' },
      { slug: 'expenses', label: 'Expenses' },
      { slug: 'runway', label: 'Runway' },
    ],
    defaultTab: 'revenue',
  },
};

/**
 * Look up a department config by slug. Returns null for unknown slugs so
 * the page can 404 cleanly.
 */
export function getDepartmentConfig(slug: string): DepartmentConfig | null {
  if (!Object.prototype.hasOwnProperty.call(DEPARTMENT_CONFIGS, slug)) {
    return null;
  }
  return DEPARTMENT_CONFIGS[slug as DepartmentSlug];
}

/**
 * Resolve a (department, tab) pair to the tab definition. Returns null
 * when either side is unknown — the page treats that as "fall back to the
 * default tab" rather than 404.
 */
export function getDepartmentTab(
  slug: string,
  tabSlug: string,
): DepartmentWorkflowTab | null {
  const cfg = getDepartmentConfig(slug);
  if (!cfg) return null;
  return cfg.tabs.find((t) => t.slug === tabSlug) ?? null;
}
