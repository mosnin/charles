/**
 * Route-level test for `PATCH /api/stages/gates/[gateId]`.
 *
 * The bar:
 *   - Auth required (401 without).
 *   - Bad body → 400.
 *   - Unknown gate → 404.
 *   - Gate exists but the caller does not own its space → 403.
 *   - Happy path: gate is updated with isComplete and completedAt; 200 returned.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/space', () => ({
  getSpaceForUser: vi.fn(),
}));

// Per-table queue + update spy.
const { tableQueue, updateSpy } = vi.hoisted(() => ({
  tableQueue: { StageGate: [] as Array<{ data?: unknown; error?: unknown }> },
  updateSpy: vi.fn(),
}));

vi.mock('@/lib/supabase', () => {
  function chain(table: string) {
    const obj: Record<string, unknown> = {};
    const terminal = tableQueue[table as keyof typeof tableQueue]?.shift() ?? { data: null, error: null };
    for (const m of ['select', 'eq', 'in', 'order', 'limit']) {
      obj[m] = vi.fn(() => obj);
    }
    obj.maybeSingle = vi.fn(() => Promise.resolve(terminal));
    obj.single = vi.fn(() => Promise.resolve(terminal));
    obj.update = vi.fn((payload: Record<string, unknown>) => {
      updateSpy(payload);
      const upd: Record<string, unknown> = {};
      upd.eq = vi.fn(() => upd);
      upd.select = vi.fn(() => upd);
      upd.single = vi.fn(() =>
        Promise.resolve({
          data: {
            id: 'gate_1',
            isComplete: payload.isComplete,
            completedAt: payload.completedAt,
          },
          error: null,
        }),
      );
      return upd;
    });
    return obj;
  }
  return { supabase: { from: vi.fn((table: string) => chain(table)) } };
});

import { PATCH } from '@/app/api/stages/gates/[gateId]/route';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';

const mockAuth = vi.mocked(requireAuth);
const mockGetSpace = vi.mocked(getSpaceForUser);

const SPACE = {
  id: 'space_1',
  slug: 'jane',
  name: 'Jane Co',
  emoji: null,
  ownerId: 'user_db_1',
  brokerageId: null,
  createdAt: '2026-04-01T00:00:00.000Z',
} as unknown as NonNullable<Awaited<ReturnType<typeof getSpaceForUser>>>;

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/stages/gates/gate_1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ gateId: id }) });

beforeEach(() => {
  vi.clearAllMocks();
  tableQueue.StageGate.length = 0;
  mockAuth.mockResolvedValue({ userId: 'user_clerk_1' });
  mockGetSpace.mockResolvedValue(SPACE);
});

describe('PATCH /api/stages/gates/[gateId]', () => {
  it('401 when unauthenticated', async () => {
    const unauth = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    mockAuth.mockResolvedValue(unauth);

    const res = await PATCH(
      makeReq({ isComplete: true }) as unknown as Parameters<typeof PATCH>[0],
      params('gate_1'),
    );
    expect(res.status).toBe(401);
  });

  it('400 when isComplete is missing or wrong type', async () => {
    const res = await PATCH(
      makeReq({ foo: 'bar' }) as unknown as Parameters<typeof PATCH>[0],
      params('gate_1'),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/isComplete/);
  });

  it('400 when JSON body is malformed', async () => {
    const req = new Request('http://localhost/api/stages/gates/gate_1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{not-json',
    });
    const res = await PATCH(
      req as unknown as Parameters<typeof PATCH>[0],
      params('gate_1'),
    );
    expect(res.status).toBe(400);
  });

  it('404 when the gate does not exist', async () => {
    tableQueue.StageGate.push({ data: null, error: null });
    const res = await PATCH(
      makeReq({ isComplete: true }) as unknown as Parameters<typeof PATCH>[0],
      params('gate_unknown'),
    );
    expect(res.status).toBe(404);
  });

  it('403 when the gate belongs to a space the caller does not own', async () => {
    tableQueue.StageGate.push({
      data: { id: 'gate_1', spaceId: 'space_other', isComplete: false },
      error: null,
    });
    const res = await PATCH(
      makeReq({ isComplete: true }) as unknown as Parameters<typeof PATCH>[0],
      params('gate_1'),
    );
    expect(res.status).toBe(403);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('403 when the caller has no space at all', async () => {
    mockGetSpace.mockResolvedValue(null);
    tableQueue.StageGate.push({
      data: { id: 'gate_1', spaceId: 'space_1', isComplete: false },
      error: null,
    });
    const res = await PATCH(
      makeReq({ isComplete: true }) as unknown as Parameters<typeof PATCH>[0],
      params('gate_1'),
    );
    expect(res.status).toBe(403);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('200 happy path → toggles complete and records completedAt', async () => {
    tableQueue.StageGate.push({
      data: { id: 'gate_1', spaceId: SPACE.id, isComplete: false },
      error: null,
    });
    const res = await PATCH(
      makeReq({ isComplete: true }) as unknown as Parameters<typeof PATCH>[0],
      params('gate_1'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('gate_1');
    expect(body.isComplete).toBe(true);
    expect(body.completedAt).toBeTruthy();

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const payload = updateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.isComplete).toBe(true);
    expect(typeof payload.completedAt).toBe('string');
  });

  it('200 happy path → un-complete clears completedAt', async () => {
    tableQueue.StageGate.push({
      data: { id: 'gate_1', spaceId: SPACE.id, isComplete: true },
      error: null,
    });
    const res = await PATCH(
      makeReq({ isComplete: false }) as unknown as Parameters<typeof PATCH>[0],
      params('gate_1'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isComplete).toBe(false);
    expect(body.completedAt).toBeNull();

    const payload = updateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.isComplete).toBe(false);
    expect(payload.completedAt).toBeNull();
  });
});
