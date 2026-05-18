/**
 * Smoke tests for POST /api/task-conversations/[id]/messages/stream.
 *
 * Verifies the SSE envelope: chunks are `data: {...}\n\n`, the stream
 * carries deltas and a terminal {done:true,messageId}, the fallback
 * path emits a canned chunk when there is no API key, and auth /
 * validation errors return JSON not SSE.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/space', () => ({ getSpaceForUser: vi.fn() }));
vi.mock('@/lib/agent-memory/layers', () => ({
  loadMemoryLayers: vi.fn(async () => ({ core: {}, working: {}, recent: [] })),
}));
vi.mock('@/lib/ai-tools/system-prompt', () => ({
  buildPersonalizedSystemPrompt: vi.fn(async () => 'SYSTEM_PROMPT'),
}));
vi.mock('@/lib/observability/cost-events', () => ({
  emitCostEvent: vi.fn(async () => undefined),
}));

vi.mock('openai', () => {
  class FakeOpenAI {
    chat = {
      completions: {
        create: vi.fn(async () => {
          // Async iterable yielding two delta chunks then a usage chunk.
          async function* gen() {
            yield { choices: [{ delta: { content: 'Hello ' } }] };
            yield { choices: [{ delta: { content: 'world.' } }] };
            yield {
              choices: [{ delta: {} }],
              usage: { prompt_tokens: 10, completion_tokens: 4 },
            };
          }
          return gen();
        }),
      },
    };
  }
  return { default: FakeOpenAI };
});

type Terminal = { data?: unknown; error?: unknown };
const { tableQueue, calls } = vi.hoisted(() => ({
  tableQueue: {
    TaskConversation: [] as Terminal[],
    TaskMessage: [] as Terminal[],
    Mission: [] as Terminal[],
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
    obj.order = vi.fn(() => obj);
    obj.limit = vi.fn(() => Promise.resolve(shiftTerminal(table)));
    obj.maybeSingle = vi.fn(() => Promise.resolve(shiftTerminal(table)));
    obj.single = vi.fn(() => Promise.resolve(shiftTerminal(table)));
    obj.insert = vi.fn((payload: Record<string, unknown>) => {
      calls.inserts.push({ table, payload });
      const ins: Record<string, unknown> = {};
      ins.select = vi.fn(() => ins);
      ins.single = vi.fn(() =>
        Promise.resolve({
          data: {
            id: `${table}_msg_${calls.inserts.length}`,
            conversationId: payload.conversationId,
            role: payload.role,
            content: payload.content,
            metadata: payload.metadata ?? null,
            createdAt: '2026-05-13T00:00:00.000Z',
          },
          error: null,
        }),
      );
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

import { POST } from '@/app/api/task-conversations/[id]/messages/stream/route';
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
  return new NextRequest(`http://localhost/api/task-conversations/${id}/messages/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

async function readSSE(res: Response): Promise<string[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const events: string[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (value) buf += decoder.decode(value);
    if (done) break;
  }
  for (const line of buf.split('\n\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('data:')) events.push(trimmed.slice(5).trim());
  }
  return events;
}

beforeEach(() => {
  vi.clearAllMocks();
  tableQueue.TaskConversation.length = 0;
  tableQueue.TaskMessage.length = 0;
  tableQueue.Mission.length = 0;
  calls.inserts.length = 0;
  process.env.OPENAI_API_KEY = 'sk-test';
  mockAuth.mockResolvedValue({ userId: 'user_clerk_1' });
  mockGetSpace.mockResolvedValue(SPACE);
});

describe('POST /api/task-conversations/[id]/messages/stream', () => {
  it('401 unauth returns JSON, not SSE', async () => {
    mockAuth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await POST(postReq('conv_1', { content: 'hi' }), idParams('conv_1'));
    expect(res.status).toBe(401);
    expect(res.headers.get('Content-Type')).not.toContain('text/event-stream');
  });

  it('400 on empty content', async () => {
    const res = await POST(postReq('conv_1', { content: '  ' }), idParams('conv_1'));
    expect(res.status).toBe(400);
  });

  it('streams deltas and a terminal done event', async () => {
    tableQueue.TaskConversation.push({ data: { id: 'conv_1', spaceId: 'space_1' }, error: null });
    const res = await POST(postReq('conv_1', { content: 'hi' }), idParams('conv_1'));
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const events = await readSSE(res);
    const parsed = events.map((e) => JSON.parse(e) as Record<string, unknown>);
    // First event announces the user message id.
    expect(parsed[0]).toHaveProperty('userMessageId');
    // Two delta chunks followed by a done.
    const deltas = parsed.filter((e) => typeof e.delta === 'string').map((e) => e.delta as string);
    expect(deltas.join('')).toBe('Hello world.');
    const terminal = parsed[parsed.length - 1] as { done: boolean; messageId: string };
    expect(terminal.done).toBe(true);
    expect(terminal.messageId).toBeTruthy();
  });

  it('emits a canned single chunk when there is no API key', async () => {
    delete process.env.OPENAI_API_KEY;
    tableQueue.TaskConversation.push({ data: { id: 'conv_1', spaceId: 'space_1' }, error: null });
    const res = await POST(postReq('conv_1', { content: 'Deploy now' }), idParams('conv_1'));
    const events = await readSSE(res);
    const parsed = events.map((e) => JSON.parse(e) as Record<string, unknown>);
    const deltas = parsed.filter((e) => typeof e.delta === 'string').map((e) => e.delta as string);
    expect(deltas.join('')).toContain('Engineering');
  });

  it('persists user + assistant rows by stream end', async () => {
    tableQueue.TaskConversation.push({ data: { id: 'conv_1', spaceId: 'space_1' }, error: null });
    const res = await POST(postReq('conv_1', { content: 'hi' }), idParams('conv_1'));
    await readSSE(res);
    const userInsert = calls.inserts.find(
      (c) => c.table === 'TaskMessage' && c.payload.role === 'user',
    );
    const asInsert = calls.inserts.find(
      (c) => c.table === 'TaskMessage' && c.payload.role === 'assistant',
    );
    expect(userInsert).toBeDefined();
    expect(asInsert).toBeDefined();
    expect(asInsert!.payload.content).toBe('Hello world.');
  });
});
