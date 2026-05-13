/**
 * hashUserIdToColor — stable id-to-color hash.
 *
 * Asserts determinism, the 6-color palette, and a rough spread across
 * many inputs (no single color dominates).
 */

import { describe, it, expect } from 'vitest';
import {
  hashUserIdToColor,
  cursorColorHex,
  CURSOR_COLORS,
} from '@/lib/convex/cursor-color';

describe('hashUserIdToColor', () => {
  it('returns one of the six calm hues', () => {
    expect(CURSOR_COLORS).toHaveLength(6);
    for (const id of ['a', 'b', 'user_xyz', '12345', '']) {
      const c = hashUserIdToColor(id);
      expect(CURSOR_COLORS).toContain(c);
    }
  });

  it('is deterministic for the same userId', () => {
    const id = 'user_clerk_abc123';
    expect(hashUserIdToColor(id)).toBe(hashUserIdToColor(id));
  });

  it('produces different colors for sufficiently different ids', () => {
    const colors = new Set([
      hashUserIdToColor('alice'),
      hashUserIdToColor('bob'),
      hashUserIdToColor('charlie'),
      hashUserIdToColor('dave'),
      hashUserIdToColor('eve'),
      hashUserIdToColor('frank'),
      hashUserIdToColor('grace'),
      hashUserIdToColor('heidi'),
    ]);
    // 8 ids across 6 buckets — should hit at least 3 distinct colors.
    expect(colors.size).toBeGreaterThanOrEqual(3);
  });

  it('cursorColorHex returns a hex string for every palette entry', () => {
    for (const name of CURSOR_COLORS) {
      const hex = cursorColorHex(name);
      expect(hex).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('exposes the expected palette names', () => {
    expect(CURSOR_COLORS).toEqual([
      'slate-500',
      'blue-500',
      'emerald-500',
      'amber-500',
      'rose-500',
      'violet-500',
    ]);
  });
});
