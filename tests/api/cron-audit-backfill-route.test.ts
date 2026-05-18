/**
 * Tests for GET /api/cron/audit-backfill and the underlying
 * backfillUnpersistedMessages bridge. Mocks Convex HTTP client and
 * Supabase; covers auth, env-not-configured, deterministic
 * dedupe-by-convexMessageId, idempotent re-runs, the
 * two-identical-messages regression, and per-row failure isolation.
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

type Terminal = { data?: unknown; error?: unknown };
const { tableQueue, calls } = vi.hoisted(() => ({
  tableQueue: {
    // Each lookup pops one terminal from this queue. Convex-id lookups
    // and any other select() terminate here.
    TaskMessage: [] as Terminal[],
  },
  calls: {
    inserts: [] as Array<Record<string, unknown>>,
    selectLookups: 0,
    convexIdLookups: [] as string[],
  },
}));

vi.mock('@/lib/supabase', () => {
  function chain() {
    const state: { lastConvexIdFilter?: string } = {};
    const obj: Record<string, unknown> = {};
    obj.select = vi.fn(() => obj);
    obj.eq = vi.fn((col: string, val: unknown) => {
      if (col === 'convexMessageId' && typeof val === 'string') {
        state.lastConvexIdFilter = val;
      }
      return obj;
    });
    obj.in = vi.fn(() => obj);
    obj.gte = vi.fn(() => obj);
    obj.lte = vi.fn(() => obj);
    obj.order = vi.fn(() => obj);
    obj.limit = vi.fn(() => obj);
    obj.maybeSingle = vi.fn(() =>
      Promise.resolve(tableQueue.TaskMessage.shift() ?? { data: null, error: null }),
    );
    obj.then = (resolve: (v: Terminal) => unknown, reject?: (e: unknown) => unknown) => {
      calls.selectLookups += 1;
      if (state.lastConvexIdFilter) {
        calls.convexIdLookups.push(state.lastConvexIdFilter);
      }
      const terminal = tableQueue.TaskMessage.shift() ?? { data: [], error: null };
      return Promise.resolve(terminal).then(resolve, reject);
    };
    obj.insert = vi.fn((payload: Record<string, unknown>) => {
      calls.inserts.push(payload);
      return Promise.resolve({ data: null, error: null });
    });
    return obj;
  }
  return { supabase: { from: vi.fn(() => chain()) } };
});

import { GET } from '@/app/api/cron/audit-backfill/route';
import { backfillUnpersistedMessages } from '@/lib/convex/audit-backfill';

const ENV_KEYS = ['CRON_SECRET', 'NEXT_PUBLIC_CONVEX_URL', 'CONVEX_SERVICE_SECRET'] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function makeReq(auth?: string): Request {
  const headers: Record<string, string> = {};
  if (auth !== undefined) headers.Authorization = auth;
  return new Request('http://localhost/api/cron/audit-backfill', {
    method: 'GET',
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  tableQueue.TaskMessage.length = 0;
  calls.inserts.length = 0;
  calls.selectLookups = 0;
  calls.convexIdLookups.length = 0;
  mutationMock.mockClear();
  queryMock.mockClear();
  process.env.CRON_SECRET = 'test-secret';
  process.env.NEXT_PUBLIC_CONVEX_URL = 'https://example.convex.cloud';
  process.env.CONVEX_SERVICE_SECRET = 'shh';
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('GET /api/cron/audit-backfill — auth', () => {
  it('401 when no Authorization header', async () => {
    const res = await GET(makeReq() as never);
    expect(res.status).toBe(401);
  });

  it('401 on a wrong bearer', async () => {
    const res = await GET(makeReq('Bearer nope') as never);
    expect(res.status).toBe(401);
  });

  it('500 when CRON_SECRET is missing', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeReq('Bearer test-secret') as never);
    expect(res.status).toBe(500);
  });

  it('returns zero summary on the empty path', async () => {
    queryMock.mockResolvedValueOnce([]);
    const res = await GET(makeReq('Bearer test-secret') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ persisted: 0, skipped: 0, failed: 0 });
  });
});

describe('backfillUnpersistedMessages — bridge', () => {
  it('no-ops when NEXT_PUBLIC_CONVEX_URL is unset', async () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    const result = await backfillUnpersistedMessages();
    expect(result).toEqual({ persisted: 0, skipped: 0, failed: 0 });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('no-ops when CONVEX_SERVICE_SECRET is unset', async () => {
    delete process.env.CONVEX_SERVICE_SECRET;
    const result = await backfillUnpersistedMessages();
    expect(result).toEqual({ persisted: 0, skipped: 0, failed: 0 });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('inserts each row into Supabase with its convexMessageId and flips the Convex flag', async () => {
    queryMock.mockResolvedValueOnce([
      {
        _id: 'live_1',
        conversationId: 'conv_a',
        role: 'user',
        content: 'first',
        metadata: null,
        createdAt: 1_700_000_000_000,
      },
      {
        _id: 'live_2',
        conversationId: 'conv_a',
        role: 'assistant',
        content: 'second',
        metadata: { delegatedTo: 'engineering' },
        createdAt: 1_700_000_001_000,
      },
    ]);
    // Convex-id lookups: no existing row for either.
    tableQueue.TaskMessage.push(
      { data: [], error: null },
      { data: [], error: null },
    );

    const result = await backfillUnpersistedMessages();
    expect(result.persisted).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(calls.inserts).toHaveLength(2);
    expect(calls.inserts[0]).toMatchObject({
      conversationId: 'conv_a',
      role: 'user',
      content: 'first',
      convexMessageId: 'live_1',
    });
    expect(calls.inserts[1]).toMatchObject({
      conversationId: 'conv_a',
      role: 'assistant',
      content: 'second',
      convexMessageId: 'live_2',
    });
    expect(calls.convexIdLookups).toEqual(['live_1', 'live_2']);
    expect(mutationMock).toHaveBeenCalledTimes(2);
  });

  it('1st run: convexMessageId not in Supabase → INSERT + flag', async () => {
    queryMock.mockResolvedValueOnce([
      {
        _id: 'live_fresh',
        conversationId: 'conv_a',
        role: 'user',
        content: 'hello',
        metadata: null,
        createdAt: 1_700_000_000_000,
      },
    ]);
    tableQueue.TaskMessage.push({ data: [], error: null });
    const result = await backfillUnpersistedMessages();
    expect(result).toEqual({ persisted: 1, skipped: 0, failed: 0 });
    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0]).toMatchObject({ convexMessageId: 'live_fresh' });
    expect(mutationMock).toHaveBeenCalledTimes(1);
  });

  it('2nd run on same row: convexMessageId IS in Supabase → skip insert, still flag (idempotent)', async () => {
    queryMock.mockResolvedValueOnce([
      {
        _id: 'live_dup',
        conversationId: 'conv_a',
        role: 'user',
        content: 'dup',
        metadata: null,
        createdAt: 1_700_000_000_000,
      },
    ]);
    tableQueue.TaskMessage.push({ data: [{ id: 'tm_existing' }], error: null });

    const result = await backfillUnpersistedMessages();
    expect(result).toEqual({ persisted: 0, skipped: 1, failed: 0 });
    expect(calls.inserts).toHaveLength(0);
    expect(mutationMock).toHaveBeenCalledTimes(1);
    expect(mutationMock.mock.calls[0][1]).toMatchObject({
      serviceSecret: 'shh',
      messageId: 'live_dup',
    });
  });

  it('two identical messages with different _ids both persist (regression: kills the 5s-window bug)', async () => {
    queryMock.mockResolvedValueOnce([
      {
        _id: 'live_a',
        conversationId: 'conv_x',
        role: 'user',
        content: 'same content',
        metadata: null,
        createdAt: 1_700_000_000_000,
      },
      {
        _id: 'live_b',
        conversationId: 'conv_x',
        role: 'user',
        content: 'same content',
        metadata: null,
        createdAt: 1_700_000_000_500, // within 500ms — old heuristic would collapse
      },
    ]);
    // Both Convex-id lookups return empty: neither row is in Supabase yet.
    tableQueue.TaskMessage.push(
      { data: [], error: null },
      { data: [], error: null },
    );

    const result = await backfillUnpersistedMessages();
    expect(result.persisted).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(calls.inserts).toHaveLength(2);
    expect(calls.inserts[0]).toMatchObject({ convexMessageId: 'live_a' });
    expect(calls.inserts[1]).toMatchObject({ convexMessageId: 'live_b' });
  });

  it('isolates a row failure and continues with the rest', async () => {
    queryMock.mockResolvedValueOnce([
      {
        _id: 'live_ok',
        conversationId: 'conv_a',
        role: 'user',
        content: 'good',
        metadata: null,
        createdAt: 1_700_000_000_000,
      },
      {
        _id: 'live_bad',
        conversationId: 'conv_b',
        role: 'user',
        content: 'bad',
        metadata: null,
        createdAt: 1_700_000_001_000,
      },
    ]);
    tableQueue.TaskMessage.push(
      { data: [], error: null },
      { data: [], error: null },
    );
    mutationMock
      .mockResolvedValueOnce(undefined as unknown)
      .mockRejectedValueOnce(new Error('flag failed') as unknown);

    const result = await backfillUnpersistedMessages();
    expect(result.persisted).toBe(1);
    // The failing row went through insert (counted as persisted then
    // rolled back into "failed" only if try/catch caught the
    // post-insert mutation error). Our loop counts on the catch path.
    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('a bad row in the middle of the batch does not kill the rest', async () => {
    queryMock.mockResolvedValueOnce([
      { _id: 'a', conversationId: 'c1', role: 'user', content: '1', metadata: null, createdAt: 1 },
      { _id: 'b', conversationId: 'c1', role: 'user', content: '2', metadata: null, createdAt: 2 },
      { _id: 'c', conversationId: 'c1', role: 'user', content: '3', metadata: null, createdAt: 3 },
    ]);
    // All three dedupe lookups return empty.
    tableQueue.TaskMessage.push(
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
    );
    mutationMock
      .mockResolvedValueOnce(undefined as unknown)
      .mockRejectedValueOnce(new Error('boom') as unknown)
      .mockResolvedValueOnce(undefined as unknown);

    const result = await backfillUnpersistedMessages();
    expect(result.persisted).toBe(2);
    expect(result.failed).toBe(1);
    expect(calls.inserts).toHaveLength(3);
  });

  it('handles supabase insert error: counts failed, no flag', async () => {
    queryMock.mockResolvedValueOnce([
      {
        _id: 'live_x',
        conversationId: 'c1',
        role: 'user',
        content: 'oops',
        metadata: null,
        createdAt: 1,
      },
    ]);
    tableQueue.TaskMessage.push({ data: [], error: null });
    // Override insert to return an error.
    const supa = (await import('@/lib/supabase')).supabase as unknown as {
      from: (table: string) => Record<string, unknown>;
    };
    const fromSpy = vi.spyOn(supa, 'from');
    fromSpy.mockImplementationOnce(() => {
      const obj: Record<string, unknown> = {};
      obj.select = () => obj;
      obj.eq = () => obj;
      obj.limit = () => obj;
      (obj as { then: unknown }).then = (resolve: (v: Terminal) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve);
      return obj;
    });
    fromSpy.mockImplementationOnce(() => {
      const obj: Record<string, unknown> = {};
      obj.insert = vi.fn(() => Promise.resolve({ data: null, error: { message: 'insert blew up' } }));
      return obj;
    });

    const result = await backfillUnpersistedMessages();
    expect(result.failed).toBe(1);
    expect(result.persisted).toBe(0);
    expect(mutationMock).not.toHaveBeenCalled();
    fromSpy.mockRestore();
  });

  it('returns zeros and does not throw when Convex query fails', async () => {
    queryMock.mockRejectedValueOnce(new Error('convex offline'));
    const result = await backfillUnpersistedMessages();
    expect(result).toEqual({ persisted: 0, skipped: 0, failed: 0 });
    expect(calls.inserts).toHaveLength(0);
  });

  it('keys the dedupe lookup on convexMessageId, not on content/role/createdAt', async () => {
    queryMock.mockResolvedValueOnce([
      {
        _id: 'live_only',
        conversationId: 'conv_y',
        role: 'user',
        content: 'hi',
        metadata: null,
        createdAt: 1_700_000_000_000,
      },
    ]);
    tableQueue.TaskMessage.push({ data: [], error: null });
    await backfillUnpersistedMessages();
    expect(calls.convexIdLookups).toEqual(['live_only']);
  });

  it('the cron route forwards counts to the JSON response', async () => {
    queryMock.mockResolvedValueOnce([
      {
        _id: 'live_only',
        conversationId: 'conv_x',
        role: 'user',
        content: 'one',
        metadata: null,
        createdAt: 1_700_000_000_000,
      },
    ]);
    tableQueue.TaskMessage.push({ data: [], error: null });
    const res = await GET(makeReq('Bearer test-secret') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ persisted: 1, skipped: 0, failed: 0 });
  });
});
