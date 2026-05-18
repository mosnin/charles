/**
 * Tests for the real-model path of POST /api/task-conversations/[id]/messages.
 *
 * Covers: user + assistant rows persist with content/model/tokens, CostEvent
 * fires, classifier metadata rides along, fallback canned reply on OpenAI
 * throw, fallback when no API key, auth/ownership errors unchanged.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/space', () => ({ getSpaceForUser: vi.fn() }));
vi.mock('@/lib/agent-memory/layers', () => ({
  loadMemoryLayers: vi.fn(async () => ({ core: { product: 'CRM' }, working: {}, recent: [] })),
}));
vi.mock('@/lib/ai-tools/system-prompt', () => ({
  buildPersonalizedSystemPrompt: vi.fn(async () => 'SYSTEM_PROMPT'),
}));
vi.mock('@/lib/observability/cost-events', () => ({
  emitCostEvent: vi.fn(async () => undefined),
}));

const { openaiCalls, openaiBehavior } = vi.hoisted(() => ({
  openaiCalls: { create: [] as Array<Record<string, unknown>> },
  openaiBehavior: {
    mode: 'success' as 'success' | 'throw' | 'throw-once-then-success' | 'throw-twice',
    response: {
      choices: [{ message: { content: 'Real model reply about deploying.' } }],
      usage: { prompt_tokens: 50, completion_tokens: 25 },
    } as Record<string, unknown>,
  },
}));

vi.mock('openai', () => {
  class FakeOpenAI {
    chat = {
      completions: {
        create: vi.fn(async (args: Record<string, unknown>) => {
          openaiCalls.create.push(args);
          if (openaiBehavior.mode === 'throw') {
            throw new Error('openai exploded');
          }
          if (openaiBehavior.mode === 'throw-twice') {
            throw new Error('openai exploded');
          }
          if (openaiBehavior.mode === 'throw-once-then-success') {
            if (openaiCalls.create.length === 1) throw new Error('first try failed');
          }
          return openaiBehavior.response;
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
import { emitCostEvent } from '@/lib/observability/cost-events';
import { loadMemoryLayers } from '@/lib/agent-memory/layers';
import { buildPersonalizedSystemPrompt } from '@/lib/ai-tools/system-prompt';

const mockAuth = vi.mocked(requireAuth);
const mockGetSpace = vi.mocked(getSpaceForUser);
const mockEmitCost = vi.mocked(emitCostEvent);
const mockMemory = vi.mocked(loadMemoryLayers);
const mockBuildPrompt = vi.mocked(buildPersonalizedSystemPrompt);

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
  tableQueue.Mission.length = 0;
  calls.inserts.length = 0;
  openaiCalls.create.length = 0;
  openaiBehavior.mode = 'success';
  openaiBehavior.response = {
    choices: [{ message: { content: 'Real model reply about deploying.' } }],
    usage: { prompt_tokens: 50, completion_tokens: 25 },
  };
  process.env.OPENAI_API_KEY = 'sk-test';
  mockAuth.mockResolvedValue({ userId: 'user_clerk_1' });
  mockGetSpace.mockResolvedValue(SPACE);
});

describe('POST /api/task-conversations/[id]/messages — real-model path', () => {
  // ── Auth & ownership ──────────────────────────────────────────────────
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

  it('403 when conversation belongs to another space', async () => {
    tableQueue.TaskConversation.push({ data: { id: 'conv_1', spaceId: 'space_OTHER' }, error: null });
    const res = await POST(postReq('conv_1', { content: 'hi' }), idParams('conv_1'));
    expect(res.status).toBe(403);
  });

  it('404 when conversation does not exist', async () => {
    tableQueue.TaskConversation.push({ data: null, error: null });
    const res = await POST(postReq('missing', { content: 'hi' }), idParams('missing'));
    expect(res.status).toBe(404);
  });

  // ── Input validation ──────────────────────────────────────────────────
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

  it('400 when content exceeds max length', async () => {
    const huge = 'a'.repeat(5000);
    const res = await POST(postReq('conv_1', { content: huge }), idParams('conv_1'));
    expect(res.status).toBe(400);
  });

  // ── Happy path ────────────────────────────────────────────────────────
  it('200 persists user + assistant messages from real model reply', async () => {
    tableQueue.TaskConversation.push({ data: { id: 'conv_1', spaceId: 'space_1' }, error: null });
    const res = await POST(postReq('conv_1', { content: 'Deploy the landing page' }), idParams('conv_1'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { content: string };
      assistant: { content: string; metadata: Record<string, unknown> };
    };
    expect(body.user.content).toBe('Deploy the landing page');
    expect(body.assistant.content).toBe('Real model reply about deploying.');
    expect(body.assistant.metadata.model).toBe('gpt-5-mini');
    expect(body.assistant.metadata.inputTokens).toBe(50);
    expect(body.assistant.metadata.outputTokens).toBe(25);
    expect(body.assistant.metadata.delegatedTo).toBe('engineering');
  });

  it('assistant insert payload carries the model name', async () => {
    tableQueue.TaskConversation.push({ data: { id: 'conv_1', spaceId: 'space_1' }, error: null });
    await POST(postReq('conv_1', { content: 'Deploy now' }), idParams('conv_1'));
    const asInsert = calls.inserts.find(
      (c) => c.table === 'TaskMessage' && c.payload.role === 'assistant',
    );
    expect(asInsert).toBeDefined();
    const meta = asInsert!.payload.metadata as Record<string, unknown>;
    expect(meta.model).toBe('gpt-5-mini');
  });

  it('SubagentChip metadata is attached when keyword classifier matches', async () => {
    tableQueue.TaskConversation.push({ data: { id: 'conv_1', spaceId: 'space_1' }, error: null });
    const res = await POST(postReq('conv_1', { content: 'draft a blog post' }), idParams('conv_1'));
    const body = (await res.json()) as { assistant: { metadata: Record<string, unknown> } };
    expect(body.assistant.metadata.delegatedTo).toBe('marketing');
    const chip = body.assistant.metadata.subagentChip as Record<string, unknown>;
    expect(chip).toBeDefined();
    expect(chip.department).toBe('marketing');
    expect(String(chip.label)).toContain('Marketing');
  });

  it('no SubagentChip when no keyword matches', async () => {
    tableQueue.TaskConversation.push({ data: { id: 'conv_1', spaceId: 'space_1' }, error: null });
    const res = await POST(postReq('conv_1', { content: 'hello' }), idParams('conv_1'));
    const body = (await res.json()) as { assistant: { metadata: Record<string, unknown> } };
    expect(body.assistant.metadata.delegatedTo).toBeNull();
    expect(body.assistant.metadata.subagentChip).toBeUndefined();
  });

  // ── Cost event ────────────────────────────────────────────────────────
  it('emits a CostEvent with the response usage', async () => {
    tableQueue.TaskConversation.push({ data: { id: 'conv_1', spaceId: 'space_1' }, error: null });
    await POST(postReq('conv_1', { content: 'Deploy now' }), idParams('conv_1'));
    // emitCostEvent is async / fire-and-forget; flush the microtask queue.
    await new Promise((r) => setImmediate(r));
    expect(mockEmitCost).toHaveBeenCalledTimes(1);
    const arg = mockEmitCost.mock.calls[0][0];
    expect(arg.spaceId).toBe('space_1');
    expect(arg.model).toBe('gpt-5-mini');
    expect(arg.inputTokens).toBe(50);
    expect(arg.outputTokens).toBe(25);
  });

  // ── Memory + system prompt wiring ────────────────────────────────────
  it('loads memory layers with the user content as query', async () => {
    tableQueue.TaskConversation.push({ data: { id: 'conv_1', spaceId: 'space_1' }, error: null });
    await POST(postReq('conv_1', { content: 'What about our pitch?' }), idParams('conv_1'));
    expect(mockMemory).toHaveBeenCalledWith('space_1', 'What about our pitch?', 8);
  });

  it('builds personalized system prompt with mission context', async () => {
    tableQueue.TaskConversation.push({ data: { id: 'conv_1', spaceId: 'space_1' }, error: null });
    tableQueue.Mission.push({
      data: { id: 'm1', spaceId: 'space_1', stage: 'launch', title: 'X', oneLinePitch: 'Y', targetCustomer: 'Z' },
      error: null,
    });
    await POST(postReq('conv_1', { content: 'hi' }), idParams('conv_1'));
    expect(mockBuildPrompt).toHaveBeenCalledTimes(1);
    const opts = mockBuildPrompt.mock.calls[0][1] as { missionContext?: Record<string, unknown> };
    expect(opts.missionContext).toBeDefined();
    expect(opts.missionContext!.stage).toBe('launch');
  });

  it('defaults stage to "idea" when no mission row exists', async () => {
    tableQueue.TaskConversation.push({ data: { id: 'conv_1', spaceId: 'space_1' }, error: null });
    // Mission queue empty → maybeSingle returns null
    await POST(postReq('conv_1', { content: 'hi' }), idParams('conv_1'));
    const opts = mockBuildPrompt.mock.calls[0][1] as { missionContext?: { stage: string } };
    expect(opts.missionContext!.stage).toBe('idea');
  });

  it('passes the system prompt as the first message to OpenAI', async () => {
    tableQueue.TaskConversation.push({ data: { id: 'conv_1', spaceId: 'space_1' }, error: null });
    await POST(postReq('conv_1', { content: 'hi' }), idParams('conv_1'));
    const args = openaiCalls.create[0] as { messages: Array<{ role: string; content: string }> };
    expect(args.messages[0].role).toBe('system');
    expect(args.messages[0].content).toBe('SYSTEM_PROMPT');
    expect(args.messages[args.messages.length - 1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('uses gpt-5-mini as the default model', async () => {
    tableQueue.TaskConversation.push({ data: { id: 'conv_1', spaceId: 'space_1' }, error: null });
    await POST(postReq('conv_1', { content: 'hi' }), idParams('conv_1'));
    const args = openaiCalls.create[0] as { model: string };
    expect(args.model).toBe('gpt-5-mini');
  });

  // ── Fallback behavior ────────────────────────────────────────────────
  it('falls back to canned reply when OpenAI throws on both attempts', async () => {
    openaiBehavior.mode = 'throw-twice';
    tableQueue.TaskConversation.push({ data: { id: 'conv_1', spaceId: 'space_1' }, error: null });
    const res = await POST(postReq('conv_1', { content: 'Deploy now' }), idParams('conv_1'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { assistant: { content: string; metadata: Record<string, unknown> } };
    expect(body.assistant.content).toContain("something's off");
    expect(body.assistant.metadata.fallback).toBe('model_error');
    // No cost event when nothing succeeded.
    expect(mockEmitCost).not.toHaveBeenCalled();
  });

  it('retries with the fallback model if the primary throws once', async () => {
    openaiBehavior.mode = 'throw-once-then-success';
    tableQueue.TaskConversation.push({ data: { id: 'conv_1', spaceId: 'space_1' }, error: null });
    const res = await POST(postReq('conv_1', { content: 'Deploy now' }), idParams('conv_1'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { assistant: { metadata: Record<string, unknown> } };
    expect(body.assistant.metadata.model).toBe('gpt-4o-mini');
    expect(openaiCalls.create.length).toBe(2);
    expect((openaiCalls.create[1] as { model: string }).model).toBe('gpt-4o-mini');
  });

  it('falls back to canned reply when OPENAI_API_KEY is not set', async () => {
    delete process.env.OPENAI_API_KEY;
    tableQueue.TaskConversation.push({ data: { id: 'conv_1', spaceId: 'space_1' }, error: null });
    const res = await POST(postReq('conv_1', { content: 'Deploy now' }), idParams('conv_1'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { assistant: { content: string; metadata: Record<string, unknown> } };
    expect(body.assistant.metadata.fallback).toBe('no_api_key');
    // Canned reply for engineering keyword.
    expect(body.assistant.content).toContain('Engineering');
    expect(openaiCalls.create.length).toBe(0);
  });

  it('still persists assistant row on fallback', async () => {
    openaiBehavior.mode = 'throw-twice';
    tableQueue.TaskConversation.push({ data: { id: 'conv_1', spaceId: 'space_1' }, error: null });
    await POST(postReq('conv_1', { content: 'hi' }), idParams('conv_1'));
    const asInsert = calls.inserts.find(
      (c) => c.table === 'TaskMessage' && c.payload.role === 'assistant',
    );
    expect(asInsert).toBeDefined();
    expect(String(asInsert!.payload.content)).toContain("something's off");
  });

  // ── Empty model response ──────────────────────────────────────────────
  it('falls back when the model returns an empty string', async () => {
    openaiBehavior.response = {
      choices: [{ message: { content: '' } }],
      usage: { prompt_tokens: 5, completion_tokens: 0 },
    };
    tableQueue.TaskConversation.push({ data: { id: 'conv_1', spaceId: 'space_1' }, error: null });
    const res = await POST(postReq('conv_1', { content: 'hi' }), idParams('conv_1'));
    const body = (await res.json()) as { assistant: { metadata: Record<string, unknown> } };
    expect(body.assistant.metadata.fallback).toBe('model_error');
  });

  // ── User insert error ─────────────────────────────────────────────────
  it('500s when the user message insert fails', async () => {
    tableQueue.TaskConversation.push({ data: { id: 'conv_1', spaceId: 'space_1' }, error: null });
    tableQueue.TaskMessage.push({ data: null, error: { message: 'boom' } });
    const res = await POST(postReq('conv_1', { content: 'hi' }), idParams('conv_1'));
    expect(res.status).toBe(500);
  });
});
