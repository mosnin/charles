/**
 * Follow-mode click logic for PresencePills.
 *
 * The click handler delegates to followTargetFor, a pure function that
 * decides "navigate here, or no-op". These tests pin that decision so
 * the avatar-click contract (single click = jump, current surface = no-op)
 * can't drift without flagging here. No render tests — project policy.
 */

import { describe, it, expect } from 'vitest';
import { followTargetFor } from '@/components/canvas/presence-pills';

describe('followTargetFor', () => {
  it('returns the user surface when it differs from the current pathname', () => {
    expect(followTargetFor('/s/jane', '/s/jane/stages')).toBe('/s/jane/stages');
  });

  it('returns null when the user is on the same surface as the founder', () => {
    expect(followTargetFor('/s/jane/stages', '/s/jane/stages')).toBeNull();
  });

  it('returns null when the user surface is empty — never navigates to ""', () => {
    expect(followTargetFor('/s/jane', '')).toBeNull();
  });

  it('handles task subroute navigation', () => {
    expect(followTargetFor('/s/jane', '/s/jane/tasks/task_abc')).toBe(
      '/s/jane/tasks/task_abc',
    );
  });

  it('handles cross-workspace surfaces (still just a string compare)', () => {
    // We don't try to be clever about same-workspace gating here — the
    // presence query is already scoped to a single spaceId.
    expect(followTargetFor('/s/jane', '/s/jane/pulse')).toBe('/s/jane/pulse');
  });

  it('is symmetric for trailing-slash differences only insofar as the strings differ', () => {
    // Trailing slash creates a different string → treated as different
    // surface. This is fine in practice because Next.js normalizes
    // pathnames before usePathname returns them.
    expect(followTargetFor('/s/jane', '/s/jane/')).toBe('/s/jane/');
  });
});

describe('PresencePills module — structure', () => {
  it('exports both the component and the pure helper', async () => {
    const mod = await import('@/components/canvas/presence-pills');
    expect(typeof mod.PresencePills).toBe('function');
    expect(typeof mod.followTargetFor).toBe('function');
  });
});
