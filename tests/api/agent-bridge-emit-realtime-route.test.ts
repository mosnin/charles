/**
 * Route tests for /api/agent-bridge/emit-realtime — the Python → TS bridge
 * that lands a realtime tick in Convex.
 *
 * Coverage:
 *   - 401 when AGENT_INTERNAL_SECRET unset OR wrong / missing bearer
 *   - 400 for invalid JSON, missing spaceId, unknown kind
 *   - 200 happy path forwards to emitRealtimeTick with the right shape
 *   - 200 even when the Convex emit fails (best-effort contract)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/convex/server-emit-tick', () => ({
  emitRealtimeTick: vi.fn(),
}));

import { emitRealtimeTick } from '@/lib/convex/server-emit-tick';

const SECRET = 'test-internal-secret';

const mReq = (body: unknown, auth?: string) =>
  new Request('http://l/api/agent-bridge/emit-realtime', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: auth } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as unknown as Parameters<
    typeof import('@/app/api/agent-bridge/emit-realtime/route').POST
  >[0];

const savedSecret = process.env.AGENT_INTERNAL_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AGENT_INTERNAL_SECRET = SECRET;
  (emitRealtimeTick as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.AGENT_INTERNAL_SECRET;
  else process.env.AGENT_INTERNAL_SECRET = savedSecret;
});

describe('POST /api/agent-bridge/emit-realtime', () => {
  it('401 when AGENT_INTERNAL_SECRET is not configured', async () => {
    delete process.env.AGENT_INTERNAL_SECRET;
    const { POST } = await import('@/app/api/agent-bridge/emit-realtime/route');
    const res = await POST(mReq({ spaceId: 's1', kind: 'approval' }, `Bearer ${SECRET}`));
    expect(res.status).toBe(401);
  });

  it('401 when the Authorization header is missing', async () => {
    const { POST } = await import('@/app/api/agent-bridge/emit-realtime/route');
    const res = await POST(mReq({ spaceId: 's1', kind: 'approval' }));
    expect(res.status).toBe(401);
  });

  it('401 when the bearer token is wrong', async () => {
    const { POST } = await import('@/app/api/agent-bridge/emit-realtime/route');
    const res = await POST(mReq({ spaceId: 's1', kind: 'approval' }, 'Bearer nope'));
    expect(res.status).toBe(401);
  });

  it('400 on invalid JSON', async () => {
    const { POST } = await import('@/app/api/agent-bridge/emit-realtime/route');
    const res = await POST(mReq('{not json', `Bearer ${SECRET}`));
    expect(res.status).toBe(400);
  });

  it('400 when spaceId is missing', async () => {
    const { POST } = await import('@/app/api/agent-bridge/emit-realtime/route');
    const res = await POST(mReq({ kind: 'approval' }, `Bearer ${SECRET}`));
    expect(res.status).toBe(400);
  });

  it('400 when kind is not one of the allowed values', async () => {
    const { POST } = await import('@/app/api/agent-bridge/emit-realtime/route');
    const res = await POST(mReq({ spaceId: 's1', kind: 'gossip' }, `Bearer ${SECRET}`));
    expect(res.status).toBe(400);
  });

  it('200 + forwards to emitRealtimeTick on the happy path', async () => {
    const { POST } = await import('@/app/api/agent-bridge/emit-realtime/route');
    const res = await POST(
      mReq({ spaceId: 's1', kind: 'audit', summary: 'draft created' }, `Bearer ${SECRET}`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { emitted: boolean };
    expect(body.emitted).toBe(true);
    expect(emitRealtimeTick).toHaveBeenCalledWith({
      spaceId: 's1',
      kind: 'audit',
      summary: 'draft created',
    });
  });

  it('200 even when the Convex emit fails (best-effort)', async () => {
    (emitRealtimeTick as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    const { POST } = await import('@/app/api/agent-bridge/emit-realtime/route');
    const res = await POST(mReq({ spaceId: 's1', kind: 'approval' }, `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { emitted: boolean };
    expect(body.emitted).toBe(false);
  });

  it('truncates the summary to 200 characters', async () => {
    const { POST } = await import('@/app/api/agent-bridge/emit-realtime/route');
    const long = 'x'.repeat(500);
    await POST(mReq({ spaceId: 's1', kind: 'audit', summary: long }, `Bearer ${SECRET}`));
    const call = (emitRealtimeTick as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(typeof call.summary).toBe('string');
    expect((call.summary as string).length).toBe(200);
  });
});
