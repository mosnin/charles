/**
 * Route-level tests for POST /api/briefing/send.
 *
 * Mocks:
 *   - `@/lib/supabase` chainable thenable for Space + User reads.
 *   - `@/lib/briefing/build-daily-briefing` → returns a fixture payload.
 *   - `resend` → in-memory spy on `emails.send`.
 *
 * No real network is touched. Env vars are saved/restored per test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Supabase mock ───────────────────────────────────────────────────────────
type Terminal = { data?: unknown; error?: unknown; count?: number | null };
let supabaseQueue: Terminal[] = [];

vi.mock('@/lib/supabase', () => {
  function makeChain(): Record<string, unknown> {
    const terminal = supabaseQueue.shift() ?? { data: null, error: null };
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

// Import after mocks.
import { POST } from '@/app/api/briefing/send/route';

const ENV_KEYS = ['CRON_SECRET', 'RESEND_API_KEY', 'NEXT_PUBLIC_APP_URL', 'RESEND_FROM_EMAIL'] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
function snapshot() { for (const k of ENV_KEYS) saved[k] = process.env[k]; }
function restore() {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

function makeRequest(opts: { auth?: string; body?: unknown }): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.auth !== undefined) headers.Authorization = opts.auth;
  return new Request('http://localhost/api/briefing/send', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body ?? {}),
  });
}

function queueOwnerLookup() {
  supabaseQueue = [
    { data: { id: 'space-1', slug: 'acme', ownerId: 'user-1' }, error: null },
    { data: { email: 'jane@acme.test' }, error: null },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseQueue = [];
  snapshot();
  process.env.CRON_SECRET = 'test-secret';
  process.env.RESEND_API_KEY = 're_test';
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.charles.dev';
  buildMock.mockResolvedValue({
    founderFirstName: 'Jane',
    workspaceName: 'Acme',
    yesterdayHighlights: ['x'],
    needsYouToday: ['y'],
    pendingApprovalsCount: 1,
    openTasksCount: 0,
    currentStage: 'building',
    isRestDay: false,
  });
  sendMock.mockResolvedValue({ data: { id: 'msg-123' }, error: null });
});

afterEach(() => {
  restore();
});

describe('POST /api/briefing/send', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const res = await POST(makeRequest({ body: { spaceId: 'space-1' } }) as never);
    expect(res.status).toBe(401);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns 401 on wrong bearer', async () => {
    const res = await POST(makeRequest({ auth: 'Bearer wrong', body: { spaceId: 'space-1' } }) as never);
    expect(res.status).toBe(401);
  });

  it('returns 400 when spaceId missing', async () => {
    const res = await POST(makeRequest({ auth: 'Bearer test-secret', body: {} }) as never);
    expect(res.status).toBe(400);
  });

  it('returns 404 when space or owner missing', async () => {
    supabaseQueue = [{ data: null, error: null }];
    const res = await POST(makeRequest({ auth: 'Bearer test-secret', body: { spaceId: 'missing' } }) as never);
    expect(res.status).toBe(404);
  });

  it('200 happy path — calls resend with subject + html + text', async () => {
    queueOwnerLookup();
    const res = await POST(makeRequest({ auth: 'Bearer test-secret', body: { spaceId: 'space-1' } }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ sent: true, messageId: 'msg-123' });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const args = sendMock.mock.calls[0][0];
    expect(args.to).toBe('jane@acme.test');
    expect(args.subject).toContain('Jane');
    expect(args.subject).toContain('Acme');
    expect(typeof args.html).toBe('string');
    expect(typeof args.text).toBe('string');
    expect(args.html.length).toBeGreaterThan(0);
  });

  it('502 when Resend returns an error object', async () => {
    queueOwnerLookup();
    sendMock.mockResolvedValueOnce({ data: null, error: { message: 'rate_limited' } });
    const res = await POST(makeRequest({ auth: 'Bearer test-secret', body: { spaceId: 'space-1' } }) as never);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain('rate_limited');
  });

  it('502 when Resend client throws', async () => {
    queueOwnerLookup();
    sendMock.mockRejectedValueOnce(new Error('network'));
    const res = await POST(makeRequest({ auth: 'Bearer test-secret', body: { spaceId: 'space-1' } }) as never);
    expect(res.status).toBe(502);
  });

  it('returns 500 when RESEND_API_KEY missing', async () => {
    delete process.env.RESEND_API_KEY;
    const res = await POST(makeRequest({ auth: 'Bearer test-secret', body: { spaceId: 'space-1' } }) as never);
    expect(res.status).toBe(500);
  });
});
