/**
 * Structural tests for the ConvexClientProvider.
 *
 * We can't render React in this project (no jsdom, no testing-library by
 * project policy — see approval-celebration.test.ts). Instead we assert
 * the module exports a callable component and that the no-URL path
 * doesn't throw at import time. Real wiring is verified in product.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('ConvexClientProvider', () => {
  const originalUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
  });

  afterEach(() => {
    if (originalUrl !== undefined) {
      process.env.NEXT_PUBLIC_CONVEX_URL = originalUrl;
    } else {
      delete process.env.NEXT_PUBLIC_CONVEX_URL;
    }
  });

  it('exports a function component named ConvexClientProvider', async () => {
    const mod = await import('@/components/convex-client-provider');
    expect(typeof mod.ConvexClientProvider).toBe('function');
    expect(mod.ConvexClientProvider.name).toBe('ConvexClientProvider');
  });

  it('module loads without NEXT_PUBLIC_CONVEX_URL set (no crash at import)', async () => {
    const mod = await import('@/components/convex-client-provider');
    expect(mod.ConvexClientProvider).toBeDefined();
  });
});
