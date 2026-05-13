/**
 * Guard: posthog has been flipped live in the catalog.
 *
 * If a future edit re-adds comingSoon, these tests fail loudly so the connect
 * route doesn't silently 501 a working integration.
 */

import { describe, it, expect } from 'vitest';
import {
  COMING_SOON_TOOLKITS,
  findIntegration,
} from '@/lib/integrations/catalog';

describe('PostHog catalog flip', () => {
  it('posthog is no longer in COMING_SOON_TOOLKITS', () => {
    expect(COMING_SOON_TOOLKITS.has('posthog')).toBe(false);
  });

  it('posthog is findable via findIntegration', () => {
    const ph = findIntegration('posthog');
    expect(ph).toBeDefined();
    expect(ph?.toolkit).toBe('posthog');
    expect(ph?.name).toBe('PostHog');
  });

  it('posthog entry is not flagged comingSoon', () => {
    const ph = findIntegration('posthog');
    expect(ph?.comingSoon).not.toBe(true);
  });

  it('posthog still lives in the marketing-social category', () => {
    const ph = findIntegration('posthog');
    expect(ph?.category).toBe('marketing-social');
  });
});
