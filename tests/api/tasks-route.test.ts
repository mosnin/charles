/**
 * Route-level tests for /api/tasks (GET, POST) and /api/tasks/[id]
 * (PATCH, DELETE).
 *
 * The bar:
 *   - Auth + ownership: 401 unauth, 403 no workspace / wrong workspace.
 *   - 400 on bad bodies (title empty / too long, bad dept, bad status, etc).
 *   - POST happy paths: founder-assigned, agent-assigned, unassigned.
 *   - PATCH status flip: → 'done' stamps completedAt, → anything else clears it.
 *   - DELETE: 204 on happy path, 404 when missing, 403 when wrong space.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/space', () => ({ getSpaceForUser: vi.fn() }));

type Terminal = { data?: unknown; error?: unknown };
const { tableQueue, calls } = vi.hoisted(() => ({
  tableQueue: { Task: [] as Terminal[] },
  calls: {
    insert: [] as Array<{ payload: Record<string, unknown> }>,
    update: [] as Array<{ payload: Record<string, unknown> }>,
    delete: [] as Array<{ id?: string }>,
  },
}));

function nextTerminal(): Terminal {
  return tableQueue.Task.shift() ?? { data: null, error: null };
}

vi.mock('@/lib/supabase', () => {
  function chain() {
    const obj: Record<string, unknown> = {};

    // Read paths consume from the queue lazily; the .eq() chain may be
    // followed by either .maybeSingle()/.single() or just awaited.
    for (const m of ['select', 'order', 'limit', 'in']) {
      obj[m] = vi.fn(() => obj);
    }
    obj.eq = vi.fn(() => {
      const next: Record<string, unknown> = { ...obj };
      // Allow `await query` to resolve to the terminal.
      (next as { then: unknown }).then = (resolve: (v: Terminal) => unknown) =>
        Promise.resolve(nextTerminal()).then(resolve);
      return next;
    });
    obj.maybeSingle = vi.fn(() => Promise.resolve(nextTerminal()));
    obj.single = vi.fn(() => Promise.resolve(nextTerminal()));

    obj.insert = vi.fn((payload: Record<string, unknown>) => {
      calls.insert.push({ payload });
      const ins: Record<string, unknown> = {};
      ins.select = vi.fn(() => ins);
      ins.single = vi.fn(() => {
        const terminal = nextTerminal();
        // Default insert result: echo the payload back with an id + timestamps.
        if (terminal.data || terminal.error) return Promise.resolve(terminal);
        return Promise.resolve({
          data: {
            id: 'task_new',
            spaceId: payload.spaceId,
            title: payload.title,
            description: payload.description ?? '',
            status: 'open',
            priority: payload.priority ?? 'normal',
            assigneeKind: payload.assigneeKind ?? 'founder',
            assigneeDept: payload.assigneeDept ?? null,
            createdBy: payload.createdBy ?? 'founder',
            createdByDept: payload.createdByDept ?? null,
            dueAt: payload.dueAt ?? null,
            completedAt: null,
            createdAt: '2026-05-13T00:00:00.000Z',
            updatedAt: '2026-05-13T00:00:00.000Z',
          },
          error: null,
        });
      });
      return ins;
    });

    obj.update = vi.fn((payload: Record<string, unknown>) => {
      calls.update.push({ payload });
      const upd: Record<string, unknown> = {};
      upd.eq = vi.fn(() => upd);
      upd.select = vi.fn(() => upd);
      upd.single = vi.fn(() =>
        Promise.resolve({
          data: {
            id: 'task_1',
            spaceId: 'space_1',
            title: payload.title ?? 'Task',
            description: payload.description ?? '',
            status: payload.status ?? 'open',
            priority: payload.priority ?? 'normal',
            assigneeKind: payload.assigneeKind ?? 'founder',
            assigneeDept: payload.assigneeDept ?? null,
            createdBy: 'founder',
            createdByDept: null,
            dueAt: payload.dueAt ?? null,
            completedAt: payload.completedAt ?? null,
            createdAt: '2026-05-01T00:00:00.000Z',
            updatedAt: payload.updatedAt ?? '2026-05-13T00:00:00.000Z',
          },
          error: null,
        }),
      );
      return upd;
    });

    obj.delete = vi.fn(() => {
      const del: Record<string, unknown> = {};
      del.eq = vi.fn((_col: string, val: string) => {
        calls.delete.push({ id: val });
        return Promise.resolve({ error: null });
      });
      return del;
    });

    return obj;
  }
  return { supabase: { from: vi.fn(() => chain()) } };
});

import { GET, POST } from '@/app/api/tasks/route';
import { PATCH, DELETE } from '@/app/api/tasks/[id]/route';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';

const mockAuth = vi.mocked(requireAuth);
const mockGetSpace = vi.mocked(getSpaceForUser);

const SPACE = {
  id: 'space_1',
  slug: 'jane',
  name: 'Jane',
  emoji: null,
  ownerId: 'user_db_1',
  brokerageId: null,
  createdAt: '2026-04-01T00:00:00.000Z',
} as unknown as NonNullable<Awaited<ReturnType<typeof getSpaceForUser>>>;

function listReq(query: string = ''): NextRequest {
  return new NextRequest(`http://localhost/api/tasks${query}`);
}
function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
function patchReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/tasks/task_1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
function deleteReq(): NextRequest {
  return new NextRequest('http://localhost/api/tasks/task_1', {
    method: 'DELETE',
  });
}
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  tableQueue.Task.length = 0;
  calls.insert.length = 0;
  calls.update.length = 0;
  calls.delete.length = 0;
  mockAuth.mockResolvedValue({ userId: 'user_clerk_1' });
  mockGetSpace.mockResolvedValue(SPACE);
});

// ── GET ────────────────────────────────────────────────────────────────────────

describe('GET /api/tasks', () => {
  it('401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await GET(listReq());
    expect(res.status).toBe(401);
    expect(mockGetSpace).not.toHaveBeenCalled();
  });

  it('403 when caller has no workspace', async () => {
    mockGetSpace.mockResolvedValue(null);
    const res = await GET(listReq());
    expect(res.status).toBe(403);
  });

  it('200 returns sorted tasks (open before done; high before normal)', async () => {
    tableQueue.Task.push({
      data: [
        {
          id: 't_done',
          spaceId: 'space_1',
          title: 'Old done',
          description: '',
          status: 'done',
          priority: 'high',
          assigneeKind: 'founder',
          assigneeDept: null,
          createdBy: 'founder',
          createdByDept: null,
          dueAt: null,
          completedAt: '2026-05-10T00:00:00.000Z',
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-10T00:00:00.000Z',
        },
        {
          id: 't_low',
          spaceId: 'space_1',
          title: 'Open low',
          description: '',
          status: 'open',
          priority: 'low',
          assigneeKind: 'founder',
          assigneeDept: null,
          createdBy: 'founder',
          createdByDept: null,
          dueAt: null,
          completedAt: null,
          createdAt: '2026-05-12T00:00:00.000Z',
          updatedAt: '2026-05-12T00:00:00.000Z',
        },
        {
          id: 't_high',
          spaceId: 'space_1',
          title: 'Open high',
          description: '',
          status: 'open',
          priority: 'high',
          assigneeKind: 'founder',
          assigneeDept: null,
          createdBy: 'founder',
          createdByDept: null,
          dueAt: null,
          completedAt: null,
          createdAt: '2026-05-11T00:00:00.000Z',
          updatedAt: '2026-05-11T00:00:00.000Z',
        },
      ],
      error: null,
    });
    const res = await GET(listReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tasks: Array<{ id: string }> };
    expect(body.tasks.map((t) => t.id)).toEqual(['t_high', 't_low', 't_done']);
  });

  it('200 with empty array when DB has none', async () => {
    tableQueue.Task.push({ data: [], error: null });
    const res = await GET(listReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tasks: unknown[] };
    expect(body.tasks).toEqual([]);
  });

  it('400 on invalid status filter', async () => {
    const res = await GET(listReq('?status=archived'));
    expect(res.status).toBe(400);
  });

  it('400 on invalid assignee filter', async () => {
    const res = await GET(listReq('?assignee=finance'));
    expect(res.status).toBe(400);
  });

  it('500 on DB error', async () => {
    tableQueue.Task.push({ data: null, error: { message: 'boom' } });
    const res = await GET(listReq());
    expect(res.status).toBe(500);
  });
});

// ── POST ───────────────────────────────────────────────────────────────────────

describe('POST /api/tasks', () => {
  it('401 unauth', async () => {
    mockAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await POST(postReq({ title: 'x' }));
    expect(res.status).toBe(401);
  });

  it('403 when caller has no space', async () => {
    mockGetSpace.mockResolvedValue(null);
    const res = await POST(postReq({ title: 'x' }));
    expect(res.status).toBe(403);
  });

  it('400 on malformed JSON', async () => {
    const res = await POST(postReq('{not-json'));
    expect(res.status).toBe(400);
  });

  it('400 when title missing', async () => {
    const res = await POST(postReq({}));
    expect(res.status).toBe(400);
  });

  it('400 when title is whitespace only', async () => {
    const res = await POST(postReq({ title: '   ' }));
    expect(res.status).toBe(400);
  });

  it('400 when title exceeds 200 chars', async () => {
    const res = await POST(postReq({ title: 'a'.repeat(201) }));
    expect(res.status).toBe(400);
  });

  it('400 when description exceeds 2000 chars', async () => {
    const res = await POST(postReq({ title: 'ok', description: 'b'.repeat(2001) }));
    expect(res.status).toBe(400);
  });

  it('400 when priority invalid', async () => {
    const res = await POST(postReq({ title: 'ok', priority: 'urgent' }));
    expect(res.status).toBe(400);
  });

  it('400 when assigneeKind=agent without a valid dept', async () => {
    const res = await POST(postReq({ title: 'ok', assigneeKind: 'agent' }));
    expect(res.status).toBe(400);
  });

  it('400 when assigneeDept is not a valid slug', async () => {
    const res = await POST(
      postReq({ title: 'ok', assigneeKind: 'agent', assigneeDept: 'finance' }),
    );
    expect(res.status).toBe(400);
  });

  it('200 happy path: founder-assigned', async () => {
    const res = await POST(postReq({ title: 'Ship the landing page' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string; assigneeKind: string; createdBy: string };
    expect(body.title).toBe('Ship the landing page');
    expect(body.assigneeKind).toBe('founder');
    expect(body.createdBy).toBe('founder');
    expect(calls.insert).toHaveLength(1);
    expect((calls.insert[0].payload as { spaceId: string }).spaceId).toBe('space_1');
  });

  it('200 happy path: agent-assigned with valid dept', async () => {
    const res = await POST(
      postReq({
        title: 'Spin up the email sequence',
        assigneeKind: 'agent',
        assigneeDept: 'marketing',
        priority: 'high',
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      assigneeKind: string;
      assigneeDept: string | null;
      priority: string;
    };
    expect(body.assigneeKind).toBe('agent');
    expect(body.assigneeDept).toBe('marketing');
    expect(body.priority).toBe('high');
  });

  it('200 happy path: unassigned', async () => {
    const res = await POST(postReq({ title: 'Park this for later', assigneeKind: 'unassigned' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { assigneeKind: string; assigneeDept: string | null };
    expect(body.assigneeKind).toBe('unassigned');
    expect(body.assigneeDept).toBeNull();
  });

  it('trims the title before insert', async () => {
    await POST(postReq({ title: '  Refactor billing  ' }));
    const payload = calls.insert[0].payload as { title: string };
    expect(payload.title).toBe('Refactor billing');
  });
});

// ── PATCH ──────────────────────────────────────────────────────────────────────

describe('PATCH /api/tasks/[id]', () => {
  function queueOwnedTask(status: string = 'open') {
    tableQueue.Task.push({
      data: { id: 'task_1', spaceId: 'space_1', status },
      error: null,
    });
  }

  it('401 unauth', async () => {
    mockAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await PATCH(patchReq({ status: 'done' }), idParams('task_1'));
    expect(res.status).toBe(401);
  });

  it('404 when task does not exist', async () => {
    tableQueue.Task.push({ data: null, error: null });
    const res = await PATCH(patchReq({ status: 'done' }), idParams('task_1'));
    expect(res.status).toBe(404);
  });

  it('403 when task belongs to a different space', async () => {
    tableQueue.Task.push({
      data: { id: 'task_1', spaceId: 'space_OTHER', status: 'open' },
      error: null,
    });
    const res = await PATCH(patchReq({ status: 'done' }), idParams('task_1'));
    expect(res.status).toBe(403);
  });

  it('400 on malformed JSON', async () => {
    const res = await PATCH(patchReq('{not-json'), idParams('task_1'));
    expect(res.status).toBe(400);
  });

  it('400 on invalid status', async () => {
    queueOwnedTask();
    const res = await PATCH(patchReq({ status: 'archived' }), idParams('task_1'));
    expect(res.status).toBe(400);
  });

  it('flip → done stamps completedAt', async () => {
    queueOwnedTask('open');
    const res = await PATCH(patchReq({ status: 'done' }), idParams('task_1'));
    expect(res.status).toBe(200);
    const payload = calls.update[0].payload as { status: string; completedAt?: string | null };
    expect(payload.status).toBe('done');
    expect(payload.completedAt).toBeTruthy();
  });

  it('flip away from done clears completedAt', async () => {
    queueOwnedTask('done');
    const res = await PATCH(patchReq({ status: 'open' }), idParams('task_1'));
    expect(res.status).toBe(200);
    const payload = calls.update[0].payload as { status: string; completedAt?: string | null };
    expect(payload.status).toBe('open');
    expect(payload.completedAt).toBeNull();
  });

  it('updating only title does not touch completedAt', async () => {
    queueOwnedTask('open');
    const res = await PATCH(patchReq({ title: 'New title' }), idParams('task_1'));
    expect(res.status).toBe(200);
    const payload = calls.update[0].payload as Record<string, unknown>;
    expect(payload.title).toBe('New title');
    expect('completedAt' in payload).toBe(false);
  });

  it('400 when title trims to empty', async () => {
    queueOwnedTask();
    const res = await PATCH(patchReq({ title: '   ' }), idParams('task_1'));
    expect(res.status).toBe(400);
  });

  it('400 when assigneeKind=agent without a dept', async () => {
    queueOwnedTask();
    const res = await PATCH(patchReq({ assigneeKind: 'agent' }), idParams('task_1'));
    expect(res.status).toBe(400);
  });

  it('assigneeKind=founder clears assigneeDept', async () => {
    queueOwnedTask();
    await PATCH(patchReq({ assigneeKind: 'founder' }), idParams('task_1'));
    const payload = calls.update[0].payload as { assigneeKind: string; assigneeDept: unknown };
    expect(payload.assigneeKind).toBe('founder');
    expect(payload.assigneeDept).toBeNull();
  });
});

// ── DELETE ─────────────────────────────────────────────────────────────────────

describe('DELETE /api/tasks/[id]', () => {
  it('401 unauth', async () => {
    mockAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await DELETE(deleteReq(), idParams('task_1'));
    expect(res.status).toBe(401);
  });

  it('404 when not found', async () => {
    tableQueue.Task.push({ data: null, error: null });
    const res = await DELETE(deleteReq(), idParams('task_1'));
    expect(res.status).toBe(404);
  });

  it('403 when wrong space', async () => {
    tableQueue.Task.push({
      data: { id: 'task_1', spaceId: 'space_OTHER', status: 'open' },
      error: null,
    });
    const res = await DELETE(deleteReq(), idParams('task_1'));
    expect(res.status).toBe(403);
  });

  it('204 on happy path', async () => {
    tableQueue.Task.push({
      data: { id: 'task_1', spaceId: 'space_1', status: 'open' },
      error: null,
    });
    const res = await DELETE(deleteReq(), idParams('task_1'));
    expect(res.status).toBe(204);
    expect(calls.delete).toHaveLength(1);
    expect(calls.delete[0].id).toBe('task_1');
  });
});
