/**
 * Route tests for POST /api/documents/product-prd/generate.
 *
 * Locks down: auth gate, workspace ownership, rate cap (5/hour/space), the
 * UPSERT into Document, the CostEvent emission, the fallback model on
 * primary failure, and a 502 when both calls fail.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/space', () => ({
  getSpaceForUser: vi.fn(),
}));

vi.mock('@/lib/agent-memory/layers', () => ({
  loadMemoryLayers: vi.fn(),
}));

vi.mock('@/lib/observability/cost-events', () => ({
  emitCostEvent: vi.fn().mockResolvedValue(undefined),
}));

// One spy for chat completions. Each test re-points its behavior.
const { chatCreate } = vi.hoisted(() => ({ chatCreate: vi.fn() }));
vi.mock('openai', () => {
  return {
    default: class FakeOpenAI {
      chat = { completions: { create: chatCreate } };
      constructor(_opts: unknown) {}
    },
  };
});

// Per-table queue for the supabase mock + spies for what we want to assert.
const { selectQueue, upsertSpy } = vi.hoisted(() => ({
  selectQueue: [] as Array<{ data?: unknown; error?: unknown }>,
  upsertSpy: vi.fn(),
}));

vi.mock('@/lib/supabase', () => {
  function chain() {
    const obj: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'limit']) {
      obj[m] = vi.fn(() => obj);
    }
    obj.maybeSingle = vi.fn(() =>
      Promise.resolve(selectQueue.shift() ?? { data: null, error: null }),
    );
    obj.single = vi.fn(() =>
      Promise.resolve(selectQueue.shift() ?? { data: null, error: null }),
    );
    obj.upsert = vi.fn((payload: Record<string, unknown>, opts?: unknown) => {
      upsertSpy(payload, opts);
      const up: Record<string, unknown> = {};
      up.select = vi.fn(() => up);
      up.single = vi.fn(() =>
        Promise.resolve({
          data: { updatedAt: payload.updatedAt ?? new Date().toISOString() },
          error: null,
        }),
      );
      return up;
    });
    obj.insert = vi.fn(() => Promise.resolve({ error: null }));
    return obj;
  }
  return { supabase: { from: vi.fn(() => chain()) } };
});

import { POST } from '@/app/api/documents/product-prd/generate/route';
import { __resetBuckets, MAX_PER_HOUR } from '@/app/api/documents/product-prd/generate/_buckets';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { loadMemoryLayers } from '@/lib/agent-memory/layers';
import { emitCostEvent } from '@/lib/observability/cost-events';

const mockAuth = vi.mocked(requireAuth);
const mockGetSpace = vi.mocked(getSpaceForUser);
const mockLoadMem = vi.mocked(loadMemoryLayers);
const mockEmitCost = vi.mocked(emitCostEvent);

const SPACE = {
  id: 'space_1',
  slug: 'jane',
  name: 'Jane Co',
  emoji: null,
  ownerId: 'user_db_1',
  brokerageId: null,
  createdAt: '2026-04-01T00:00:00.000Z',
} as unknown as NonNullable<Awaited<ReturnType<typeof getSpaceForUser>>>;

const SAMPLE_PRD = [
  '# Jane Co — Product PRD',
  '',
  '## Problem',
  'Founders waste hours staring at blank PRD pages instead of building.',
  '',
  '## Customer',
  'Solo founders at the idea-to-building edge.',
  '',
  '## Solution',
  'Charles drafts the document from mission context.',
  '',
  '## Scope',
  '### v1 in',
  '- Draft from mission',
  '### v1 out',
  '- Multi-document chaining',
  '',
  '## Success metrics',
  '- 80% of drafts kept with edits',
  '',
  '## Risks',
  '- Founders rubber-stamp instead of revising.',
].join('\n');

function makeReq(): Request {
  return new Request('http://localhost/api/documents/product-prd/generate', {
    method: 'POST',
  });
}

function mockOpenAIOnce(content: string, usage = { prompt_tokens: 800, completion_tokens: 600 }) {
  chatCreate.mockResolvedValueOnce({
    choices: [{ message: { content } }],
    usage,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetBuckets();
  selectQueue.length = 0;
  mockAuth.mockResolvedValue({ userId: 'user_clerk_1' });
  mockGetSpace.mockResolvedValue(SPACE);
  mockLoadMem.mockResolvedValue({
    core: { company_name: 'Jane Co', stage: 'building' },
    working: {},
    recent: [],
  });
  // Default supabase responses for: Mission lookup, brand-kit Doc lookup.
  selectQueue.push({
    data: {
      title: 'Make filing taxes feel like brushing teeth.',
      oneLinePitch: 'One tap, one minute, one number.',
      targetCustomer: 'US W-2 earners.',
      description: 'Mobile app + IRS integration.',
    },
    error: null,
  });
  selectQueue.push({ data: null, error: null }); // brand-kit absent
  process.env.OPENAI_API_KEY = 'sk-test';
});

describe('POST /api/documents/product-prd/generate', () => {
  it('401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(401);
    expect(chatCreate).not.toHaveBeenCalled();
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('403 when caller has no workspace', async () => {
    mockGetSpace.mockResolvedValue(null);
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(403);
    expect(chatCreate).not.toHaveBeenCalled();
  });

  it('200 happy path — calls primary model and UPSERTs the document', async () => {
    mockOpenAIOnce(SAMPLE_PRD);
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toContain('# Jane Co — Product PRD');
    expect(body.updatedAt).toBeTruthy();

    // Primary model used
    expect(chatCreate).toHaveBeenCalledTimes(1);
    const call = chatCreate.mock.calls[0][0];
    expect(call.model).toBe('gpt-5');
    expect(Array.isArray(call.messages)).toBe(true);
    expect(call.messages[0].role).toBe('system');
    expect(call.messages[1].role).toBe('user');

    // UPSERT shape
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const [payload, opts] = upsertSpy.mock.calls[0];
    expect((payload as Record<string, unknown>).spaceId).toBe(SPACE.id);
    expect((payload as Record<string, unknown>).slug).toBe('product-prd');
    expect((payload as Record<string, unknown>).title).toBe('Product PRD');
    expect((payload as Record<string, unknown>).content).toContain('## Problem');
    expect((opts as { onConflict?: string } | undefined)?.onConflict).toBe(
      'spaceId,slug',
    );
  });

  it('200 happy path emits a CostEvent with the model and token usage', async () => {
    mockOpenAIOnce(SAMPLE_PRD, { prompt_tokens: 1234, completion_tokens: 567 });
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(200);
    expect(mockEmitCost).toHaveBeenCalledTimes(1);
    const event = mockEmitCost.mock.calls[0][0];
    expect(event.spaceId).toBe(SPACE.id);
    expect(event.model).toBe('gpt-5');
    expect(event.inputTokens).toBe(1234);
    expect(event.outputTokens).toBe(567);
    expect(event.toolName).toBe('product-prd.generate');
  });

  it('200 content length is sensible (between 100 and 10k chars)', async () => {
    mockOpenAIOnce(SAMPLE_PRD);
    const res = await POST(makeReq() as never);
    const body = await res.json();
    expect(body.content.length).toBeGreaterThan(100);
    expect(body.content.length).toBeLessThan(10_000);
  });

  it('strips a wrapping markdown code fence if the model includes one', async () => {
    mockOpenAIOnce('```markdown\n' + SAMPLE_PRD + '\n```');
    const res = await POST(makeReq() as never);
    const body = await res.json();
    expect(body.content.startsWith('# Jane Co')).toBe(true);
    expect(body.content).not.toMatch(/```/);
  });

  it(`429 after ${MAX_PER_HOUR} generations in the same hour`, async () => {
    for (let i = 0; i < MAX_PER_HOUR; i++) {
      mockOpenAIOnce(SAMPLE_PRD);
      // Each call needs its own pair of supabase select responses.
      if (i > 0) {
        selectQueue.push({
          data: {
            title: 'm',
            oneLinePitch: 'p',
            targetCustomer: 'c',
            description: 'd',
          },
          error: null,
        });
        selectQueue.push({ data: null, error: null });
      }
      const ok = await POST(makeReq() as never);
      expect(ok.status).toBe(200);
    }
    const capped = await POST(makeReq() as never);
    expect(capped.status).toBe(429);
    const body = await capped.json();
    expect(body.error).toMatch(/Too many|Limit/);
    expect(chatCreate).toHaveBeenCalledTimes(MAX_PER_HOUR);
  });

  it('rate cap is per-space', async () => {
    for (let i = 0; i < MAX_PER_HOUR; i++) {
      mockOpenAIOnce(SAMPLE_PRD);
      if (i > 0) {
        selectQueue.push({
          data: { title: 'm', oneLinePitch: 'p', targetCustomer: 'c', description: 'd' },
          error: null,
        });
        selectQueue.push({ data: null, error: null });
      }
      await POST(makeReq() as never);
    }
    // Different space gets its own bucket.
    mockGetSpace.mockResolvedValue({ ...SPACE, id: 'space_2' });
    selectQueue.push({
      data: { title: 'm', oneLinePitch: 'p', targetCustomer: 'c', description: 'd' },
      error: null,
    });
    selectQueue.push({ data: null, error: null });
    mockOpenAIOnce(SAMPLE_PRD);
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(200);
  });

  it('falls back to gpt-5-mini when the primary model throws', async () => {
    chatCreate
      .mockRejectedValueOnce(new Error('5xx from gpt-5'))
      .mockResolvedValueOnce({
        choices: [{ message: { content: SAMPLE_PRD } }],
        usage: { prompt_tokens: 800, completion_tokens: 500 },
      });
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(200);
    expect(chatCreate).toHaveBeenCalledTimes(2);
    expect(chatCreate.mock.calls[0][0].model).toBe('gpt-5');
    expect(chatCreate.mock.calls[1][0].model).toBe('gpt-5-mini');
    // CostEvent should reflect the model that actually answered.
    expect(mockEmitCost.mock.calls[0][0].model).toBe('gpt-5-mini');
  });

  it('502 when both primary and fallback models throw', async () => {
    chatCreate
      .mockRejectedValueOnce(new Error('primary down'))
      .mockRejectedValueOnce(new Error('fallback down'));
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/fallback down|primary down|Model/);
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(mockEmitCost).not.toHaveBeenCalled();
  });

  it('502 when the model returns an empty draft', async () => {
    mockOpenAIOnce('   ');
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(502);
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(mockEmitCost).not.toHaveBeenCalled();
  });

  it('502 when OPENAI_API_KEY is not configured', async () => {
    delete process.env.OPENAI_API_KEY;
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(502);
    expect(chatCreate).not.toHaveBeenCalled();
  });

  it('still drafts when Mission and brand-kit are absent (graceful fields)', async () => {
    selectQueue.length = 0;
    selectQueue.push({ data: null, error: null }); // no Mission
    selectQueue.push({ data: null, error: null }); // no brand-kit
    mockLoadMem.mockResolvedValue({ core: {}, working: {}, recent: [] });
    mockOpenAIOnce(SAMPLE_PRD);
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(200);
    const userMsg = chatCreate.mock.calls[0][0].messages[1].content as string;
    expect(userMsg).toMatch(/Mission: \(not set\)/);
    expect(userMsg).toMatch(/Brand voice: \(not set\)/);
  });

  it('passes brand-kit Voice section into the prompt when present', async () => {
    selectQueue.length = 0;
    selectQueue.push({
      data: {
        title: 't',
        oneLinePitch: 'p',
        targetCustomer: 'c',
        description: 'd',
      },
      error: null,
    });
    selectQueue.push({
      data: {
        content: [
          '# Brand kit',
          '',
          '## Voice',
          '',
          'We sound: **direct, dry, never cute**.',
          '',
          '## Palette',
          '',
          '**Primary:** `#000000`',
        ].join('\n'),
      },
      error: null,
    });
    mockOpenAIOnce(SAMPLE_PRD);
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(200);
    const userMsg = chatCreate.mock.calls[0][0].messages[1].content as string;
    expect(userMsg).toMatch(/Brand voice:/);
    expect(userMsg).toMatch(/direct, dry, never cute/);
  });

  it('survives loadMemoryLayers throwing — defaults core memory to empty', async () => {
    mockLoadMem.mockRejectedValueOnce(new Error('vector store down'));
    mockOpenAIOnce(SAMPLE_PRD);
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(200);
  });

  it('does not emit a CostEvent on 502', async () => {
    chatCreate
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom2'));
    await POST(makeReq() as never);
    expect(mockEmitCost).not.toHaveBeenCalled();
  });
});
