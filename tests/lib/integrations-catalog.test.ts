/**
 * Pure-function tests for the Charles integration catalog.
 *
 * Guards catalog invariants — duplicates, empty fields, category membership —
 * so a quick edit to add or remove an integration can't silently break the
 * connect button.
 */

import { describe, it, expect } from 'vitest';
import {
  INTEGRATIONS,
  COMING_SOON_TOOLKITS,
  findIntegration,
  allToolkitSlugs,
  promotedIntegrations,
  integrationsByCategory,
  type IntegrationCategory,
} from '@/lib/integrations/catalog';

const VALID_CATEGORIES: ReadonlySet<IntegrationCategory> = new Set<IntegrationCategory>([
  'engineering',
  'domains',
  'payments',
  'email-messaging',
  'marketing-social',
  'ai-generative',
  'docs-files',
]);

// Composio slugs: lowercase letters, digits, optional underscores.
const SLUG_RE = /^[a-z0-9]+(_[a-z0-9]+)*$/;

describe('findIntegration', () => {
  it('returns the entry for a known slug', () => {
    const gh = findIntegration('github');
    expect(gh).toBeDefined();
    expect(gh?.toolkit).toBe('github');
    expect(gh?.name).toBe('GitHub');
  });

  it('returns undefined for unknown slugs', () => {
    expect(findIntegration('not_a_real_toolkit')).toBeUndefined();
    expect(findIntegration('')).toBeUndefined();
    expect(findIntegration('GitHub')).toBeUndefined();
  });
});

describe('allToolkitSlugs', () => {
  it('contains no duplicate slugs', () => {
    const slugs = allToolkitSlugs();
    const unique = new Set(slugs);
    expect(unique.size).toBe(slugs.length);
  });

  it('returns one slug per catalog entry', () => {
    expect(allToolkitSlugs()).toHaveLength(INTEGRATIONS.length);
  });
});

describe('promotedIntegrations', () => {
  it('is non-empty — the panel must show something above the fold', () => {
    expect(promotedIntegrations().length).toBeGreaterThan(0);
  });

  it('only contains entries with promoted=true', () => {
    for (const entry of promotedIntegrations()) {
      expect(entry.promoted).toBe(true);
    }
  });
});

describe('integrationsByCategory', () => {
  it('covers every catalog entry exactly once', () => {
    const grouped = integrationsByCategory();
    const flat = (Object.values(grouped) as Array<typeof INTEGRATIONS>).flat();
    expect(flat).toHaveLength(INTEGRATIONS.length);
    const seen = new Set<string>();
    for (const e of flat) {
      expect(seen.has(e.toolkit)).toBe(false);
      seen.add(e.toolkit);
    }
    for (const e of INTEGRATIONS) {
      expect(seen.has(e.toolkit)).toBe(true);
    }
  });

  it('only buckets entries under valid IntegrationCategory values', () => {
    const grouped = integrationsByCategory();
    for (const cat of Object.keys(grouped)) {
      expect(
        VALID_CATEGORIES.has(cat as IntegrationCategory),
        `unknown category: ${cat}`,
      ).toBe(true);
    }
  });
});

describe('catalog entry shape', () => {
  it('every entry has non-empty name + blurb + valid category + valid slug', () => {
    for (const e of INTEGRATIONS) {
      expect(e.name.trim().length, `name for ${e.toolkit}`).toBeGreaterThan(0);
      expect(e.blurb.trim().length, `blurb for ${e.toolkit}`).toBeGreaterThan(0);
      expect(
        VALID_CATEGORIES.has(e.category),
        `unknown category "${e.category}" for ${e.toolkit}`,
      ).toBe(true);
      expect(SLUG_RE.test(e.toolkit), `slug shape for ${e.toolkit}`).toBe(true);
    }
  });

  it('catalog size snapshot — accidental cuts surface loudly', () => {
    // Bump this intentionally when the catalog grows or shrinks.
    expect(INTEGRATIONS.length).toBe(28);
  });

  it('includes the load-bearing Charles integrations', () => {
    const slugs = new Set(allToolkitSlugs());
    expect(slugs.has('github'), 'github missing').toBe(true);
    expect(slugs.has('stripe'), 'stripe missing').toBe(true);
    expect(slugs.has('resend'), 'resend missing').toBe(true);
    expect(slugs.has('slack'), 'slack missing').toBe(true);
    expect(slugs.has('notion'), 'notion missing').toBe(true);
  });

  it('legacy realtor-only integrations are gone', () => {
    expect(findIntegration('follow_up_boss')).toBeUndefined();
    expect(findIntegration('googlecalendar')).toBeUndefined();
    expect(findIntegration('gmail')).toBeUndefined();
  });
});

describe('COMING_SOON_TOOLKITS', () => {
  it('matches the set of catalog entries flagged comingSoon: true (no drift)', () => {
    const flaggedInCatalog = new Set(
      INTEGRATIONS.filter((e) => e.comingSoon).map((e) => e.toolkit),
    );
    expect([...flaggedInCatalog].sort()).toEqual([...COMING_SOON_TOOLKITS].sort());
  });

  it('every coming-soon slug exists in INTEGRATIONS — no dangling entries', () => {
    const catalogSlugs = new Set(allToolkitSlugs());
    for (const s of COMING_SOON_TOOLKITS) {
      expect(catalogSlugs.has(s), `${s} should be in INTEGRATIONS`).toBe(true);
    }
  });
});
