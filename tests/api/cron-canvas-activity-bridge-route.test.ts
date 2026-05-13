/**
 * Route + bridge tests for `GET /api/cron/canvas-activity-bridge`.
 *
 * The cron is secret-gated, calls into the polling bridge, and returns a
 * summary JSON. We mock Supabase (the bridge's only data source) and the
 * Convex HTTP client (the only side effect), then assert auth behavior,
 * emit fan-out, and per-process idempotency.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type Terminal = { data?: unknown; error?: unknown };
let supabaseQueue: Terminal[] = [];

vi.mock('@/lib/supabase', () => {
  function makeChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    const terminal = supabaseQueue.shift() ?? { data: [], error: null };
    const passthrough = ['select', 'eq', 'in', 'is', 'not', 'gte', 'lt', 'order', 'limit', 'or'];
    for (const m of passthrough) {
      chain[m] = vi.fn((..._args: unknown[]) => chain);
    }
    chain.then = (resolve: (v: Terminal) => unknown, reject?: (e: unknown) => unknown) => {
      try {
        return Promise.resolve(terminal).then(resolve, reject);
      } catch (e) {
        return reject ? reject(e) : Promise.reject(e);
      }
    };
    return chain;
  }
  return { supabase: { from: vi.fn(() => makeChain()) } };
});

const mutationMock = vi.fn();
vi.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    constructor(public url: string) {}
    setAuth(_t: string) {}
    mutation(...args: unknown[]) {
      return mutationMock(...args);
    }
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET } from '@/app/api/cron/canvas-activity-bridge/route';
import { __resetSeenForTests } from '@/lib/convex/dept-activity-bridge';

const ENV_KEYS = ['CRON_SECRET', 'NEXT_PUBLIC_CONVEX_URL', 'CONVEX_SERVICE_JWT'] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function snap() {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
}
function restore() {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

function makeReq(authHeader?: string): Request {
  return new Request('http://test/api/cron/canvas-activity-bridge', {
    method: 'GET',
    headers: authHeader ? { Authorization: authHeader } : {},
  });
}

function isoSecondsAgo(s: number): string {
  return new Date(Date.now() - s * 1000).toISOString();
}

function memberRow(over: Partial<{
  id: string;
  role: string;
  status: string;
  name: string;
  task: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
  spaceId: string;
}> = {}) {
  return {
    id: over.id ?? 'm1',
    role: over.role ?? 'engineering',
    status: over.status ?? 'running',
    name: over.name ?? 'agent-1',
    task: over.task ?? 'do the thing',
    startedAt: over.startedAt ?? isoSecondsAgo(5),
    completedAt: over.completedAt ?? null,
    createdAt: over.createdAt ?? isoSecondsAgo(30),
    swarmRun: { id: 'run-1', spaceId: over.spaceId ?? 'space-1' },
  };
}

describe('GET /api/cron/canvas-activity-bridge', () => {
  beforeEach(() => {
    snap();
    supabaseQueue = [];
    mutationMock.mockReset();
    mutationMock.mockResolvedValue('ok');
    __resetSeenForTests();
    delete process.env.CRON_SECRET;
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    delete process.env.CONVEX_SERVICE_JWT;
  });
  afterEach(() => {
    restore();
  });

  it('returns 500 when CRON_SECRET is not configured', async () => {
    const res = await GET(makeReq('Bearer anything') as never);
    expect(res.status).toBe(500);
  });

  it('returns 401 when the Authorization header is missing', async () => {
    process.env.CRON_SECRET = 'shh';
    const res = await GET(makeReq() as never);
    expect(res.status).toBe(401);
  });

  it('returns 401 when the Bearer token is wrong', async () => {
    process.env.CRON_SECRET = 'shh';
    const res = await GET(makeReq('Bearer nope') as never);
    expect(res.status).toBe(401);
  });

  it('returns 200 with a zero summary when there are no rows', async () => {
    process.env.CRON_SECRET = 'shh';
    supabaseQueue = [{ data: [], error: null }];
    const res = await GET(makeReq('Bearer shh') as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; scanned: number; emitted: number };
    expect(body.ok).toBe(true);
    expect(body.scanned).toBe(0);
    expect(body.emitted).toBe(0);
  });

  it('emits Convex events for fresh running rows', async () => {
    process.env.CRON_SECRET = 'shh';
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://x.convex.cloud';
    supabaseQueue = [{ data: [memberRow({ id: 'm1', role: 'engineering', status: 'running' })], error: null }];

    const res = await GET(makeReq('Bearer shh') as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { emitted: number; scanned: number };
    expect(body.scanned).toBe(1);
    expect(body.emitted).toBe(1);
    expect(mutationMock).toHaveBeenCalledTimes(1);
    const args = mutationMock.mock.calls[0]?.[1];
    expect(args).toMatchObject({
      spaceId: 'space-1',
      department: 'engineering',
      kind: 'running',
    });
  });

  it('maps completed -> done and failed -> failed', async () => {
    process.env.CRON_SECRET = 'shh';
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://x.convex.cloud';
    supabaseQueue = [
      {
        data: [
          memberRow({ id: 'm-c', status: 'completed', completedAt: isoSecondsAgo(2), role: 'sales' }),
          memberRow({ id: 'm-f', status: 'failed', completedAt: isoSecondsAgo(3), role: 'support' }),
        ],
        error: null,
      },
    ];
    await GET(makeReq('Bearer shh') as never);
    const kinds = mutationMock.mock.calls.map((c) => (c[1] as { kind: string }).kind);
    expect(kinds.sort()).toEqual(['done', 'failed']);
  });

  it('skips rows with an unknown role', async () => {
    process.env.CRON_SECRET = 'shh';
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://x.convex.cloud';
    supabaseQueue = [
      { data: [memberRow({ id: 'm-x', role: 'kitchen' as never })], error: null },
    ];
    const res = await GET(makeReq('Bearer shh') as never);
    const body = (await res.json()) as { emitted: number; skipped: number };
    expect(body.emitted).toBe(0);
    expect(body.skipped).toBe(1);
    expect(mutationMock).not.toHaveBeenCalled();
  });

  it('skips rows whose transition fell outside the look-back window', async () => {
    process.env.CRON_SECRET = 'shh';
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://x.convex.cloud';
    supabaseQueue = [
      {
        data: [
          memberRow({
            id: 'old',
            status: 'running',
            startedAt: isoSecondsAgo(300),
            createdAt: isoSecondsAgo(300),
          }),
        ],
        error: null,
      },
    ];
    await GET(makeReq('Bearer shh') as never);
    expect(mutationMock).not.toHaveBeenCalled();
  });

  it('is idempotent: a second invocation does not re-emit the same (member, kind)', async () => {
    process.env.CRON_SECRET = 'shh';
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://x.convex.cloud';
    const row = memberRow({ id: 'mX', status: 'running' });
    supabaseQueue = [
      { data: [row], error: null },
      { data: [row], error: null },
    ];

    await GET(makeReq('Bearer shh') as never);
    await GET(makeReq('Bearer shh') as never);
    expect(mutationMock).toHaveBeenCalledTimes(1);
  });

  it('emits a second time when the same member transitions to a different kind', async () => {
    process.env.CRON_SECRET = 'shh';
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://x.convex.cloud';
    supabaseQueue = [
      { data: [memberRow({ id: 'mY', status: 'running' })], error: null },
      {
        data: [
          memberRow({
            id: 'mY',
            status: 'completed',
            completedAt: isoSecondsAgo(1),
          }),
        ],
        error: null,
      },
    ];

    await GET(makeReq('Bearer shh') as never);
    await GET(makeReq('Bearer shh') as never);
    expect(mutationMock).toHaveBeenCalledTimes(2);
    const kinds = mutationMock.mock.calls.map((c) => (c[1] as { kind: string }).kind);
    expect(kinds).toEqual(['running', 'done']);
  });

  it('returns errored=1 in the summary when the Supabase query throws', async () => {
    process.env.CRON_SECRET = 'shh';
    supabaseQueue = [{ data: null, error: new Error('db down') }];
    const res = await GET(makeReq('Bearer shh') as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { errored: number; emitted: number };
    expect(body.errored).toBe(1);
    expect(body.emitted).toBe(0);
  });

  it('counts a failed Convex mutation as errored but does not crash the cron', async () => {
    process.env.CRON_SECRET = 'shh';
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://x.convex.cloud';
    mutationMock.mockReset();
    mutationMock.mockRejectedValueOnce(new Error('convex blip'));
    supabaseQueue = [
      { data: [memberRow({ id: 'mZ', status: 'running' })], error: null },
    ];

    const res = await GET(makeReq('Bearer shh') as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { emitted: number; errored: number };
    expect(body.emitted).toBe(0);
    expect(body.errored).toBe(1);
  });

  it('skips rows whose status is not in the known map (e.g. cancelled)', async () => {
    process.env.CRON_SECRET = 'shh';
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://x.convex.cloud';
    supabaseQueue = [
      { data: [memberRow({ id: 'mc', status: 'cancelled' as never })], error: null },
    ];
    await GET(makeReq('Bearer shh') as never);
    expect(mutationMock).not.toHaveBeenCalled();
  });

  it('uses the member name as the summary when present', async () => {
    process.env.CRON_SECRET = 'shh';
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://x.convex.cloud';
    supabaseQueue = [
      { data: [memberRow({ id: 'ms', name: 'Prospector', status: 'running' })], error: null },
    ];
    await GET(makeReq('Bearer shh') as never);
    const args = mutationMock.mock.calls[0]?.[1] as { summary: string };
    expect(args.summary).toBe('Prospector');
  });

  it('falls back to a trimmed task slice when name is empty', async () => {
    process.env.CRON_SECRET = 'shh';
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://x.convex.cloud';
    supabaseQueue = [
      {
        data: [
          memberRow({
            id: 'ms2',
            name: '',
            task: 'a'.repeat(120),
            status: 'running',
          }),
        ],
        error: null,
      },
    ];
    await GET(makeReq('Bearer shh') as never);
    const args = mutationMock.mock.calls[0]?.[1] as { summary: string };
    expect(args.summary.length).toBeLessThanOrEqual(80);
  });
});
