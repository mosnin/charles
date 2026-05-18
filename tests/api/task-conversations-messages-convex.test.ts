/**
 * Verifies the assistant endpoint mirrors both turns into Convex
 * liveMessages when NEXT_PUBLIC_CONVEX_URL + CONVEX_SERVICE_SECRET are
 * set, and silently skips the mirror when either is absent. The
 * Supabase + auth machinery is mocked the same way as the base route
 * suite to keep these tests focused on the Convex bridge.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/space', () => ({ getSpaceForUser: vi.fn() }));

let convexIdCounter = 0;
const mutationMock = vi.fn(async (_name?: unknown, _args?: unknown) => {
  convexIdCounter += 1;
  return `live_${convexIdCounter}` as unknown;
});
const queryMock = vi.fn(async (_name?: unknown, _args?: unknown) => [] as unknown);

vi.mock('convex/browser', () => ({
  ConvexHttpClient: vi.fn().mockImplementation(() => ({
    mutation: mutationMock,
    query: queryMock,
  })),
}));

type Terminal = { data?: unknown; error?: unknown };
const { tableQueue, calls } = vi.hoisted(() => ({
  tableQueue: {
    TaskConversation: [] as Terminal[],
    TaskMessage: [] as Terminal[],
  },
  calls: {
    inserts: [] as Array<{ table: string; payload: Record<string, unknown> }>,
    updates: [] as Array<{ table: string; payload: Record<string, unknown>; whereId?: string }>,
  },
}));

function shiftTerminal(table: keyof typeof tableQueue): Terminal {
  return tableQueue[table].shift() ?? { data: null, error: null };
}

vi.mock('@/lib/supabase', () => {
  function chain(table: keyof typeof tableQueue) {
    const obj: Record<string, unknown> = {};
    obj.select = vi.fn(() => obj);
    obj.eq = vi.fn(() => obj);
    obj.maybeSingle = vi.fn(() => Promise.resolve(shiftTerminal(table)));
    obj.single = vi.fn(() => Promise.resolve(shiftTerminal(table)));

    obj.insert = vi.fn((payload: Record<string, unknown>) => {
      calls.inserts.push({ table, payload });
      const ins: Record<string, unknown> = {};
      ins.select = vi.fn(() => ins);
      ins.single = vi.fn(() => {
        return Promise.resolve({
          data: {
            id: `${table}_${calls.inserts.length}`,
            conversationId: payload.conversationId,
            role: payload.role,
            content: payload.content,
            metadata: payload.metadata ?? null,
            createdAt: '2026-05-13T00:00:00.000Z',
          },
          error: null,
        });
      });
      return ins;
    });

    obj.update = vi.fn((payload: Record<string, unknown>) => {
      const upd: Record<string, unknown> = {};
      upd.eq = vi.fn((_col: string, val: unknown) => {
        calls.updates.push({
          table,
          payload,
          whereId: typeof val === 'string' ? val : undefined,
        });
        return Promise.resolve({ data: null, error: null });
      });
      return upd;
    });

    return obj;
  }
  return {
    supabase: { from: vi.fn((table: string) => chain(table as keyof typeof tableQueue)) },
  };
});

import { POST } from '@/app/api/task-conversations/[id]/messages/route';
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

function postReq(id: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/task-conversations/${id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

const ENV_KEYS = ['NEXT_PUBLIC_CONVEX_URL', 'CONVEX_SERVICE_SECRET', 'OPENAI_API_KEY'] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  tableQueue.TaskConversation.length = 0;
  tableQueue.TaskMessage.length = 0;
  calls.inserts.length = 0;
  calls.updates.length = 0;
  convexIdCounter = 0;
  mutationMock.mockClear();
  queryMock.mockClear();
  // Use the canned-reply path so this suite doesn't hit OpenAI.
  delete process.env.OPENAI_API_KEY;
  mockAuth.mockResolvedValue({ userId: 'user_clerk_1' });
  mockGetSpace.mockResolvedValue(SPACE);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function queueConvOwnedBySpace(spaceId: string) {
  tableQueue.TaskConversation.push({
    data: { id: 'conv_1', spaceId },
    error: null,
  });
}

describe('POST /api/task-conversations/[id]/messages — Convex mirror', () => {
  it('writes both user and assistant turns to Convex when env is set', async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://example.convex.cloud';
    process.env.CONVEX_SERVICE_SECRET = 'shh';
    queueConvOwnedBySpace('space_1');

    const res = await POST(
      postReq('conv_1', { content: 'hello team' }),
      idParams('conv_1'),
    );
    expect(res.status).toBe(200);
    expect(mutationMock).toHaveBeenCalledTimes(2);

    const roles = mutationMock.mock.calls.map((c) => (c[1] as { role: string }).role).sort();
    expect(roles).toEqual(['assistant', 'user']);

    for (const call of mutationMock.mock.calls) {
      const args = call[1] as Record<string, unknown>;
      expect(args.serviceSecret).toBe('shh');
      expect(args.conversationId).toBe('conv_1');
      expect(args.spaceId).toBe('space_1');
    }
  });

  it('skips Convex when NEXT_PUBLIC_CONVEX_URL is unset', async () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    process.env.CONVEX_SERVICE_SECRET = 'shh';
    queueConvOwnedBySpace('space_1');
    const res = await POST(
      postReq('conv_1', { content: 'hi' }),
      idParams('conv_1'),
    );
    expect(res.status).toBe(200);
    expect(mutationMock).not.toHaveBeenCalled();
  });

  it('skips Convex when CONVEX_SERVICE_SECRET is unset', async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://example.convex.cloud';
    delete process.env.CONVEX_SERVICE_SECRET;
    queueConvOwnedBySpace('space_1');
    const res = await POST(
      postReq('conv_1', { content: 'hi' }),
      idParams('conv_1'),
    );
    expect(res.status).toBe(200);
    expect(mutationMock).not.toHaveBeenCalled();
  });

  it('returns 200 even if Convex throws (graceful degrade)', async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://example.convex.cloud';
    process.env.CONVEX_SERVICE_SECRET = 'shh';
    queueConvOwnedBySpace('space_1');
    mutationMock.mockRejectedValueOnce(new Error('convex offline'));
    const res = await POST(
      postReq('conv_1', { content: 'hi' }),
      idParams('conv_1'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toBeDefined();
    expect(body.assistant).toBeDefined();
  });

  it('passes assistant metadata (e.g. delegatedTo) into the Convex mirror', async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://example.convex.cloud';
    process.env.CONVEX_SERVICE_SECRET = 'shh';
    queueConvOwnedBySpace('space_1');
    // The keyword "deploy" routes through the engineering classifier.
    const res = await POST(
      postReq('conv_1', { content: 'please deploy the build' }),
      idParams('conv_1'),
    );
    expect(res.status).toBe(200);
    const assistantCall = mutationMock.mock.calls.find(
      (c) => (c[1] as { role: string }).role === 'assistant',
    );
    expect(assistantCall).toBeDefined();
    const args = assistantCall![1] as { metadata: Record<string, unknown> };
    expect(args.metadata.delegatedTo).toBe('engineering');
  });

  it('writes the Convex _id back onto each Supabase row via convexMessageId', async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://example.convex.cloud';
    process.env.CONVEX_SERVICE_SECRET = 'shh';
    queueConvOwnedBySpace('space_1');

    const res = await POST(
      postReq('conv_1', { content: 'hi' }),
      idParams('conv_1'),
    );
    expect(res.status).toBe(200);

    // Two updates on TaskMessage — one per side — each carrying a
    // convexMessageId from the mirror response, keyed on the inserted
    // Supabase row id.
    const writebacks = calls.updates.filter(
      (u) =>
        u.table === 'TaskMessage' &&
        typeof (u.payload as { convexMessageId?: unknown }).convexMessageId === 'string',
    );
    expect(writebacks).toHaveLength(2);
    const ids = writebacks
      .map((u) => (u.payload as { convexMessageId: string }).convexMessageId)
      .sort();
    expect(ids).toEqual(['live_1', 'live_2']);
    // The .eq() target should be the Supabase row id we just inserted.
    for (const w of writebacks) {
      expect(typeof w.whereId).toBe('string');
      expect(w.whereId).toMatch(/^TaskMessage_/);
    }
  });

  it('does not write back convexMessageId when the Convex mirror fails', async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://example.convex.cloud';
    process.env.CONVEX_SERVICE_SECRET = 'shh';
    queueConvOwnedBySpace('space_1');
    mutationMock.mockRejectedValue(new Error('convex offline'));

    const res = await POST(
      postReq('conv_1', { content: 'hi' }),
      idParams('conv_1'),
    );
    expect(res.status).toBe(200);
    const writebacks = calls.updates.filter(
      (u) =>
        u.table === 'TaskMessage' &&
        (u.payload as { convexMessageId?: unknown }).convexMessageId !== undefined,
    );
    expect(writebacks).toHaveLength(0);
  });

  it('one side of the mirror failing still writes back the other side', async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://example.convex.cloud';
    process.env.CONVEX_SERVICE_SECRET = 'shh';
    queueConvOwnedBySpace('space_1');
    // First call resolves (user), second call rejects (assistant).
    mutationMock.mockImplementationOnce(async () => 'live_1' as unknown);
    mutationMock.mockImplementationOnce(async () => {
      throw new Error('half offline');
    });

    const res = await POST(
      postReq('conv_1', { content: 'hi' }),
      idParams('conv_1'),
    );
    expect(res.status).toBe(200);
    const writebacks = calls.updates.filter(
      (u) =>
        u.table === 'TaskMessage' &&
        (u.payload as { convexMessageId?: unknown }).convexMessageId !== undefined,
    );
    expect(writebacks).toHaveLength(1);
    expect((writebacks[0].payload as { convexMessageId: string }).convexMessageId).toBe('live_1');
  });

  it('does not mirror when the route returns early (forbidden)', async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://example.convex.cloud';
    process.env.CONVEX_SERVICE_SECRET = 'shh';
    mockAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await POST(postReq('conv_1', { content: 'hi' }), idParams('conv_1'));
    expect(res.status).toBe(401);
    expect(mutationMock).not.toHaveBeenCalled();
  });
});
