/**
 * Route-level tests for POST /api/task-conversations/[id]/messages.
 *
 * The bar:
 *   - 401 unauth, 403 no space, 403 wrong-space conversation, 404 missing.
 *   - 400 on malformed JSON, missing content, empty content.
 *   - 200 happy: inserts user message + canned assistant message, returns both.
 *   - The assistant message reflects the keyword classifier (engineering vs
 *     neutral fallback).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/space', () => ({ getSpaceForUser: vi.fn() }));

type Terminal = { data?: unknown; error?: unknown };
const { tableQueue, calls } = vi.hoisted(() => ({
  tableQueue: {
    TaskConversation: [] as Terminal[],
    TaskMessage: [] as Terminal[],
  },
  calls: {
    inserts: [] as Array<{ table: string; payload: Record<string, unknown> }>,
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
        const terminal = shiftTerminal(table);
        if (terminal.data || terminal.error) return Promise.resolve(terminal);
        return Promise.resolve({
          data: {
            id: `${table}_msg_${calls.inserts.length}`,
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

beforeEach(() => {
  vi.clearAllMocks();
  tableQueue.TaskConversation.length = 0;
  tableQueue.TaskMessage.length = 0;
  calls.inserts.length = 0;
  mockAuth.mockResolvedValue({ userId: 'user_clerk_1' });
  mockGetSpace.mockResolvedValue(SPACE);
});

describe('POST /api/task-conversations/[id]/messages', () => {
  it('401 unauth', async () => {
    mockAuth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await POST(postReq('conv_1', { content: 'hi' }), idParams('conv_1'));
    expect(res.status).toBe(401);
  });

  it('403 when caller has no space', async () => {
    mockGetSpace.mockResolvedValue(null);
    const res = await POST(postReq('conv_1', { content: 'hi' }), idParams('conv_1'));
    expect(res.status).toBe(403);
  });

  it('400 on malformed JSON', async () => {
    const res = await POST(postReq('conv_1', '{not-json'), idParams('conv_1'));
    expect(res.status).toBe(400);
  });

  it('400 when content is missing', async () => {
    const res = await POST(postReq('conv_1', {}), idParams('conv_1'));
    expect(res.status).toBe(400);
  });

  it('400 when content is whitespace only', async () => {
    const res = await POST(postReq('conv_1', { content: '   ' }), idParams('conv_1'));
    expect(res.status).toBe(400);
  });

  it('404 when conversation does not exist', async () => {
    tableQueue.TaskConversation.push({ data: null, error: null });
    const res = await POST(postReq('missing', { content: 'hi' }), idParams('missing'));
    expect(res.status).toBe(404);
  });

  it('403 when conversation lives in another space', async () => {
    tableQueue.TaskConversation.push({
      data: { id: 'conv_1', spaceId: 'space_OTHER' },
      error: null,
    });
    const res = await POST(postReq('conv_1', { content: 'hi' }), idParams('conv_1'));
    expect(res.status).toBe(403);
  });

  it('200 inserts user + assistant message, returns both', async () => {
    tableQueue.TaskConversation.push({
      data: { id: 'conv_1', spaceId: 'space_1' },
      error: null,
    });
    const res = await POST(
      postReq('conv_1', { content: 'Deploy the landing page' }),
      idParams('conv_1'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { role: string; content: string };
      assistant: { role: string; content: string; metadata: { delegatedTo: string | null } };
    };
    expect(body.user.role).toBe('user');
    expect(body.user.content).toBe('Deploy the landing page');
    expect(body.assistant.role).toBe('assistant');
    expect(body.assistant.metadata.delegatedTo).toBe('engineering');
    expect(body.assistant.content).toContain('Engineering');
    // Two inserts into TaskMessage.
    const msgInserts = calls.inserts.filter((c) => c.table === 'TaskMessage');
    expect(msgInserts).toHaveLength(2);
    expect(msgInserts[0].payload.role).toBe('user');
    expect(msgInserts[1].payload.role).toBe('assistant');
  });

  it('200 falls back to a neutral reply when no keyword matches', async () => {
    tableQueue.TaskConversation.push({
      data: { id: 'conv_1', spaceId: 'space_1' },
      error: null,
    });
    const res = await POST(
      postReq('conv_1', { content: 'hello there' }),
      idParams('conv_1'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      assistant: { metadata: { delegatedTo: string | null } };
    };
    expect(body.assistant.metadata.delegatedTo).toBeNull();
  });
});
