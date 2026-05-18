/**
 * Tests for `loadDeptCounts` — per-department running/queued/idle counts.
 *
 * Mock the supabase client the same way `observability-audit-feed.test.ts`
 * does: a per-table override map, a chain that resolves on `await`. The
 * .in() chain matcher is added because `loadDeptCounts` calls it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

interface TableMock {
  rows?: unknown[];
  throws?: Error;
}

const mockByTable: Record<string, TableMock> = {};

vi.mock('@/lib/supabase', () => {
  return {
    supabase: {
      from: vi.fn((table: string) => {
        const override = mockByTable[table] ?? {};
        const chain: Record<string, unknown> = {};
        const passthrough = () => chain;
        chain.select = vi.fn(passthrough);
        chain.eq = vi.fn(passthrough);
        chain.in = vi.fn(passthrough);
        chain.is = vi.fn(passthrough);
        chain.lt = vi.fn(passthrough);
        chain.gt = vi.fn(passthrough);
        chain.order = vi.fn(passthrough);
        chain.limit = vi.fn(() => {
          if (override.throws) return Promise.reject(override.throws);
          return Promise.resolve({ data: override.rows ?? [], error: null });
        });
        chain.then = (resolve: (v: unknown) => unknown) => {
          if (override.throws) return resolve({ data: null, error: override.throws });
          return resolve({ data: override.rows ?? [], error: null });
        };
        return chain;
      }),
    },
  };
});

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { loadDeptCounts } from '@/lib/canvas/dept-counts';
import { ALL_DEPARTMENTS } from '@/lib/departments/autonomy';

beforeEach(() => {
  for (const key of Object.keys(mockByTable)) delete mockByTable[key];
});

describe('loadDeptCounts — empty / defaults', () => {
  it('returns all 6 depts with zeros when DB is empty', async () => {
    const counts = await loadDeptCounts('space_1');
    expect(Object.keys(counts).sort()).toEqual([...ALL_DEPARTMENTS].sort());
    for (const slug of ALL_DEPARTMENTS) {
      expect(counts[slug]).toEqual({ running: 0, queued: 0, idle: 1 });
    }
  });

  it('idle defaults to 1 when nothing is running or queued', async () => {
    mockByTable.SwarmMember = { rows: [] };
    const counts = await loadDeptCounts('space_1');
    for (const slug of ALL_DEPARTMENTS) {
      expect(counts[slug].idle).toBe(1);
    }
  });

  it('returns all-idle defaults when the query throws', async () => {
    mockByTable.SwarmMember = { throws: new Error('boom') };
    const counts = await loadDeptCounts('space_1');
    for (const slug of ALL_DEPARTMENTS) {
      expect(counts[slug]).toEqual({ running: 0, queued: 0, idle: 1 });
    }
  });
});

describe('loadDeptCounts — grouping', () => {
  it('counts running rows per department', async () => {
    mockByTable.SwarmMember = {
      rows: [
        { role: 'engineering', status: 'running' },
        { role: 'engineering', status: 'running' },
        { role: 'design', status: 'running' },
      ],
    };
    const counts = await loadDeptCounts('space_1');
    expect(counts.engineering.running).toBe(2);
    expect(counts.design.running).toBe(1);
    expect(counts.marketing.running).toBe(0);
  });

  it('counts queued rows per department', async () => {
    mockByTable.SwarmMember = {
      rows: [
        { role: 'sales', status: 'queued' },
        { role: 'sales', status: 'queued' },
        { role: 'support', status: 'queued' },
      ],
    };
    const counts = await loadDeptCounts('space_1');
    expect(counts.sales.queued).toBe(2);
    expect(counts.support.queued).toBe(1);
    expect(counts.engineering.queued).toBe(0);
  });

  it('sets idle=0 when running > 0', async () => {
    mockByTable.SwarmMember = { rows: [{ role: 'engineering', status: 'running' }] };
    const counts = await loadDeptCounts('space_1');
    expect(counts.engineering.idle).toBe(0);
    // Other depts stay idle.
    expect(counts.design.idle).toBe(1);
  });

  it('sets idle=0 when queued > 0', async () => {
    mockByTable.SwarmMember = { rows: [{ role: 'marketing', status: 'queued' }] };
    const counts = await loadDeptCounts('space_1');
    expect(counts.marketing.idle).toBe(0);
    expect(counts.marketing.queued).toBe(1);
  });

  it('sets idle=0 when both running and queued are present', async () => {
    mockByTable.SwarmMember = {
      rows: [
        { role: 'engineering', status: 'running' },
        { role: 'engineering', status: 'queued' },
      ],
    };
    const counts = await loadDeptCounts('space_1');
    expect(counts.engineering).toEqual({ running: 1, queued: 1, idle: 0 });
  });

  it('ignores completed and failed rows (history, not current state)', async () => {
    mockByTable.SwarmMember = {
      rows: [
        { role: 'engineering', status: 'completed' },
        { role: 'engineering', status: 'failed' },
      ],
    };
    const counts = await loadDeptCounts('space_1');
    expect(counts.engineering).toEqual({ running: 0, queued: 0, idle: 1 });
  });
});

describe('loadDeptCounts — defensive', () => {
  it('skips rows with unknown role slugs', async () => {
    mockByTable.SwarmMember = {
      rows: [
        { role: 'unknown_dept', status: 'running' },
        { role: 'engineering', status: 'running' },
      ],
    };
    const counts = await loadDeptCounts('space_1');
    expect(counts.engineering.running).toBe(1);
    // No engineering inflation from the unknown row.
  });

  it('skips rows with null role', async () => {
    mockByTable.SwarmMember = {
      rows: [
        { role: null, status: 'running' },
        { role: 'sales', status: 'running' },
      ],
    };
    const counts = await loadDeptCounts('space_1');
    expect(counts.sales.running).toBe(1);
    // No KeyError on null role.
  });

  it('skips rows with unrecognised status', async () => {
    mockByTable.SwarmMember = {
      rows: [
        { role: 'engineering', status: 'paused' },
        { role: 'engineering', status: null },
      ],
    };
    const counts = await loadDeptCounts('space_1');
    expect(counts.engineering).toEqual({ running: 0, queued: 0, idle: 1 });
  });

  it('handles a null/undefined row entry gracefully', async () => {
    mockByTable.SwarmMember = {
      rows: [null, undefined, { role: 'engineering', status: 'running' }],
    };
    const counts = await loadDeptCounts('space_1');
    expect(counts.engineering.running).toBe(1);
  });

  it('returns a record with exactly six keys', async () => {
    const counts = await loadDeptCounts('space_1');
    expect(Object.keys(counts)).toHaveLength(6);
  });
});
