/**
 * Route-level tests for /api/task-conversations (GET, POST).
 *
 * The bar:
 *   - 401 unauth, 403 no workspace.
 *   - 400 when both taskId and gateId given, or neither.
 *   - 404 when the targeted task/gate is missing.
 *   - 403 when the task/gate belongs to a different space.
 *   - GET returns { conversation: null, messages: [] } when no row exists.
 *   - GET returns the conversation + its messages when present.
 *   - POST creates a conversation when missing; returns the existing row
 *     when present (idempotent).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/space', () => ({ getSpaceForUser: vi.fn() }));

type Terminal = { data?: unknown; error?: unknown };
const { tableQueue, calls } = vi.hoisted(() => ({
  tableQueue: {
    Task: [] as Terminal[],
    StageGate: [] as Terminal[],
    TaskConversation: [] as Terminal[],
    TaskMessage: [] as Terminal[],
  },
  calls: {
    insert: [] as Array<{ table: string; payload: Record<string, unknown> }>,
  },
}));

function shiftTerminal(table: keyof typeof tableQueue): Terminal {
  return tableQueue[table].shift() ?? { data: null, error: null };
}

vi.mock('@/lib/supabase', () => {
  function chain(table: keyof typeof tableQueue) {
    const obj: Record<string, unknown> = {};

    for (const m of ['select', 'limit', 'in']) {
      obj[m] = vi.fn(() => obj);
    }
    // .order and .eq both produce a thenable so the awaited query resolves
    // to the queued terminal regardless of which chain method is last.
    function thenable(): Record<string, unknown> {
      const next: Record<string, unknown> = { ...obj };
      next.then = (resolve: (v: Terminal) => unknown) =>
        Promise.resolve(shiftTerminal(table)).then(resolve);
      return next;
    }
    obj.eq = vi.fn(() => thenable());
    obj.order = vi.fn(() => thenable());
    obj.maybeSingle = vi.fn(() => Promise.resolve(shiftTerminal(table)));
    obj.single = vi.fn(() => Promise.resolve(shiftTerminal(table)));

    obj.insert = vi.fn((payload: Record<string, unknown>) => {
      calls.insert.push({ table, payload });
      const ins: Record<string, unknown> = {};
      ins.select = vi.fn(() => ins);
      ins.single = vi.fn(() => {
        const terminal = shiftTerminal(table);
        if (terminal.data || terminal.error) return Promise.resolve(terminal);
        return Promise.resolve({
          data: {
            id: `${table}_new`,
            spaceId: payload.spaceId,
            taskId: payload.taskId ?? null,
            gateId: payload.gateId ?? null,
            subject: payload.subject ?? '',
            createdAt: '2026-05-13T00:00:00.000Z',
            updatedAt: '2026-05-13T00:00:00.000Z',
          },
          error: null,
        });
      });
      return ins;
    });

    obj.update = vi.fn(() => {
      const upd: Record<string, unknown> = {};
      upd.eq = vi.fn(() => Promise.resolve({ data: null, error: null }));
      return upd;
    });

    return obj;
  }
  return {
    supabase: { from: vi.fn((table: string) => chain(table as keyof typeof tableQueue)) },
  };
});

import { GET, POST } from '@/app/api/task-conversations/route';
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

function getReq(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/task-conversations${query}`);
}
function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/task-conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  tableQueue.Task.length = 0;
  tableQueue.StageGate.length = 0;
  tableQueue.TaskConversation.length = 0;
  tableQueue.TaskMessage.length = 0;
  calls.insert.length = 0;
  mockAuth.mockResolvedValue({ userId: 'user_clerk_1' });
  mockGetSpace.mockResolvedValue(SPACE);
});

// ── GET ────────────────────────────────────────────────────────────────────

describe('GET /api/task-conversations', () => {
  it('401 unauth', async () => {
    mockAuth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await GET(getReq('?taskId=task_1'));
    expect(res.status).toBe(401);
  });

  it('403 when caller has no space', async () => {
    mockGetSpace.mockResolvedValue(null);
    const res = await GET(getReq('?taskId=task_1'));
    expect(res.status).toBe(403);
  });

  it('400 when neither taskId nor gateId is given', async () => {
    const res = await GET(getReq(''));
    expect(res.status).toBe(400);
  });

  it('400 when both taskId and gateId are given', async () => {
    const res = await GET(getReq('?taskId=task_1&gateId=gate_1'));
    expect(res.status).toBe(400);
  });

  it('404 when the task does not exist', async () => {
    tableQueue.Task.push({ data: null, error: null });
    const res = await GET(getReq('?taskId=missing'));
    expect(res.status).toBe(404);
  });

  it('403 when the task belongs to a different space', async () => {
    tableQueue.Task.push({ data: { id: 'task_1', spaceId: 'space_OTHER' }, error: null });
    const res = await GET(getReq('?taskId=task_1'));
    expect(res.status).toBe(403);
  });

  it('200 returns { conversation: null, messages: [] } when no row exists', async () => {
    tableQueue.Task.push({ data: { id: 'task_1', spaceId: 'space_1' }, error: null });
    tableQueue.TaskConversation.push({ data: null, error: null });
    const res = await GET(getReq('?taskId=task_1'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conversation: unknown; messages: unknown[] };
    expect(body.conversation).toBeNull();
    expect(body.messages).toEqual([]);
  });

  it('200 returns conversation + ordered messages when present', async () => {
    tableQueue.Task.push({ data: { id: 'task_1', spaceId: 'space_1' }, error: null });
    tableQueue.TaskConversation.push({
      data: {
        id: 'conv_1',
        spaceId: 'space_1',
        taskId: 'task_1',
        gateId: null,
        subject: 'Landing Page Updates',
        createdAt: '2026-05-12T00:00:00.000Z',
        updatedAt: '2026-05-12T00:00:00.000Z',
      },
      error: null,
    });
    tableQueue.TaskMessage.push({
      data: [
        {
          id: 'm1',
          conversationId: 'conv_1',
          role: 'user',
          content: 'Hi',
          metadata: null,
          createdAt: '2026-05-12T00:00:00.000Z',
        },
      ],
      error: null,
    });
    const res = await GET(getReq('?taskId=task_1'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      conversation: { id: string };
      messages: Array<{ id: string }>;
    };
    expect(body.conversation.id).toBe('conv_1');
    expect(body.messages).toHaveLength(1);
  });

  it('works for gateId as well', async () => {
    tableQueue.StageGate.push({ data: { id: 'gate_1', spaceId: 'space_1' }, error: null });
    tableQueue.TaskConversation.push({ data: null, error: null });
    const res = await GET(getReq('?gateId=gate_1'));
    expect(res.status).toBe(200);
  });
});

// ── POST ───────────────────────────────────────────────────────────────────

describe('POST /api/task-conversations', () => {
  it('401 unauth', async () => {
    mockAuth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await POST(postReq({ taskId: 'task_1', subject: 'x' }));
    expect(res.status).toBe(401);
  });

  it('403 when caller has no space', async () => {
    mockGetSpace.mockResolvedValue(null);
    const res = await POST(postReq({ taskId: 'task_1', subject: 'x' }));
    expect(res.status).toBe(403);
  });

  it('400 on malformed JSON', async () => {
    const res = await POST(postReq('{not-json'));
    expect(res.status).toBe(400);
  });

  it('400 when neither taskId nor gateId is given', async () => {
    const res = await POST(postReq({ subject: 'x' }));
    expect(res.status).toBe(400);
  });

  it('400 when both taskId and gateId are given', async () => {
    const res = await POST(postReq({ taskId: 't1', gateId: 'g1', subject: 'x' }));
    expect(res.status).toBe(400);
  });

  it('400 when subject is missing', async () => {
    const res = await POST(postReq({ taskId: 'task_1' }));
    expect(res.status).toBe(400);
  });

  it('400 when subject is empty after trim', async () => {
    const res = await POST(postReq({ taskId: 'task_1', subject: '   ' }));
    expect(res.status).toBe(400);
  });

  it('200 happy path: creates a new conversation for a task', async () => {
    tableQueue.Task.push({ data: { id: 'task_1', spaceId: 'space_1' }, error: null });
    tableQueue.TaskConversation.push({ data: null, error: null }); // existing lookup
    // insert returns the default mocked row
    const res = await POST(postReq({ taskId: 'task_1', subject: 'Landing Page Updates' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conversation: { taskId: string; subject: string } };
    expect(body.conversation.taskId).toBe('task_1');
    expect(body.conversation.subject).toBe('Landing Page Updates');
    expect(calls.insert).toHaveLength(1);
    expect(calls.insert[0].table).toBe('TaskConversation');
  });

  it('200 idempotent: returns the existing row when one already lives', async () => {
    tableQueue.Task.push({ data: { id: 'task_1', spaceId: 'space_1' }, error: null });
    tableQueue.TaskConversation.push({
      data: {
        id: 'conv_existing',
        spaceId: 'space_1',
        taskId: 'task_1',
        gateId: null,
        subject: 'Landing Page Updates',
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
      },
      error: null,
    });
    const res = await POST(postReq({ taskId: 'task_1', subject: 'Landing Page Updates' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conversation: { id: string } };
    expect(body.conversation.id).toBe('conv_existing');
    expect(calls.insert).toHaveLength(0); // no new insert
  });

  it('403 when the task belongs to a different space', async () => {
    tableQueue.Task.push({ data: { id: 'task_1', spaceId: 'space_OTHER' }, error: null });
    const res = await POST(postReq({ taskId: 'task_1', subject: 'x' }));
    expect(res.status).toBe(403);
  });

  it('404 when the task does not exist', async () => {
    tableQueue.Task.push({ data: null, error: null });
    const res = await POST(postReq({ taskId: 'missing', subject: 'x' }));
    expect(res.status).toBe(404);
  });

  it('works for gates', async () => {
    tableQueue.StageGate.push({ data: { id: 'gate_1', spaceId: 'space_1' }, error: null });
    tableQueue.TaskConversation.push({ data: null, error: null });
    const res = await POST(postReq({ gateId: 'gate_1', subject: 'Approve the logo' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conversation: { gateId: string } };
    expect(body.conversation.gateId).toBe('gate_1');
  });
});
