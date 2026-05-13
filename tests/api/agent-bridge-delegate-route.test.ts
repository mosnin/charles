/**
 * Route tests for the agent-bridge endpoints.
 *
 * Coverage:
 *   - 401 when unauthenticated
 *   - 403 when no space
 *   - 400 for bad department / missing task / invalid JSON
 *   - 200 happy path forwards to bridge client
 *   - 502 when bridge throws
 *   - 503 when bridge env is missing
 *   - get-mission + advance-stage + update-core-memory parallels
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/space', () => ({ getSpaceForUser: vi.fn() }));
vi.mock('@/lib/agent-bridge/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent-bridge/client')>(
    '@/lib/agent-bridge/client',
  );
  return {
    ...actual,
    callDelegate: vi.fn(),
    callAdvanceStage: vi.fn(),
    callGetMission: vi.fn(),
    callUpdateCoreMemory: vi.fn(),
  };
});

import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import {
  callDelegate,
  callAdvanceStage,
  callGetMission,
  callUpdateCoreMemory,
  BridgeConfigError,
  BridgeAuthError,
  BridgeHttpError,
} from '@/lib/agent-bridge/client';

const mReq = (body: unknown) =>
  new Request('http://l/api/agent-bridge/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as unknown as Parameters<
    typeof import('@/app/api/agent-bridge/delegate/route').POST
  >[0];

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: 'u_1' });
  (getSpaceForUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'sp_1',
    slug: 'team',
    name: 'Team',
    ownerId: 'u_1',
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/agent-bridge/delegate', () => {
  it('401 when unauthenticated', async () => {
    (requireAuth as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const { POST } = await import('@/app/api/agent-bridge/delegate/route');
    const res = await POST(mReq({ department: 'engineering', task: 't' }));
    expect(res.status).toBe(401);
  });

  it('403 when user has no space', async () => {
    (getSpaceForUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const { POST } = await import('@/app/api/agent-bridge/delegate/route');
    const res = await POST(mReq({ department: 'engineering', task: 't' }));
    expect(res.status).toBe(403);
  });

  it('400 when JSON is invalid', async () => {
    const { POST } = await import('@/app/api/agent-bridge/delegate/route');
    const res = await POST(mReq('not-json{'));
    expect(res.status).toBe(400);
  });

  it('400 when department is missing or invalid', async () => {
    const { POST } = await import('@/app/api/agent-bridge/delegate/route');
    const res = await POST(mReq({ department: 'finance', task: 't' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/department/);
  });

  it('400 when task is missing', async () => {
    const { POST } = await import('@/app/api/agent-bridge/delegate/route');
    const res = await POST(mReq({ department: 'engineering' }));
    expect(res.status).toBe(400);
  });

  it('200 happy path forwards to callDelegate and returns the bridge result', async () => {
    (callDelegate as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'completed',
      output: 'shipped',
      swarmMemberId: 'sm_1',
      department: 'engineering',
    });
    const { POST } = await import('@/app/api/agent-bridge/delegate/route');
    const res = await POST(
      mReq({
        department: 'engineering',
        task: 'deploy landing page',
        context: 'urgent',
        runId: 'r_1',
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      status: 'completed',
      output: 'shipped',
      swarmMemberId: 'sm_1',
      department: 'engineering',
    });
    expect(callDelegate).toHaveBeenCalledWith({
      spaceId: 'sp_1',
      runId: 'r_1',
      department: 'engineering',
      task: 'deploy landing page',
      context: 'urgent',
    });
  });

  it('502 when bridge client throws BridgeHttpError', async () => {
    (callDelegate as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new BridgeHttpError(500, 'boom'),
    );
    const { POST } = await import('@/app/api/agent-bridge/delegate/route');
    const res = await POST(mReq({ department: 'engineering', task: 't' }));
    expect(res.status).toBe(502);
  });

  it('502 when bridge auth fails', async () => {
    (callDelegate as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new BridgeAuthError(),
    );
    const { POST } = await import('@/app/api/agent-bridge/delegate/route');
    const res = await POST(mReq({ department: 'engineering', task: 't' }));
    expect(res.status).toBe(502);
  });

  it('503 when bridge env is missing', async () => {
    (callDelegate as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new BridgeConfigError('no url'),
    );
    const { POST } = await import('@/app/api/agent-bridge/delegate/route');
    const res = await POST(mReq({ department: 'engineering', task: 't' }));
    expect(res.status).toBe(503);
  });
});

describe('POST /api/agent-bridge/advance-stage', () => {
  it('400 for invalid stage', async () => {
    const { POST } = await import('@/app/api/agent-bridge/advance-stage/route');
    const res = await POST(mReq({ newStage: 'launching' }));
    expect(res.status).toBe(400);
  });

  it('200 happy path', async () => {
    (callAdvanceStage as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'completed',
      output: 'ok',
      stage: 'building',
    });
    const { POST } = await import('@/app/api/agent-bridge/advance-stage/route');
    const res = await POST(mReq({ newStage: 'building', reason: 'founder override' }));
    expect(res.status).toBe(200);
    expect(callAdvanceStage).toHaveBeenCalledWith({
      spaceId: 'sp_1',
      newStage: 'building',
      reason: 'founder override',
    });
  });
});

describe('POST /api/agent-bridge/get-mission', () => {
  it('401 when unauthed', async () => {
    (requireAuth as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const { POST } = await import('@/app/api/agent-bridge/get-mission/route');
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it('200 returns mission + core', async () => {
    (callGetMission as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      mission: { title: 'X' },
      core: { tagline: 'ship' },
    });
    const { POST } = await import('@/app/api/agent-bridge/get-mission/route');
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mission).toEqual({ title: 'X' });
    expect(callGetMission).toHaveBeenCalledWith('sp_1');
  });
});

describe('POST /api/agent-bridge/update-core-memory', () => {
  it('400 when slot missing', async () => {
    const { POST } = await import('@/app/api/agent-bridge/update-core-memory/route');
    const res = await POST(mReq({ value: 'x' }));
    expect(res.status).toBe(400);
  });

  it('200 happy path', async () => {
    (callUpdateCoreMemory as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      slot: 'tagline',
      value: 'Ship',
    });
    const { POST } = await import('@/app/api/agent-bridge/update-core-memory/route');
    const res = await POST(mReq({ slot: 'tagline', value: 'Ship' }));
    expect(res.status).toBe(200);
    expect(callUpdateCoreMemory).toHaveBeenCalledWith({
      spaceId: 'sp_1',
      slot: 'tagline',
      value: 'Ship',
    });
  });
});
