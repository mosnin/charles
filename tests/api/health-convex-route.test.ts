/**
 * Route tests for GET /api/health/convex.
 *
 * The handler is contract surface for the workspace's health badge. It
 * must never throw, must capture latency, must distinguish the three
 * states (unconfigured / healthy / unhealthy), and must gate on a
 * logged-in Clerk session. We mock Clerk auth and ConvexHttpClient so
 * the test runs without a real deployment.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => authMock(),
}));

const queryMock = vi.fn();
vi.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    constructor(public url: string) {}
    setAuth(_t: string) {}
    query(...args: unknown[]) {
      return queryMock(...args);
    }
  },
}));

import { GET } from '@/app/api/health/convex/route';

const ENV_KEYS = ['NEXT_PUBLIC_CONVEX_URL'] as const;
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

describe('GET /api/health/convex', () => {
  beforeEach(() => {
    snap();
    authMock.mockReset();
    queryMock.mockReset();
    authMock.mockResolvedValue({ userId: 'user_1' });
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
  });

  afterEach(() => {
    restore();
  });

  it('returns 401 when no Clerk session is present', async () => {
    authMock.mockResolvedValue({ userId: null });
    const res = await GET();
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 200 with status=unconfigured when NEXT_PUBLIC_CONVEX_URL is unset', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; message: string };
    expect(body.status).toBe('unconfigured');
    expect(typeof body.message).toBe('string');
  });

  it('does not call Convex when unconfigured', async () => {
    await GET();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns 200 healthy with latencyMs and serverTime on a successful ping', async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://x.convex.cloud';
    queryMock.mockResolvedValue({ ok: true, serverTime: 1234567890 });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      latencyMs: number;
      serverTime: number;
    };
    expect(body.status).toBe('healthy');
    expect(body.serverTime).toBe(1234567890);
    expect(typeof body.latencyMs).toBe('number');
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns 503 unhealthy when the Convex query throws', async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://x.convex.cloud';
    queryMock.mockRejectedValue(new Error('convex down'));

    const res = await GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      status: string;
      error: string;
      latencyMs: number;
    };
    expect(body.status).toBe('unhealthy');
    expect(body.error).toBe('convex down');
    expect(typeof body.latencyMs).toBe('number');
  });

  it('returns 503 unhealthy when the ping response is malformed (no ok flag)', async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://x.convex.cloud';
    queryMock.mockResolvedValue({ serverTime: 1 });

    const res = await GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; error: string };
    expect(body.status).toBe('unhealthy');
    expect(body.error).toContain('Unexpected');
  });

  it('returns 503 unhealthy when the client constructor throws', async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://x.convex.cloud';
    queryMock.mockImplementation(() => {
      throw new Error('boom');
    });

    const res = await GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; error: string };
    expect(body.status).toBe('unhealthy');
    expect(body.error).toBe('boom');
  });

  it('handles non-Error thrown values gracefully', async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://x.convex.cloud';
    queryMock.mockRejectedValue('plain string');

    const res = await GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; error: string };
    expect(body.status).toBe('unhealthy');
    expect(body.error).toBe('Unknown error');
  });

  it('never throws even on the worst path — always returns JSON', async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://x.convex.cloud';
    queryMock.mockRejectedValue(new Error('anything'));

    // Should not throw out of GET.
    const res = await GET();
    expect(res).toBeDefined();
    expect(typeof res.json).toBe('function');
  });

  it('captures latency even on the failure path', async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://x.convex.cloud';
    queryMock.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      throw new Error('slow fail');
    });

    const res = await GET();
    const body = (await res.json()) as { latencyMs: number };
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
