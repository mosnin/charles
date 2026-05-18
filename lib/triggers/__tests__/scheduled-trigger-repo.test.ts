/**
 * Tests for lib/triggers/scheduled-trigger-repo.ts.
 *
 * Reuses the chainable-supabase mock shape from
 * lib/agent/__tests__/task-state-machine.test.ts. Each test pushes a
 * single terminal result and asserts the repo's behaviour around it
 * (validation, ordering, status filtering).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type TerminalResult = { data?: unknown; error?: unknown };
let supabaseQueue: TerminalResult[] = [];

function makeChain(): Record<string, unknown> {
  const terminal: TerminalResult = supabaseQueue.shift() ?? { data: null, error: null };
  const chain: Record<string, unknown> = {};
  const passthroughs = ['select', 'eq', 'update', 'insert', 'limit', 'order', 'lte'];
  for (const method of passthroughs) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(terminal));
  chain.maybeSingle = vi.fn(() => Promise.resolve(terminal));
  chain.then = (
    resolve: (v: TerminalResult) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(terminal).then(resolve, reject);
  return chain;
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(() => makeChain()) },
}));

import {
  createScheduledTrigger,
  listReadyTriggers,
  listUpcomingTriggersForSpace,
  markTriggerFired,
  cancelScheduledTrigger,
} from '@/lib/triggers/scheduled-trigger-repo';

function queue(...results: TerminalResult[]) {
  supabaseQueue.push(...results);
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseQueue = [];
});

describe('createScheduledTrigger()', () => {
  it('refuses runAt in the past', async () => {
    const result = await createScheduledTrigger({
      spaceId: 'sp_1',
      runAt: new Date(Date.now() - 60_000),
      reason: 'old',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/future/i);
  });

  it('refuses unparseable runAt', async () => {
    const result = await createScheduledTrigger({
      spaceId: 'sp_1',
      runAt: 'not-a-date',
      reason: 'r',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/valid timestamp/i);
  });

  it('refuses empty reason', async () => {
    const result = await createScheduledTrigger({
      spaceId: 'sp_1',
      runAt: new Date(Date.now() + 60_000),
      reason: '   ',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/reason/i);
  });

  it('inserts a row when validation passes', async () => {
    const futureRow = {
      id: 't_abc',
      spaceId: 'sp_1',
      runAt: new Date(Date.now() + 3600_000).toISOString(),
      reason: 'check on PR',
      payload: {},
      createdByTaskId: null,
      source: 'agent',
      status: 'pending',
      firedAt: null,
      cancelledAt: null,
      createdAt: new Date().toISOString(),
    };
    queue({ data: futureRow, error: null });
    const result = await createScheduledTrigger({
      spaceId: 'sp_1',
      runAt: futureRow.runAt,
      reason: 'check on PR',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.trigger.id).toBe('t_abc');
  });

  it('returns error when insert fails', async () => {
    queue({ data: null, error: { message: 'constraint violation' } });
    const result = await createScheduledTrigger({
      spaceId: 'sp_1',
      runAt: new Date(Date.now() + 60_000),
      reason: 'r',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/constraint violation/);
  });
});

describe('listReadyTriggers()', () => {
  it('returns rows the cron should fire now', async () => {
    const rows = [
      { id: 't_1', runAt: '2026-05-17T13:00:00Z', status: 'pending', reason: 'a' },
      { id: 't_2', runAt: '2026-05-17T13:30:00Z', status: 'pending', reason: 'b' },
    ];
    queue({ data: rows, error: null });
    const out = await listReadyTriggers(new Date('2026-05-17T14:00:00Z'), 10);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe('t_1');
  });

  it('returns [] when no rows are due', async () => {
    queue({ data: [], error: null });
    const out = await listReadyTriggers(new Date(), 10);
    expect(out).toEqual([]);
  });

  it('throws on db error so the cron retries on next tick', async () => {
    queue({ data: null, error: { message: 'connection refused' } });
    await expect(listReadyTriggers(new Date(), 10)).rejects.toThrow(/connection refused/);
  });
});

describe('listUpcomingTriggersForSpace()', () => {
  it('returns pending rows for the space', async () => {
    const rows = [
      { id: 't_1', spaceId: 'sp_1', runAt: '2026-05-18T14:00:00Z', status: 'pending', reason: 'check pr' },
    ];
    queue({ data: rows, error: null });
    const out = await listUpcomingTriggersForSpace('sp_1', 5);
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe('check pr');
  });
});

describe('markTriggerFired() / cancelScheduledTrigger()', () => {
  it('markTriggerFired writes status=fired', async () => {
    queue({ data: null, error: null });
    await expect(markTriggerFired('t_1')).resolves.toBeUndefined();
  });

  it('cancelScheduledTrigger returns ok on success', async () => {
    queue({ data: null, error: null });
    const out = await cancelScheduledTrigger('t_1');
    expect(out.ok).toBe(true);
  });

  it('cancelScheduledTrigger returns error on failure', async () => {
    queue({ data: null, error: { message: 'gone' } });
    const out = await cancelScheduledTrigger('t_1');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/gone/);
  });
});
