/**
 * Phase 4 catalog flips — the six adapters Wave 1 shipped are now live.
 *
 * Guards against accidental regression: if anyone re-flags these as
 * comingSoon or re-adds them to COMING_SOON_TOOLKITS, this test fails
 * loudly.
 */

import { describe, it, expect } from 'vitest';
import {
  INTEGRATIONS,
  COMING_SOON_TOOLKITS,
  findIntegration,
} from '@/lib/integrations/catalog';

const FLIPPED_SLUGS = [
  'replicate',
  'openai',
  'twitter',
  'linkedin',
  'loops',
  'cloudflare_dns',
] as const;

describe('Phase 4 catalog flips', () => {
  it('none of the six flipped slugs are in COMING_SOON_TOOLKITS', () => {
    for (const slug of FLIPPED_SLUGS) {
      expect(COMING_SOON_TOOLKITS.has(slug), `${slug} should be live`).toBe(false);
    }
  });

  it('every flipped slug resolves via findIntegration', () => {
    for (const slug of FLIPPED_SLUGS) {
      const entry = findIntegration(slug);
      expect(entry, `${slug} missing from catalog`).toBeDefined();
      expect(entry?.toolkit).toBe(slug);
    }
  });

  it('every flipped slug has comingSoon falsy', () => {
    for (const slug of FLIPPED_SLUGS) {
      const entry = findIntegration(slug);
      expect(entry?.comingSoon, `${slug} should not be comingSoon`).toBeFalsy();
    }
  });

  it('INTEGRATIONS retains its 28-entry size — no accidental adds/cuts', () => {
    expect(INTEGRATIONS.length).toBe(28);
  });

  it('COMING_SOON_TOOLKITS matches the comingSoon flag set in INTEGRATIONS', () => {
    const flaggedInCatalog = new Set(
      INTEGRATIONS.filter((e) => e.comingSoon).map((e) => e.toolkit),
    );
    expect([...flaggedInCatalog].sort()).toEqual([...COMING_SOON_TOOLKITS].sort());
  });

  it('twitter is still promoted — it was promoted before the flip', () => {
    expect(findIntegration('twitter')?.promoted).toBe(true);
  });
});
