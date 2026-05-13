/**
 * Tests for GET /api/cron/audit-backfill and the underlying
 * backfillUnpersistedMessages bridge. Mocks Convex HTTP client and
 * Supabase; covers auth, env-not-configured, happy-path persistence,
 * dedupe, and per-row failure isolation.
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
    TaskMessage: [] as Terminal[],
  },
  calls: {
    inserts: [] as Array<Record<string, unknown>>,
    selectLookups: 0,
  },
}));

vi.mock('@/lib/supabase', () => {
  function chain() {
    const obj: Record<string, unknown> = {};
    const passthrough = ['select', 'eq', 'in', 'gte', 'lte', 'order', 'limit'];
    for (const m of passthrough) {
      obj[m] = vi.fn(() => obj);
    }
    obj.maybeSingle = vi.fn(() =>
      Promise.resolve(tableQueue.TaskMessage.shift() ?? { data: null, error: null }),
    );
    obj.then = (resolve: (v: Terminal) => unknown, reject?: (e: unknown) => unknown) => {
      calls.selectLookups += 1;
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
    expect(body).toEqual({ persisted: 0, failed: 0 });
  });
});

describe('backfillUnpersistedMessages — bridge', () => {
  it('no-ops when NEXT_PUBLIC_CONVEX_URL is unset', async () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    const result = await backfillUnpersistedMessages();
    expect(result).toEqual({ persisted: 0, failed: 0 });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('no-ops when CONVEX_SERVICE_SECRET is unset', async () => {
    delete process.env.CONVEX_SERVICE_SECRET;
    const result = await backfillUnpersistedMessages();
    expect(result).toEqual({ persisted: 0, failed: 0 });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('inserts each row into Supabase and flips the Convex flag', async () => {
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
    // Each lookup returns no existing dupe.
    tableQueue.TaskMessage.push(
      { data: [], error: null },
      { data: [], error: null },
    );

    const result = await backfillUnpersistedMessages();
    expect(result.persisted).toBe(2);
    expect(result.failed).toBe(0);
    expect(calls.inserts).toHaveLength(2);
    expect(calls.inserts[0]).toMatchObject({
      conversationId: 'conv_a',
      role: 'user',
      content: 'first',
    });
    expect(calls.inserts[1]).toMatchObject({
      conversationId: 'conv_a',
      role: 'assistant',
      content: 'second',
    });
    // Two flagPersisted mutations, one per row.
    expect(mutationMock).toHaveBeenCalledTimes(2);
  });

  it('skips the insert when a duplicate TaskMessage already exists, still flips the flag', async () => {
    queryMock.mockResolvedValueOnce([
      {
        _id: 'live_1',
        conversationId: 'conv_a',
        role: 'user',
        content: 'dup',
        metadata: null,
        createdAt: 1_700_000_000_000,
      },
    ]);
    tableQueue.TaskMessage.push({ data: [{ id: 'tm_existing' }], error: null });

    const result = await backfillUnpersistedMessages();
    expect(result).toEqual({ persisted: 1, failed: 0 });
    expect(calls.inserts).toHaveLength(0);
    expect(mutationMock).toHaveBeenCalledTimes(1);
    expect(mutationMock.mock.calls[0][1]).toMatchObject({
      serviceSecret: 'shh',
      messageId: 'live_1',
    });
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
      { data: [], error: null }, // dedupe lookup row 1
      { data: [], error: null }, // dedupe lookup row 2
    );
    mutationMock
      .mockResolvedValueOnce(undefined as unknown) // flagPersisted for live_ok
      .mockRejectedValueOnce(new Error('flag failed') as unknown); // flagPersisted for live_bad

    const result = await backfillUnpersistedMessages();
    expect(result.persisted).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('returns zeros and does not throw when Convex query fails', async () => {
    queryMock.mockRejectedValueOnce(new Error('convex offline'));
    const result = await backfillUnpersistedMessages();
    expect(result).toEqual({ persisted: 0, failed: 0 });
    expect(calls.inserts).toHaveLength(0);
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
    expect(body).toEqual({ persisted: 1, failed: 0 });
  });
});
