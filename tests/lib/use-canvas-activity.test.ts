/**
 * Tests for `useCanvasActivity`.
 *
 * No jsdom in this repo, so we don't render a React tree. We mock
 * `convex/react`'s `useQuery` to return controlled values and call the
 * hook directly (it's pure — depends on the mocked hook and a memo, no
 * lifecycle). Then we assert it filters expired rows, maps shape, and
 * degrades gracefully on undefined.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let queryReturn: unknown = undefined;
const useQueryMock = vi.fn();

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

// Stub useMemo to just invoke the factory — no real React runtime here.
vi.mock('react', () => ({
  useMemo: (fn: () => unknown) => fn(),
}));

import { useCanvasActivity } from '@/lib/convex/use-canvas-activity';

function row(overrides: Partial<{ _id: string; department: string; kind: string; summary: string; createdAt: number; expiresAt: number; spaceId: string }>) {
  return {
    _id: overrides._id ?? 'r1',
    spaceId: overrides.spaceId ?? 'space-1',
    department: overrides.department ?? 'engineering',
    kind: overrides.kind ?? 'running',
    summary: overrides.summary ?? 'building',
    createdAt: overrides.createdAt ?? Date.now(),
    expiresAt: overrides.expiresAt ?? Date.now() + 60_000,
  };
}

describe('useCanvasActivity', () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useQueryMock.mockImplementation(() => queryReturn);
    queryReturn = undefined;
  });

  it('returns an empty array when useQuery returns undefined (loading / error)', () => {
    queryReturn = undefined;
    const out = useCanvasActivity('space-1');
    expect(out).toEqual([]);
  });

  it('returns an empty array when useQuery returns a non-array', () => {
    queryReturn = { not: 'an array' };
    const out = useCanvasActivity('space-1');
    expect(out).toEqual([]);
  });

  it('maps Convex rows into CanvasActivity shape (id, dept, kind, summary, timestamps)', () => {
    const r = row({ _id: 'abc', department: 'sales', kind: 'queued', summary: 'leads', createdAt: 100, expiresAt: Date.now() + 60_000 });
    queryReturn = [r];
    const out = useCanvasActivity('space-1');
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      id: 'abc',
      department: 'sales',
      kind: 'queued',
      summary: 'leads',
      createdAt: 100,
      expiresAt: r.expiresAt,
    });
  });

  it('filters out rows whose expiresAt is in the past', () => {
    const now = Date.now();
    queryReturn = [
      row({ _id: 'fresh', expiresAt: now + 30_000 }),
      row({ _id: 'expired', expiresAt: now - 1_000 }),
    ];
    const out = useCanvasActivity('space-1');
    expect(out.map((r) => r.id)).toEqual(['fresh']);
  });

  it('passes the spaceId argument through to useQuery', () => {
    queryReturn = [];
    useCanvasActivity('space-42');
    const args = useQueryMock.mock.calls[0]?.[1];
    expect(args).toEqual({ spaceId: 'space-42' });
  });

  it('tolerates null/undefined entries in the array', () => {
    queryReturn = [null, undefined, row({ _id: 'good' })];
    const out = useCanvasActivity('space-1');
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('good');
  });

  it('preserves order returned by Convex (most recent first contract is the query layer\'s job)', () => {
    const now = Date.now();
    queryReturn = [
      row({ _id: 'a', createdAt: now, expiresAt: now + 10_000 }),
      row({ _id: 'b', createdAt: now - 1_000, expiresAt: now + 10_000 }),
      row({ _id: 'c', createdAt: now - 2_000, expiresAt: now + 10_000 }),
    ];
    const out = useCanvasActivity('space-1');
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});
