/**
 * Route-level tests for GET /api/cron/daily-briefing.
 *
 * Mocks: Supabase chainable, briefing builder, Resend client. Each test
 * snapshots env, runs the handler against an in-memory space list, and
 * asserts the aggregate summary or HTTP status.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Supabase mock ───────────────────────────────────────────────────────────
type Terminal = { data?: unknown; error?: unknown; count?: number | null };
let supabaseQueue: Terminal[] = [];

vi.mock('@/lib/supabase', () => {
  function makeChain(): Record<string, unknown> {
    const terminal = supabaseQueue.shift() ?? { data: [], error: null };
    const chain: Record<string, unknown> = {};
    const passthrough = ['select', 'eq', 'in', 'is', 'not', 'gte', 'lt', 'order', 'limit'];
    for (const m of passthrough) chain[m] = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(() => Promise.resolve(terminal));
    chain.single = vi.fn(() => Promise.resolve(terminal));
    chain.then = (resolve: (v: Terminal) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(terminal).then(resolve, reject);
    return chain;
  }
  return { supabase: { from: vi.fn(() => makeChain()) } };
});

// ── Briefing builder mock ───────────────────────────────────────────────────
const buildMock = vi.fn();
vi.mock('@/lib/briefing/build-daily-briefing', () => ({
  buildDailyBriefing: (...args: unknown[]) => buildMock(...args),
}));

// ── Resend mock ─────────────────────────────────────────────────────────────
const sendMock = vi.fn();
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  })),
}));

import { GET } from '@/app/api/cron/daily-briefing/route';

const ENV_KEYS = ['CRON_SECRET', 'RESEND_API_KEY', 'NEXT_PUBLIC_APP_URL'] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
function snapshot() { for (const k of ENV_KEYS) saved[k] = process.env[k]; }
function restore() {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

function makeRequest(auth?: string): Request {
  const headers: Record<string, string> = {};
  if (auth !== undefined) headers.Authorization = auth;
  return new Request('http://localhost/api/cron/daily-briefing', {
    method: 'GET',
    headers,
  });
}

function queueSpaces(spaces: Array<{ id: string; slug: string; ownerId: string; owner: { email: string | null; name: string | null } | null }>) {
  supabaseQueue = [{ data: spaces, error: null }];
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseQueue = [];
  snapshot();
  process.env.CRON_SECRET = 'test-secret';
  process.env.RESEND_API_KEY = 're_test';
  buildMock.mockResolvedValue({
    founderFirstName: 'Jane',
    workspaceName: 'Acme',
    yesterdayHighlights: ['x'],
    needsYouToday: [{ label: 'y', href: '/s/acme/tasks' }],
    comingUp: [],
    pendingApprovalsCount: 1,
    openTasksCount: 0,
    currentStage: 'building',
    isRestDay: false,
  });
  sendMock.mockResolvedValue({ data: { id: 'msg-1' }, error: null });
});

afterEach(() => {
  restore();
});

describe('GET /api/cron/daily-briefing', () => {
  it('401 when Authorization header missing', async () => {
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(401);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('401 on wrong bearer', async () => {
    const res = await GET(makeRequest('Bearer wrong') as never);
    expect(res.status).toBe(401);
  });

  it('500 when RESEND_API_KEY missing', async () => {
    delete process.env.RESEND_API_KEY;
    const res = await GET(makeRequest('Bearer test-secret') as never);
    expect(res.status).toBe(500);
  });

  it('returns zero summary when no active spaces', async () => {
    queueSpaces([]);
    const res = await GET(makeRequest('Bearer test-secret') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ total: 0, sent: 0, failed: 0, failures: [] });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('iterates spaces and sends one email per owner', async () => {
    queueSpaces([
      { id: 's1', slug: 'a', ownerId: 'u1', owner: { email: 'a@x.test', name: 'Alice' } },
      { id: 's2', slug: 'b', ownerId: 'u2', owner: { email: 'b@x.test', name: 'Bob' } },
    ]);
    const res = await GET(makeRequest('Bearer test-secret') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.sent).toBe(2);
    expect(body.failed).toBe(0);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('treats space owner without email as a failure but continues', async () => {
    queueSpaces([
      { id: 's1', slug: 'a', ownerId: 'u1', owner: { email: null, name: 'Alice' } },
      { id: 's2', slug: 'b', ownerId: 'u2', owner: { email: 'b@x.test', name: 'Bob' } },
    ]);
    const res = await GET(makeRequest('Bearer test-secret') as never);
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.sent).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.failures[0]).toEqual({ spaceId: 's1', error: 'no_owner_email' });
  });

  it('catches per-space Resend errors without crashing the job', async () => {
    queueSpaces([
      { id: 's1', slug: 'a', ownerId: 'u1', owner: { email: 'a@x.test', name: 'Alice' } },
      { id: 's2', slug: 'b', ownerId: 'u2', owner: { email: 'b@x.test', name: 'Bob' } },
    ]);
    sendMock
      .mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
      .mockResolvedValueOnce({ data: { id: 'ok' }, error: null });
    const res = await GET(makeRequest('Bearer test-secret') as never);
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.sent).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.failures[0]).toMatchObject({ spaceId: 's1', error: 'boom' });
  });

  it('catches per-space build failures without crashing', async () => {
    queueSpaces([
      { id: 's1', slug: 'a', ownerId: 'u1', owner: { email: 'a@x.test', name: 'Alice' } },
    ]);
    buildMock.mockResolvedValueOnce(null);
    const res = await GET(makeRequest('Bearer test-secret') as never);
    const body = await res.json();
    expect(body.failed).toBe(1);
    expect(body.failures[0]).toEqual({ spaceId: 's1', error: 'build_failed' });
  });

  it('catches per-space exceptions without crashing', async () => {
    queueSpaces([
      { id: 's1', slug: 'a', ownerId: 'u1', owner: { email: 'a@x.test', name: 'Alice' } },
      { id: 's2', slug: 'b', ownerId: 'u2', owner: { email: 'b@x.test', name: 'Bob' } },
    ]);
    sendMock.mockRejectedValueOnce(new Error('network'));
    const res = await GET(makeRequest('Bearer test-secret') as never);
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.sent).toBe(1);
    expect(body.failed).toBe(1);
  });

  it('handles embedded owner returned as an array', async () => {
    // PostgREST sometimes returns the FK join as an array.
    queueSpaces([
      { id: 's1', slug: 'a', ownerId: 'u1', owner: [{ email: 'a@x.test', name: 'Alice' }] as unknown as { email: string; name: string } },
    ]);
    const res = await GET(makeRequest('Bearer test-secret') as never);
    const body = await res.json();
    expect(body.sent).toBe(1);
  });
});
