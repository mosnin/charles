/**
 * friendlySurface — pathname-to-label mapping.
 *
 * Covers known top-level routes, document subroutes, slug-strip behavior,
 * and unknown-segment fallback to title-case.
 */

import { describe, it, expect } from 'vitest';
import { friendlySurface } from '@/lib/convex/surface-labels';

const SLUG = 'jane';

describe('friendlySurface', () => {
  it('maps /s/{slug} to Canvas', () => {
    expect(friendlySurface(`/s/${SLUG}`, SLUG)).toBe('Canvas');
    expect(friendlySurface(`/s/${SLUG}/`, SLUG)).toBe('Canvas');
  });

  it('maps /s/{slug}/stages to Stages', () => {
    expect(friendlySurface(`/s/${SLUG}/stages`, SLUG)).toBe('Stages');
  });

  it('maps /s/{slug}/documents to Documents', () => {
    expect(friendlySurface(`/s/${SLUG}/documents`, SLUG)).toBe('Documents');
  });

  it('uses the doc slug as a title for document subroutes', () => {
    expect(friendlySurface(`/s/${SLUG}/documents/brand-kit`, SLUG)).toBe('Brand kit');
    expect(friendlySurface(`/s/${SLUG}/documents/product-prd`, SLUG)).toBe('Product prd');
  });

  it('falls back to title-case for unknown surfaces', () => {
    expect(friendlySurface(`/s/${SLUG}/playground`, SLUG)).toBe('Playground');
  });

  it('handles trailing slashes and query strings', () => {
    expect(friendlySurface(`/s/${SLUG}/stages/?focus=1`, SLUG)).toBe('Stages');
    expect(friendlySurface(`/s/${SLUG}/documents/brand-kit#section`, SLUG)).toBe(
      'Brand kit',
    );
  });

  it('returns Canvas for empty pathname', () => {
    expect(friendlySurface('', SLUG)).toBe('Canvas');
  });
});
