/**
 * Route-level test for `POST /api/stages/advance`.
 *
 * The bar:
 *   - 401 unauth.
 *   - 403 when the caller has no space or no mission row.
 *   - 400 when already at the terminal stage ('scaling').
 *   - 409 with the incomplete-gate titles when override is false and gates
 *     remain open.
 *   - 200 happy path (gates clean): WorkspaceStage insert, Mission.stage
 *     updated to the next stage.
 *   - 200 override path: gates are NOT checked; advance proceeds regardless.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/space', () => ({
  getSpaceForUser: vi.fn(),
}));

// Supabase mock: per-table queue of terminals. Every chain awaits to whatever
// terminal was queued for that table; `update` and `insert` are spied on.
type Terminal = { data?: unknown; error?: unknown };
const { tableQueue, calls } = vi.hoisted(() => ({
  tableQueue: {} as Record<string, Terminal[]>,
  calls: {
    workspaceUpdate: [] as Array<Record<string, unknown>>,
    workspaceInsert: [] as Array<Record<string, unknown>>,
    missionUpdate: [] as Array<Record<string, unknown>>,
    rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  },
}));

vi.mock('@/lib/supabase', () => {
  function chain(table: string) {
    const terminal: Terminal = tableQueue[table]?.shift() ?? { data: null, error: null };
    const obj: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit', 'not']) {
      obj[m] = vi.fn(() => obj);
    }
    obj.maybeSingle = vi.fn(() => Promise.resolve(terminal));
    obj.single = vi.fn(() => Promise.resolve(terminal));
    // Make the chain awaitable so a bare `await supabase.from(...).eq(...)`
    // resolves to the queued terminal.
    (obj as { then: unknown }).then = (resolve: (v: Terminal) => unknown) =>
      Promise.resolve(terminal).then(resolve);

    obj.update = vi.fn((payload: Record<string, unknown>) => {
      if (table === 'WorkspaceStage') calls.workspaceUpdate.push(payload);
      if (table === 'Mission') calls.missionUpdate.push(payload);
      const upd: Record<string, unknown> = {};
      for (const m of ['eq', 'is', 'select', 'in']) {
        upd[m] = vi.fn(() => upd);
      }
      upd.single = vi.fn(() => Promise.resolve({ data: null, error: null }));
      (upd as { then: unknown }).then = (resolve: (v: Terminal) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve);
      return upd;
    });
    obj.insert = vi.fn((payload: Record<string, unknown>) => {
      if (table === 'WorkspaceStage') calls.workspaceInsert.push(payload);
      return Promise.resolve({ data: null, error: null });
    });
    return obj;
  }
  return {
    supabase: {
      from: vi.fn((table: string) => chain(table)),
      rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
        calls.rpc.push({ fn, args });
        return Promise.resolve({ data: null, error: null });
      }),
    },
  };
});

import { POST } from '@/app/api/stages/advance/route';
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

function makeReq(body: unknown = {}): Request {
  return new Request('http://localhost/api/stages/advance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tableQueue)) delete tableQueue[k];
  calls.workspaceUpdate.length = 0;
  calls.workspaceInsert.length = 0;
  calls.missionUpdate.length = 0;
  calls.rpc.length = 0;
  mockAuth.mockResolvedValue({ userId: 'user_clerk_1' });
  mockGetSpace.mockResolvedValue(SPACE);
});

describe('POST /api/stages/advance', () => {
  it('401 when unauthenticated', async () => {
    const unauth = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    mockAuth.mockResolvedValue(unauth);
    const res = await POST(makeReq() as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(401);
  });

  it('403 when caller has no space', async () => {
    mockGetSpace.mockResolvedValue(null);
    const res = await POST(makeReq() as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(403);
  });

  it('403 when caller has no mission row', async () => {
    tableQueue.Mission = [{ data: null, error: null }];
    const res = await POST(makeReq() as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(403);
  });

  it('400 when already at the final stage (scaling)', async () => {
    tableQueue.Mission = [{ data: { id: 'm_1', stage: 'scaling' }, error: null }];
    const res = await POST(makeReq() as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/final stage/i);
  });

  it('409 when override is false and gates are incomplete', async () => {
    tableQueue.Mission = [{ data: { id: 'm_1', stage: 'idea' }, error: null }];
    tableQueue.StageGate = [
      {
        data: [
          { id: 'g_a', title: 'Define your company in one sentence' },
          { id: 'g_b', title: 'Identify your target customer' },
        ],
        error: null,
      },
    ];
    const res = await POST(makeReq({ override: false }) as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/incomplete/i);
    expect(body.gates).toEqual([
      'Define your company in one sentence',
      'Identify your target customer',
    ]);
    // Must not advance.
    expect(calls.workspaceInsert.length).toBe(0);
    expect(calls.missionUpdate.length).toBe(0);
  });

  it('200 happy path: gates clean → inserts WorkspaceStage, updates Mission.stage', async () => {
    tableQueue.Mission = [{ data: { id: 'm_1', stage: 'idea' }, error: null }];
    tableQueue.StageGate = [{ data: [], error: null }];

    const res = await POST(makeReq({ override: false }) as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stage).toBe('initial');
    expect(body.advancedAt).toBeTruthy();

    expect(calls.workspaceInsert.length).toBe(1);
    expect(calls.workspaceInsert[0]).toMatchObject({
      spaceId: SPACE.id,
      stage: 'initial',
    });
    expect(calls.missionUpdate.length).toBe(1);
    expect(calls.missionUpdate[0].stage).toBe('initial');

    // Closed the previous open workspace row as 'gate' exit (not override).
    expect(calls.workspaceUpdate.length).toBe(1);
    expect(calls.workspaceUpdate[0].exitedBy).toBe('gate');

    // Seeded the new stage's gates via the SQL function.
    expect(calls.rpc.length).toBe(1);
    expect(calls.rpc[0]).toEqual({
      fn: 'seed_stage_gates',
      args: { p_space_id: SPACE.id, p_stage: 'initial' },
    });
  });

  it('200 override path: skips gate check; advances and marks founder exit', async () => {
    tableQueue.Mission = [{ data: { id: 'm_1', stage: 'building' }, error: null }];
    // No StageGate queue entry needed — the route doesn't read gates on override.

    const res = await POST(makeReq({ override: true }) as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stage).toBe('selling');

    expect(calls.workspaceInsert.length).toBe(1);
    expect(calls.workspaceInsert[0].stage).toBe('selling');
    expect(calls.missionUpdate.length).toBe(1);
    expect(calls.missionUpdate[0].stage).toBe('selling');
    expect(calls.workspaceUpdate[0].exitedBy).toBe('founder');
  });
});
