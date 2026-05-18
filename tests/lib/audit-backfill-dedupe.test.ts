/**
 * Direct unit tests for backfillUnpersistedMessages focused on the
 * deterministic dedupe path: TaskMessage.convexMessageId is a UNIQUE
 * column, so the backfill becomes a plain "lookup by id, insert if
 * absent, flip the flag". These tests mock Convex + Supabase to
 * exercise the dedupe key end-to-end without touching network.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mutationMock = vi.fn(async (_name?: unknown, _args?: unknown) => undefined as unknown);
const queryMock = vi.fn(async (_name?: unknown, _args?: unknown) => [] as unknown);

vi.mock('convex/browser', () => ({
  ConvexHttpClient: vi.fn().mockImplementation(() => ({
    mutation: mutationMock,
    query: queryMock,
  })),
}));

interface Terminal {
  data?: unknown;
  error?: unknown;
}

const { state, calls } = vi.hoisted(() => ({
  state: {
    // Simulates the Supabase TaskMessage table. Keyed by convexMessageId
    // — i.e. only rows that have already been backfilled or dual-written
    // get an entry. Rows without a convexMessageId are not tracked here
    // (they couldn't dedupe a convex row anyway).
    byConvexId: new Map<string, { id: string }>(),
    nextId: 1,
    forceInsertError: null as string | null,
  },
  calls: {
    inserts: [] as Array<Record<string, unknown>>,
    convexIdLookups: [] as string[],
  },
}));

vi.mock('@/lib/supabase', () => {
  function chain() {
    let lastConvexId: string | undefined;
    const obj: Record<string, unknown> = {};
    obj.select = vi.fn(() => obj);
    obj.eq = vi.fn((col: string, val: unknown) => {
      if (col === 'convexMessageId' && typeof val === 'string') {
        lastConvexId = val;
      }
      return obj;
    });
    obj.limit = vi.fn(() => obj);
    obj.then = (resolve: (v: Terminal) => unknown, reject?: (e: unknown) => unknown) => {
      if (lastConvexId !== undefined) {
        calls.convexIdLookups.push(lastConvexId);
        const hit = state.byConvexId.get(lastConvexId);
        return Promise.resolve({ data: hit ? [hit] : [], error: null }).then(
          resolve,
          reject,
        );
      }
      return Promise.resolve({ data: [], error: null }).then(resolve, reject);
    };
    obj.insert = vi.fn((payload: Record<string, unknown>) => {
      calls.inserts.push(payload);
      if (state.forceInsertError) {
        return Promise.resolve({ data: null, error: { message: state.forceInsertError } });
      }
      const convexId = payload.convexMessageId as string | undefined;
      const newId = `tm_${state.nextId++}`;
      if (convexId) state.byConvexId.set(convexId, { id: newId });
      return Promise.resolve({ data: null, error: null });
    });
    return obj;
  }
  return { supabase: { from: vi.fn(() => chain()) } };
});

import { backfillUnpersistedMessages } from '@/lib/convex/audit-backfill';

const ENV_KEYS = ['NEXT_PUBLIC_CONVEX_URL', 'CONVEX_SERVICE_SECRET'] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  state.byConvexId.clear();
  state.nextId = 1;
  state.forceInsertError = null;
  calls.inserts.length = 0;
  calls.convexIdLookups.length = 0;
  mutationMock.mockReset();
  queryMock.mockReset();
  mutationMock.mockImplementation(async () => undefined as unknown);
  queryMock.mockImplementation(async () => [] as unknown);
  process.env.NEXT_PUBLIC_CONVEX_URL = 'https://example.convex.cloud';
  process.env.CONVEX_SERVICE_SECRET = 'shh';
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function liveRow(over: Partial<Record<string, unknown>> & { _id: string }) {
  return {
    conversationId: 'conv_1',
    role: 'user' as const,
    content: 'hello',
    metadata: null,
    createdAt: 1_700_000_000_000,
    ...over,
  };
}

describe('backfillUnpersistedMessages — deterministic dedupe', () => {
  it('returns { persisted, skipped, failed } shape', async () => {
    queryMock.mockResolvedValueOnce([]);
    const result = await backfillUnpersistedMessages();
    expect(result).toEqual({ persisted: 0, skipped: 0, failed: 0 });
  });

  it('first run: inserts with convexMessageId set', async () => {
    queryMock.mockResolvedValueOnce([liveRow({ _id: 'live_1' })]);
    const result = await backfillUnpersistedMessages();
    expect(result.persisted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(state.byConvexId.has('live_1')).toBe(true);
    expect(calls.inserts[0]).toMatchObject({ convexMessageId: 'live_1' });
  });

  it('second run on the same id is a no-op insert (skipped + still flagged)', async () => {
    queryMock.mockResolvedValueOnce([liveRow({ _id: 'live_1' })]);
    await backfillUnpersistedMessages();
    calls.inserts.length = 0;
    mutationMock.mockClear();

    // Convex would normally have set persistedToSupabase=true already,
    // but say something went wrong and the row's flag wasn't flipped —
    // we still see it in listUnpersisted. Re-run.
    queryMock.mockResolvedValueOnce([liveRow({ _id: 'live_1' })]);
    const result = await backfillUnpersistedMessages();
    expect(result.persisted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(calls.inserts).toHaveLength(0);
    // Still flips the flag — the work is idempotent.
    expect(mutationMock).toHaveBeenCalledTimes(1);
  });

  it('regression: two identical messages with different _ids each persist', async () => {
    queryMock.mockResolvedValueOnce([
      liveRow({ _id: 'live_a', createdAt: 1_700_000_000_000 }),
      liveRow({ _id: 'live_b', createdAt: 1_700_000_000_500 }),
    ]);
    const result = await backfillUnpersistedMessages();
    expect(result.persisted).toBe(2);
    expect(state.byConvexId.has('live_a')).toBe(true);
    expect(state.byConvexId.has('live_b')).toBe(true);
  });

  it('dedupe key is convexMessageId, not content', async () => {
    // Pre-seed the table with a row carrying live_a but identical content.
    state.byConvexId.set('live_existing', { id: 'tm_seeded' });
    queryMock.mockResolvedValueOnce([
      liveRow({ _id: 'live_new', content: 'same content' }),
    ]);
    const result = await backfillUnpersistedMessages();
    // Content matches the seeded row, but the convexMessageId differs,
    // so we insert. This is the bug we're fixing.
    expect(result.persisted).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('looks up by convexMessageId exactly', async () => {
    queryMock.mockResolvedValueOnce([liveRow({ _id: 'live_lookup' })]);
    await backfillUnpersistedMessages();
    expect(calls.convexIdLookups).toContain('live_lookup');
  });

  it('one flag failure mid-batch does not kill the rest', async () => {
    queryMock.mockResolvedValueOnce([
      liveRow({ _id: 'live_a' }),
      liveRow({ _id: 'live_b' }),
      liveRow({ _id: 'live_c' }),
    ]);
    let n = 0;
    mutationMock.mockImplementation(async () => {
      n += 1;
      if (n === 2) throw new Error('flag failed');
      return undefined as unknown;
    });
    const result = await backfillUnpersistedMessages();
    expect(result.persisted).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('insert error: counts failed, leaves the flag alone', async () => {
    state.forceInsertError = 'db down';
    queryMock.mockResolvedValueOnce([liveRow({ _id: 'live_die' })]);
    const result = await backfillUnpersistedMessages();
    expect(result.failed).toBe(1);
    expect(result.persisted).toBe(0);
    expect(mutationMock).not.toHaveBeenCalled();
  });

  it('Convex query failure returns zeros (graceful degrade)', async () => {
    queryMock.mockRejectedValueOnce(new Error('convex offline'));
    const result = await backfillUnpersistedMessages();
    expect(result).toEqual({ persisted: 0, skipped: 0, failed: 0 });
  });

  it('skipped rows still flag persisted on Convex', async () => {
    state.byConvexId.set('live_already', { id: 'tm_old' });
    queryMock.mockResolvedValueOnce([liveRow({ _id: 'live_already' })]);
    await backfillUnpersistedMessages();
    expect(mutationMock).toHaveBeenCalledTimes(1);
    const args = mutationMock.mock.calls[0][1] as { messageId: string };
    expect(args.messageId).toBe('live_already');
  });

  it('no convex env: returns zeros, no queries', async () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    const result = await backfillUnpersistedMessages();
    expect(result).toEqual({ persisted: 0, skipped: 0, failed: 0 });
    expect(queryMock).not.toHaveBeenCalled();
  });
});
