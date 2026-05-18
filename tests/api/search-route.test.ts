/**
 * GET /api/search — content search for the command palette.
 *
 * The bar:
 *   - 401 unauth + never touches the DB.
 *   - 403 when the caller has no workspace.
 *   - 200 with empty arrays when q is too short.
 *   - 200 with mixed results across the four kinds when each query succeeds.
 *   - One kind failing surfaces [] for that kind, never blocks the others.
 *   - Limit param clamped to 30; bad values fall back to default.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/space', () => ({
  getSpaceForUser: vi.fn(),
}));

// Per-table queue of results the next call against that table will see.
type Settled = { data?: unknown; error?: unknown; throws?: Error };
const { tableQueue, lastLimit } = vi.hoisted(() => ({
  tableQueue: {
    Document: [] as Settled[],
    Task: [] as Settled[],
    StageGate: [] as Settled[],
    AgentDraft: [] as Settled[],
  },
  lastLimit: { value: 0 as number },
}));

vi.mock('@/lib/supabase', () => {
  function chain(table: string) {
    const queue = tableQueue[table as keyof typeof tableQueue];
    const terminal: Settled = queue?.shift() ?? { data: [], error: null };

    const settle = () => {
      if (terminal.throws) return Promise.reject(terminal.throws);
      return Promise.resolve({ data: terminal.data ?? null, error: terminal.error ?? null });
    };

    const obj: Record<string, unknown> = {};
    obj.select = vi.fn(() => obj);
    obj.eq = vi.fn(() => obj);
    obj.or = vi.fn(() => obj);
    obj.ilike = vi.fn(() => obj);
    obj.limit = vi.fn((n: number) => {
      lastLimit.value = n;
      const thenable: Record<string, unknown> = { ...obj };
      thenable.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        settle().then(resolve, reject);
      return thenable;
    });
    return obj;
  }
  return { supabase: { from: vi.fn((table: string) => chain(table)) } };
});

import { GET } from '@/app/api/search/route';
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

function makeReq(query: string = ''): Parameters<typeof GET>[0] {
  return new NextRequest(`http://localhost/api/search${query}`);
}

function resetQueues() {
  tableQueue.Document.length = 0;
  tableQueue.Task.length = 0;
  tableQueue.StageGate.length = 0;
  tableQueue.AgentDraft.length = 0;
  lastLimit.value = 0;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetQueues();
  mockAuth.mockResolvedValue({ userId: 'user_clerk_1' });
  mockGetSpace.mockResolvedValue(SPACE);
});

describe('GET /api/search — auth', () => {
  it('returns 401 when unauthenticated and never queries the workspace', async () => {
    const unauth = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    mockAuth.mockResolvedValue(unauth);
    const res = await GET(makeReq('?q=hello'));
    expect(res.status).toBe(401);
    expect(mockGetSpace).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller has no workspace', async () => {
    mockGetSpace.mockResolvedValue(null);
    const res = await GET(makeReq('?q=hello'));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/search — query length', () => {
  it('returns empty arrays when q is missing', async () => {
    const res = await GET(makeReq(''));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { documents: unknown[]; tasks: unknown[]; gates: unknown[]; drafts: unknown[] };
    expect(body).toEqual({ documents: [], tasks: [], gates: [], drafts: [] });
  });

  it('returns empty arrays when q is a single character', async () => {
    const res = await GET(makeReq('?q=a'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { documents: unknown[] };
    expect(body.documents).toEqual([]);
  });

  it('returns empty arrays when q is only whitespace', async () => {
    const res = await GET(makeReq('?q=%20%20'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { documents: unknown[] };
    expect(body.documents).toEqual([]);
  });
});

describe('GET /api/search — mixed results', () => {
  it('returns 200 with all four kinds when each query succeeds', async () => {
    tableQueue.Document.push({
      data: [{ id: 'd1', slug: 'business-plan', title: 'Business plan', content: 'A plan for hello world.' }],
    });
    tableQueue.Task.push({
      data: [{ id: 't1', title: 'Say hello', description: 'do it', status: 'open', priority: 'high' }],
    });
    tableQueue.StageGate.push({
      data: [{ id: 'g1', title: 'Hello onboarding', stage: 'idea', isComplete: false }],
    });
    tableQueue.AgentDraft.push({
      data: [{ id: 'a1', subject: 'Hello again', content: 'Body of draft', status: 'pending' }],
    });

    const res = await GET(makeReq('?q=hello'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      documents: Array<{ id: string; slug: string; href: string; snippet: string }>;
      tasks: Array<{ id: string; href: string; status: string }>;
      gates: Array<{ id: string; href: string; stage: string }>;
      drafts: Array<{ id: string; href: string }>;
    };

    expect(body.documents).toHaveLength(1);
    expect(body.documents[0].href).toBe('/documents/business-plan');
    expect(body.documents[0].snippet).toContain('hello');

    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].href).toBe('/tasks/t1');
    expect(body.tasks[0].status).toBe('open');

    expect(body.gates).toHaveLength(1);
    expect(body.gates[0].href).toBe('/stages/gates/g1');
    expect(body.gates[0].stage).toBe('idea');

    expect(body.drafts).toHaveLength(1);
    expect(body.drafts[0].href).toBe('/inbox');
  });
});

describe('GET /api/search — partial failures', () => {
  it('one kind failing returns [] for that kind only', async () => {
    tableQueue.Document.push({ throws: new Error('boom') });
    tableQueue.Task.push({
      data: [{ id: 't1', title: 'hello', description: '', status: 'open', priority: 'normal' }],
    });
    tableQueue.StageGate.push({ data: [] });
    tableQueue.AgentDraft.push({ data: [] });

    const res = await GET(makeReq('?q=hello'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      documents: unknown[];
      tasks: unknown[];
      gates: unknown[];
      drafts: unknown[];
    };
    expect(body.documents).toEqual([]);
    expect(body.tasks).toHaveLength(1);
    expect(body.gates).toEqual([]);
    expect(body.drafts).toEqual([]);
  });

  it('a kind returning a Supabase error becomes []', async () => {
    tableQueue.Document.push({ data: null, error: { message: 'connection refused' } });
    tableQueue.Task.push({ data: [] });
    tableQueue.StageGate.push({ data: [] });
    tableQueue.AgentDraft.push({ data: [] });

    const res = await GET(makeReq('?q=hello'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { documents: unknown[] };
    expect(body.documents).toEqual([]);
  });
});

describe('GET /api/search — limit clamping', () => {
  it('clamps limit > 30 to 30', async () => {
    tableQueue.Document.push({ data: [] });
    tableQueue.Task.push({ data: [] });
    tableQueue.StageGate.push({ data: [] });
    tableQueue.AgentDraft.push({ data: [] });

    const res = await GET(makeReq('?q=hello&limit=999'));
    expect(res.status).toBe(200);
    expect(lastLimit.value).toBe(30);
  });

  it('non-numeric limit falls back to default (10)', async () => {
    tableQueue.Document.push({ data: [] });
    tableQueue.Task.push({ data: [] });
    tableQueue.StageGate.push({ data: [] });
    tableQueue.AgentDraft.push({ data: [] });

    const res = await GET(makeReq('?q=hello&limit=banana'));
    expect(res.status).toBe(200);
    expect(lastLimit.value).toBe(10);
  });

  it('respects explicit limit within range', async () => {
    tableQueue.Document.push({ data: [] });
    tableQueue.Task.push({ data: [] });
    tableQueue.StageGate.push({ data: [] });
    tableQueue.AgentDraft.push({ data: [] });

    const res = await GET(makeReq('?q=hello&limit=5'));
    expect(res.status).toBe(200);
    expect(lastLimit.value).toBe(5);
  });
});

describe('GET /api/search — sanitization', () => {
  it('strips PostgREST syntax chars; pure-noise queries return empty', async () => {
    const res = await GET(makeReq('?q=,(,)'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { documents: unknown[] };
    expect(body.documents).toEqual([]);
  });
});

describe('GET /api/search — snippets', () => {
  it('snippet centers on the match when content is long', async () => {
    const long = 'x'.repeat(60) + 'NEEDLE inside the haystack ' + 'y'.repeat(200);
    tableQueue.Document.push({
      data: [{ id: 'd1', slug: 'pitch-deck', title: 'Pitch', content: long }],
    });
    tableQueue.Task.push({ data: [] });
    tableQueue.StageGate.push({ data: [] });
    tableQueue.AgentDraft.push({ data: [] });

    const res = await GET(makeReq('?q=NEEDLE'));
    const body = (await res.json()) as { documents: Array<{ snippet: string }> };
    expect(body.documents[0].snippet).toContain('NEEDLE');
    expect(body.documents[0].snippet.length).toBeLessThanOrEqual(200);
  });
});
