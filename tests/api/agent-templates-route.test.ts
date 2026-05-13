/**
 * Route tests for /api/agent-templates (GET, POST).
 *
 * Auth + ownership, validation, and the basic happy paths. The GET path
 * folds in a second query for subagent counts; we exercise both the
 * empty-workspace case and the multi-template case.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/space', () => ({ getSpaceForUser: vi.fn() }));

type Terminal = { data?: unknown; error?: unknown };
const { tableQueue, calls } = vi.hoisted(() => ({
  tableQueue: {
    CustomAgent: [] as Terminal[],
    AgentSubAgent: [] as Terminal[],
  },
  calls: {
    insert: [] as Array<{ table: string; payload: Record<string, unknown> }>,
  },
}));

function nextTerminal(table: keyof typeof tableQueue): Terminal {
  return tableQueue[table].shift() ?? { data: null, error: null };
}

vi.mock('@/lib/supabase', () => {
  function makeThenable(table: keyof typeof tableQueue, obj: Record<string, unknown>) {
    const next: Record<string, unknown> = { ...obj };
    (next as { then: unknown }).then = (resolve: (v: Terminal) => unknown) =>
      Promise.resolve(nextTerminal(table)).then(resolve);
    return next;
  }
  function chain(table: keyof typeof tableQueue) {
    const obj: Record<string, unknown> = {};
    obj.select = vi.fn(() => obj);
    obj.limit = vi.fn(() => obj);
    obj.order = vi.fn(() => makeThenable(table, obj));
    obj.eq = vi.fn(() => makeThenable(table, obj));
    obj.in = vi.fn(() => makeThenable(table, obj));
    obj.maybeSingle = vi.fn(() => Promise.resolve(nextTerminal(table)));
    obj.single = vi.fn(() => Promise.resolve(nextTerminal(table)));

    obj.insert = vi.fn((payload: Record<string, unknown>) => {
      calls.insert.push({ table, payload });
      const ins: Record<string, unknown> = {};
      ins.select = vi.fn(() => ins);
      ins.single = vi.fn(() => {
        const terminal = nextTerminal(table);
        if (terminal.data || terminal.error) return Promise.resolve(terminal);
        return Promise.resolve({ data: { id: 'agent_new' }, error: null });
      });
      return ins;
    });

    return obj;
  }
  return {
    supabase: { from: vi.fn((table: string) => chain(table as keyof typeof tableQueue)) },
  };
});

import { GET, POST } from '@/app/api/agent-templates/route';
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

function listReq(): NextRequest {
  return new NextRequest('http://localhost/api/agent-templates');
}
function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/agent-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  tableQueue.CustomAgent.length = 0;
  tableQueue.AgentSubAgent.length = 0;
  calls.insert.length = 0;
  mockAuth.mockResolvedValue({ userId: 'user_clerk_1' });
  mockGetSpace.mockResolvedValue(SPACE);
});

describe('GET /api/agent-templates', () => {
  it('401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockGetSpace).not.toHaveBeenCalled();
  });

  it('403 when the caller has no workspace', async () => {
    mockGetSpace.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('200 with an empty list when DB has zero rows', async () => {
    tableQueue.CustomAgent.push({ data: [], error: null });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { templates: unknown[] };
    expect(body.templates).toEqual([]);
  });

  it('200 with templates + subagent counts when rows exist', async () => {
    tableQueue.CustomAgent.push({
      data: [
        {
          id: 'a1',
          spaceId: 'space_1',
          name: 'Outbound',
          systemPrompt: '',
          customInstructions: 'Hi',
          triggerType: 'schedule',
          createdAt: '2026-05-12T00:00:00.000Z',
          updatedAt: '2026-05-12T00:00:00.000Z',
        },
        {
          id: 'a2',
          spaceId: 'space_1',
          name: 'Research',
          systemPrompt: '',
          customInstructions: '',
          triggerType: null,
          createdAt: '2026-05-11T00:00:00.000Z',
          updatedAt: '2026-05-11T00:00:00.000Z',
        },
      ],
      error: null,
    });
    tableQueue.AgentSubAgent.push({
      data: [
        { customAgentId: 'a1' },
        { customAgentId: 'a1' },
        { customAgentId: 'a2' },
      ],
      error: null,
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      templates: Array<{
        id: string;
        name: string;
        triggerType: string;
        subagentCount: number;
        customInstructions: string;
      }>;
    };
    expect(body.templates).toHaveLength(2);

    const a1 = body.templates.find((t) => t.id === 'a1');
    expect(a1?.triggerType).toBe('schedule');
    expect(a1?.subagentCount).toBe(2);
    expect(a1?.customInstructions).toBe('Hi');

    const a2 = body.templates.find((t) => t.id === 'a2');
    expect(a2?.triggerType).toBe('manual'); // null → manual
    expect(a2?.subagentCount).toBe(1);
  });

  it('500 with a generic message when the DB fails', async () => {
    tableQueue.CustomAgent.push({
      data: null,
      error: { message: 'postgres connection refused at 127.0.0.1' },
    });
    const res = await GET();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain('postgres');
    expect(body.error).not.toContain('127.0.0.1');
  });
});

describe('POST /api/agent-templates', () => {
  it('401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await POST(postReq({ name: 'X' }));
    expect(res.status).toBe(401);
  });

  it('403 when the caller has no workspace', async () => {
    mockGetSpace.mockResolvedValue(null);
    const res = await POST(postReq({ name: 'X' }));
    expect(res.status).toBe(403);
  });

  it('400 when JSON is malformed', async () => {
    const res = await POST(postReq('{not json'));
    expect(res.status).toBe(400);
  });

  it('400 when name is missing', async () => {
    const res = await POST(postReq({}));
    expect(res.status).toBe(400);
  });

  it('400 when name is empty after trim', async () => {
    const res = await POST(postReq({ name: '   ' }));
    expect(res.status).toBe(400);
  });

  it('400 on unknown trigger type', async () => {
    const res = await POST(postReq({ name: 'X', triggerType: 'cron' }));
    expect(res.status).toBe(400);
  });

  it('200 returns { id } on happy path with defaults', async () => {
    const res = await POST(postReq({ name: 'My agent' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe('agent_new');

    expect(calls.insert).toHaveLength(1);
    const payload = calls.insert[0].payload;
    expect(payload.name).toBe('My agent');
    expect(payload.kind).toBe('custom');
    expect(payload.triggerType).toBe('manual');
    expect(payload.customInstructions).toBe('');
    expect(payload.spaceId).toBe('space_1');
  });

  it('200 with a non-default trigger + instructions persists them', async () => {
    const res = await POST(
      postReq({
        name: 'Cron agent',
        triggerType: 'schedule',
        customInstructions: 'Daily at 9am.',
      }),
    );
    expect(res.status).toBe(200);
    expect(calls.insert[0].payload.triggerType).toBe('schedule');
    expect(calls.insert[0].payload.customInstructions).toBe('Daily at 9am.');
  });

  it('400 when customInstructions is not a string', async () => {
    const res = await POST(postReq({ name: 'X', customInstructions: 42 }));
    expect(res.status).toBe(400);
  });
});
