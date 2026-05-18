/**
 * Per-department configuration for the unified department page.
 *
 * Each department has: filter pill categories, the integration toolkits it
 * uses (with provider deep-links), and a category classifier that maps an
 * audit-feed summary line to one of the filter pills. The classifier is
 * keyword-based — good enough for v1, future tickets will land a
 * `category` field in `AgentActivityLog.metadata` and we'll drop the
 * heuristic.
 *
 * Adding a new department = add an entry here. The DepartmentPage
 * template reads from this map; nothing else changes.
 */

import type { DepartmentSlug } from '@/lib/departments/autonomy';

export interface FilterCategory {
  /** Filter pill slug. Must match the values returned by `classify`. */
  slug: string;
  label: string;
}

export interface ToolkitConnection {
  /** IntegrationConnection.toolkit value. */
  toolkit: string;
  /** Provider name as the founder reads it on the connections strip. */
  label: string;
  /** Deep-link to view this provider's surface (e.g. github.com). */
  externalUrl: string;
  /** Filter category this provider's actions land under. */
  category: string;
  /**
   * True when the integration hasn't been wired into Charles yet — the
   * tile renders as "Coming soon" and is non-clickable. Used today by
   * Sales + Support to acknowledge the toolkits we'd connect next
   * without pretending the connect flow exists yet.
   */
  comingSoon?: boolean;
}

export interface DepartmentPageConfig {
  /** Pills, in display order. "All" is prepended by the renderer. */
  filters: readonly FilterCategory[];
  /** Connected-app strip metadata. */
  toolkits: readonly ToolkitConnection[];
  /**
   * Classify a feed entry into one of the filter slugs. Receives the
   * summary text + a hint extracted from the source event (often a sub-agent
   * role or tool name fragment). Returns one of the filter slugs, or
   * 'general' if nothing matches — 'general' shows under All only.
   */
  classify: (summary: string, hint?: string) => string;
}

/**
 * Keyword → category mapping. Order matters: the first match wins, so put
 * the most specific patterns first. Lower-cased compare.
 */
function makeClassifier(
  rules: ReadonlyArray<readonly [RegExp, string]>,
): (summary: string, hint?: string) => string {
  return (summary, hint) => {
    const haystack = `${summary} ${hint ?? ''}`.toLowerCase();
    for (const [pattern, slug] of rules) {
      if (pattern.test(haystack)) return slug;
    }
    return 'general';
  };
}

const ENGINEERING_CONFIG: DepartmentPageConfig = {
  filters: [
    { slug: 'repos', label: 'Repos' },
    { slug: 'deploys', label: 'Deploys' },
    { slug: 'env', label: 'Env & DNS' },
    { slug: 'database', label: 'Database' },
  ],
  toolkits: [
    {
      toolkit: 'github',
      label: 'GitHub',
      externalUrl: 'https://github.com',
      category: 'repos',
    },
    {
      toolkit: 'vercel',
      label: 'Vercel',
      externalUrl: 'https://vercel.com/dashboard',
      category: 'deploys',
    },
    {
      toolkit: 'cloudflare',
      label: 'Cloudflare',
      externalUrl: 'https://dash.cloudflare.com',
      category: 'env',
    },
    {
      toolkit: 'supabase_target',
      label: 'Supabase',
      externalUrl: 'https://supabase.com/dashboard',
      category: 'database',
    },
  ],
  classify: makeClassifier([
    [/\bmigration|supabase|migrate|schema|table\b/, 'database'],
    // env BEFORE deploys so "env var on Vercel" routes to env, not deploys —
    // the verb is set-env, the deploy is just where it landed.
    [/\benvironment variable|env var|\bdns\b|\bcloudflare\b|\bsecret\b/, 'env'],
    [/\bdeploy|build|vercel\b/, 'deploys'],
    [/\bpull request|pr #|\brepo\b|github|commit|branch\b/, 'repos'],
  ]),
};

const MARKETING_CONFIG: DepartmentPageConfig = {
  filters: [
    { slug: 'campaigns', label: 'Campaigns' },
    { slug: 'social', label: 'Social' },
    { slug: 'images', label: 'Images' },
    { slug: 'analytics', label: 'Analytics' },
  ],
  toolkits: [
    {
      toolkit: 'loops',
      label: 'Loops',
      externalUrl: 'https://app.loops.so',
      category: 'campaigns',
    },
    {
      toolkit: 'linkedin',
      label: 'LinkedIn',
      externalUrl: 'https://www.linkedin.com',
      category: 'social',
    },
    {
      toolkit: 'twitter',
      label: 'Twitter',
      externalUrl: 'https://twitter.com',
      category: 'social',
    },
    {
      toolkit: 'replicate',
      label: 'Replicate',
      externalUrl: 'https://replicate.com',
      category: 'images',
    },
    {
      toolkit: 'posthog',
      label: 'PostHog',
      externalUrl: 'https://app.posthog.com',
      category: 'analytics',
    },
  ],
  classify: makeClassifier([
    // analytics BEFORE social so a "PostHog event for a LinkedIn post" reads
    // as analytics rather than social — measurement first.
    [/\bposthog|analytics|signup|conversion|funnel|metric\b/, 'analytics'],
    [/\bimage|replicate|dall-e|openai image|generated (an? )?(image|asset|video)\b/, 'images'],
    [/\blinkedin|twitter|x\.com|tweet|posted to|social\b/, 'social'],
    [/\bcampaign|loops|broadcast|sequence|email blast|newsletter\b/, 'campaigns'],
  ]),
};

const DESIGN_CONFIG: DepartmentPageConfig = {
  filters: [
    { slug: 'brand', label: 'Brand' },
    { slug: 'assets', label: 'Assets' },
    { slug: 'docs', label: 'Style docs' },
  ],
  toolkits: [
    {
      toolkit: 'replicate',
      label: 'Replicate',
      externalUrl: 'https://replicate.com',
      category: 'assets',
    },
    {
      toolkit: 'openai',
      label: 'OpenAI images',
      externalUrl: 'https://platform.openai.com',
      category: 'assets',
    },
    {
      toolkit: 'figma',
      label: 'Figma',
      externalUrl: 'https://www.figma.com',
      category: 'brand',
    },
  ],
  classify: makeClassifier([
    // brand BEFORE assets so "generated a logo" routes to brand (logo is brand
    // material), even though "generated" smells like assets.
    [/\blogo|wordmark|brand kit|palette|colou?r|typeface|font\b/, 'brand'],
    [/\bstyle (guide|doc)|design docs?|component library|spec\b/, 'docs'],
    [/\bimage|asset|replicate|dall-e|openai image|generated|video\b/, 'assets'],
  ]),
};

const OPS_FINANCE_CONFIG: DepartmentPageConfig = {
  filters: [
    { slug: 'revenue', label: 'Revenue' },
    { slug: 'expenses', label: 'Expenses' },
    { slug: 'runway', label: 'Runway' },
  ],
  toolkits: [
    {
      toolkit: 'stripe',
      label: 'Stripe',
      externalUrl: 'https://dashboard.stripe.com',
      category: 'revenue',
    },
  ],
  classify: makeClassifier([
    [/\brunway|burn rate|cash (left|on hand|balance)|forecast\b/, 'runway'],
    [/\bexpense|spend|paid (out|for|to)|cost\b/, 'expenses'],
    [/\brevenue|stripe|charge|invoice|subscription|mrr|arr|payment\b/, 'revenue'],
  ]),
};

// Sales has zero Python tools today. The toolkits below are tagged
// `comingSoon` — they render as preview tiles on the connections strip
// so the orbit's promise of a Sales department isn't an empty room.
// When tool packs land, drop the flag and the same tile becomes a real
// connect target.
const SALES_CONFIG: DepartmentPageConfig = {
  filters: [
    { slug: 'enrich', label: 'Enrich' },
    { slug: 'research', label: 'Research' },
    { slug: 'outreach', label: 'Outreach' },
    { slug: 'campaigns', label: 'Campaigns' },
  ],
  toolkits: [
    {
      toolkit: 'apollo',
      label: 'Apollo',
      externalUrl: 'https://app.apollo.io',
      category: 'enrich',
      comingSoon: true,
    },
    {
      toolkit: 'clearbit',
      label: 'Clearbit',
      externalUrl: 'https://clearbit.com',
      category: 'research',
      comingSoon: true,
    },
    {
      toolkit: 'hubspot',
      label: 'HubSpot',
      externalUrl: 'https://app.hubspot.com',
      category: 'outreach',
      comingSoon: true,
    },
  ],
  classify: makeClassifier([
    [/\benrich|apollo|clearbit|prospect data\b/, 'enrich'],
    [/\bresearch|company profile|background\b/, 'research'],
    [/\bcampaign|sequence|cadence\b/, 'campaigns'],
    [/\boutreach|cold (email|reach)|follow.?up|sent (an )?email\b/, 'outreach'],
  ]),
};

// Support: same shape as Sales. Intercom is the most modern customer-comms
// provider founders reach for; tagging it comingSoon acknowledges the
// surface without faking the connect flow.
const SUPPORT_CONFIG: DepartmentPageConfig = {
  filters: [
    { slug: 'inbox', label: 'Inbox' },
    { slug: 'templates', label: 'Templates' },
  ],
  toolkits: [
    {
      toolkit: 'intercom',
      label: 'Intercom',
      externalUrl: 'https://app.intercom.com',
      category: 'inbox',
      comingSoon: true,
    },
  ],
  classify: makeClassifier([
    [/\btemplate|macro|canned (reply|response)\b/, 'templates'],
    [/\bticket|inbox|customer (email|reply)|responded|reply\b/, 'inbox'],
  ]),
};

export const DEPARTMENT_PAGE_CONFIGS: Partial<Record<DepartmentSlug, DepartmentPageConfig>> = {
  engineering: ENGINEERING_CONFIG,
  marketing: MARKETING_CONFIG,
  design: DESIGN_CONFIG,
  ops_finance: OPS_FINANCE_CONFIG,
  sales: SALES_CONFIG,
  support: SUPPORT_CONFIG,
};

export function getDepartmentPageConfig(
  deptSlug: DepartmentSlug,
): DepartmentPageConfig | null {
  return DEPARTMENT_PAGE_CONFIGS[deptSlug] ?? null;
}

/** Internal helpers, exported for tests. */
export const _internals = {
  makeClassifier,
  ENGINEERING_CONFIG,
  MARKETING_CONFIG,
  DESIGN_CONFIG,
  OPS_FINANCE_CONFIG,
  SALES_CONFIG,
  SUPPORT_CONFIG,
};
