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

export const DEPARTMENT_PAGE_CONFIGS: Partial<Record<DepartmentSlug, DepartmentPageConfig>> = {
  engineering: ENGINEERING_CONFIG,
  // Marketing / Design / Ops-Finance / Sales / Support land in phase 5.
};

export function getDepartmentPageConfig(
  deptSlug: DepartmentSlug,
): DepartmentPageConfig | null {
  return DEPARTMENT_PAGE_CONFIGS[deptSlug] ?? null;
}

/** Internal helpers, exported for tests. */
export const _internals = { makeClassifier, ENGINEERING_CONFIG };
