/**
 * Route tests for /api/agent-templates/[id]/subagents (POST) and
 * /api/agent-templates/[id]/subagents/[subId] (PATCH, DELETE).
 *
 * The critical paths:
 *   - Auth + ownership through the parent CustomAgent.
 *   - Tool validation against the live ALL_TOOLS registry — unknown names
 *     come back with a `missing` array.
 *   - Role validation against SUBAGENT_ROLES.
 *   - Reorder via PATCH order.
 *   - Cross-tenant access: subagent under a different agent → 404.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { ALL_TOOLS } from '@/lib/ai-tools/tools';

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
    update: [] as Array<{ table: string; payload: Record<string, unknown> }>,
    delete: [] as Array<{ table: string }>,
  },
}));

function nextTerminal(table: keyof typeof tableQueue): Terminal {
  return tableQueue[table].shift() ?? { data: null, error: null };
}

vi.mock('@/lib/supabase', () => {
  function chain(table: keyof typeof tableQueue) {
    const obj: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'limit', 'in']) {
      obj[m] = vi.fn(() => obj);
    }
    obj.eq = vi.fn(() => {
      const next: Record<string, unknown> = { ...obj };
      (next as { then: unknown }).then = (resolve: (v: Terminal) => unknown) =>
        Promise.resolve(nextTerminal(table)).then(resolve);
      return next;
    });
    obj.maybeSingle = vi.fn(() => Promise.resolve(nextTerminal(table)));
    obj.single = vi.fn(() => Promise.resolve(nextTerminal(table)));

    obj.insert = vi.fn((payload: Record<string, unknown>) => {
      calls.insert.push({ table, payload });
      const ins: Record<string, unknown> = {};
      ins.select = vi.fn(() => ins);
      ins.single = vi.fn(() => {
        const terminal = nextTerminal(table);
        if (terminal.data || terminal.error) return Promise.resolve(terminal);
        return Promise.resolve({
          data: {
            id: 'sub_new',
            customAgentId: payload.customAgentId,
            name: payload.name,
            role: payload.role,
            instructions: payload.instructions ?? '',
            tools: payload.tools ?? [],
            order: payload.order ?? 0,
            createdAt: '2026-05-13T00:00:00.000Z',
          },
          error: null,
        });
      });
      return ins;
    });

    obj.update = vi.fn((payload: Record<string, unknown>) => {
      calls.update.push({ table, payload });
      const upd: Record<string, unknown> = {};
      upd.eq = vi.fn(() => Promise.resolve({ error: null }));
      return upd;
    });

    obj.delete = vi.fn(() => {
      const del: Record<string, unknown> = {};
      del.eq = vi.fn(() => {
        calls.delete.push({ table });
        return Promise.resolve({ error: null });
      });
      return del;
    });

    return obj;
  }
  return {
    supabase: {
      from: vi.fn((table: string) => chain(table as keyof typeof tableQueue)),
    },
  };
});

import { POST } from '@/app/api/agent-templates/[id]/subagents/route';
import {
  PATCH,
  DELETE,
} from '@/app/api/agent-templates/[id]/subagents/[subId]/route';
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

const AGENT_OWNED = { id: 'agent_1', spaceId: 'space_1' };
const AGENT_OTHER = { id: 'agent_1', spaceId: 'other_space' };

function postReq(body: unknown): NextRequest {
  return new NextRequest(
    'http://localhost/api/agent-templates/agent_1/subagents',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
  );
}
function patchReq(body: unknown): NextRequest {
  return new NextRequest(
    'http://localhost/api/agent-templates/agent_1/subagents/sub_1',
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
  );
}
function deleteReq(): NextRequest {
  return new NextRequest(
    'http://localhost/api/agent-templates/agent_1/subagents/sub_1',
    { method: 'DELETE' },
  );
}

const parentCtx = { params: Promise.resolve({ id: 'agent_1' }) };
const subCtx = {
  params: Promise.resolve({ id: 'agent_1', subId: 'sub_1' }),
};

beforeEach(() => {
  vi.clearAllMocks();
  tableQueue.CustomAgent.length = 0;
  tableQueue.AgentSubAgent.length = 0;
  calls.insert.length = 0;
  calls.update.length = 0;
  calls.delete.length = 0;
  mockAuth.mockResolvedValue({ userId: 'user_clerk_1' });
  mockGetSpace.mockResolvedValue(SPACE);
});

// ── POST /subagents ─────────────────────────────────────────────────────────

describe('POST /api/agent-templates/[id]/subagents', () => {
  it('401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await POST(
      postReq({ name: 'Researcher', role: 'research' }),
      parentCtx,
    );
    expect(res.status).toBe(401);
  });

  it('404 when the parent agent does not exist', async () => {
    tableQueue.CustomAgent.push({ data: null, error: null });
    const res = await POST(
      postReq({ name: 'Researcher', role: 'research' }),
      parentCtx,
    );
    expect(res.status).toBe(404);
  });

  it('403 when the parent agent is in a different workspace', async () => {
    tableQueue.CustomAgent.push({ data: AGENT_OTHER, error: null });
    const res = await POST(
      postReq({ name: 'Researcher', role: 'research' }),
      parentCtx,
    );
    expect(res.status).toBe(403);
  });

  it('400 on empty name', async () => {
    tableQueue.CustomAgent.push({ data: AGENT_OWNED, error: null });
    const res = await POST(postReq({ name: '  ', role: 'research' }), parentCtx);
    expect(res.status).toBe(400);
  });

  it('400 on unknown role', async () => {
    tableQueue.CustomAgent.push({ data: AGENT_OWNED, error: null });
    const res = await POST(
      postReq({ name: 'X', role: 'writer' }),
      parentCtx,
    );
    expect(res.status).toBe(400);
  });

  it('400 with `missing` list when tools include unknown names', async () => {
    tableQueue.CustomAgent.push({ data: AGENT_OWNED, error: null });
    // The "no existing subagents" lookup for next-order.
    tableQueue.AgentSubAgent.push({ data: null, error: null });
    const res = await POST(
      postReq({
        name: 'X',
        role: 'research',
        tools: ['find_person', 'frobnicate', 'send_email', 'bogus_tool'],
      }),
      parentCtx,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; missing: string[] };
    expect(body.error).toMatch(/unknown/i);
    expect(body.missing.sort()).toEqual(['bogus_tool', 'frobnicate']);
  });

  it('200 happy path: known tools are accepted; order seeded from max+1', async () => {
    const known = ALL_TOOLS[0].name;
    tableQueue.CustomAgent.push({ data: AGENT_OWNED, error: null });
    tableQueue.AgentSubAgent.push({ data: { order: 3 }, error: null });
    const res = await POST(
      postReq({
        name: 'Pat',
        role: 'execution',
        instructions: 'Do the thing.',
        tools: [known],
      }),
      parentCtx,
    );
    expect(res.status).toBe(200);
    const payload = calls.insert[0].payload;
    expect(payload.customAgentId).toBe('agent_1');
    expect(payload.role).toBe('execution');
    expect(payload.tools).toEqual([known]);
    expect(payload.order).toBe(4);
  });

  it('200 dedupes the tools array', async () => {
    const known = ALL_TOOLS[0].name;
    tableQueue.CustomAgent.push({ data: AGENT_OWNED, error: null });
    tableQueue.AgentSubAgent.push({ data: null, error: null });
    const res = await POST(
      postReq({
        name: 'Pat',
        role: 'execution',
        tools: [known, known, known],
      }),
      parentCtx,
    );
    expect(res.status).toBe(200);
    expect(calls.insert[0].payload.tools).toEqual([known]);
  });
});

// ── PATCH /subagents/[subId] ────────────────────────────────────────────────

describe('PATCH /api/agent-templates/[id]/subagents/[subId]', () => {
  it('401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await PATCH(patchReq({ name: 'New' }), subCtx);
    expect(res.status).toBe(401);
  });

  it('404 when the subagent does not exist on this parent', async () => {
    tableQueue.CustomAgent.push({ data: AGENT_OWNED, error: null });
    tableQueue.AgentSubAgent.push({ data: null, error: null });
    const res = await PATCH(patchReq({ name: 'New' }), subCtx);
    expect(res.status).toBe(404);
  });

  it('404 when the subagent belongs to a different parent agent', async () => {
    tableQueue.CustomAgent.push({ data: AGENT_OWNED, error: null });
    tableQueue.AgentSubAgent.push({
      data: { id: 'sub_1', customAgentId: 'agent_DIFFERENT' },
      error: null,
    });
    const res = await PATCH(patchReq({ name: 'New' }), subCtx);
    expect(res.status).toBe(404);
  });

  it('400 when no fields are sent', async () => {
    tableQueue.CustomAgent.push({ data: AGENT_OWNED, error: null });
    tableQueue.AgentSubAgent.push({
      data: { id: 'sub_1', customAgentId: 'agent_1' },
      error: null,
    });
    const res = await PATCH(patchReq({}), subCtx);
    expect(res.status).toBe(400);
  });

  it('400 with `missing` list when patching unknown tools', async () => {
    tableQueue.CustomAgent.push({ data: AGENT_OWNED, error: null });
    tableQueue.AgentSubAgent.push({
      data: { id: 'sub_1', customAgentId: 'agent_1' },
      error: null,
    });
    const res = await PATCH(
      patchReq({ tools: ['totally_made_up_tool'] }),
      subCtx,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { missing: string[] };
    expect(body.missing).toEqual(['totally_made_up_tool']);
  });

  it('400 when order is not an integer', async () => {
    tableQueue.CustomAgent.push({ data: AGENT_OWNED, error: null });
    tableQueue.AgentSubAgent.push({
      data: { id: 'sub_1', customAgentId: 'agent_1' },
      error: null,
    });
    const res = await PATCH(patchReq({ order: 1.5 }), subCtx);
    expect(res.status).toBe(400);
  });

  it('200 happy path: rename via PATCH', async () => {
    tableQueue.CustomAgent.push({ data: AGENT_OWNED, error: null });
    tableQueue.AgentSubAgent.push({
      data: { id: 'sub_1', customAgentId: 'agent_1' },
      error: null,
    });
    const res = await PATCH(patchReq({ name: 'Renamed' }), subCtx);
    expect(res.status).toBe(200);
    expect(calls.update[0].payload.name).toBe('Renamed');
  });

  it('200 reorder via PATCH order', async () => {
    tableQueue.CustomAgent.push({ data: AGENT_OWNED, error: null });
    tableQueue.AgentSubAgent.push({
      data: { id: 'sub_1', customAgentId: 'agent_1' },
      error: null,
    });
    const res = await PATCH(patchReq({ order: 2 }), subCtx);
    expect(res.status).toBe(200);
    expect(calls.update[0].payload.order).toBe(2);
  });
});

// ── DELETE /subagents/[subId] ───────────────────────────────────────────────

describe('DELETE /api/agent-templates/[id]/subagents/[subId]', () => {
  it('200 happy path', async () => {
    tableQueue.CustomAgent.push({ data: AGENT_OWNED, error: null });
    tableQueue.AgentSubAgent.push({
      data: { id: 'sub_1', customAgentId: 'agent_1' },
      error: null,
    });
    const res = await DELETE(deleteReq(), subCtx);
    expect(res.status).toBe(200);
    expect(calls.delete).toHaveLength(1);
    expect(calls.delete[0].table).toBe('AgentSubAgent');
  });

  it('404 when the subagent is missing', async () => {
    tableQueue.CustomAgent.push({ data: AGENT_OWNED, error: null });
    tableQueue.AgentSubAgent.push({ data: null, error: null });
    const res = await DELETE(deleteReq(), subCtx);
    expect(res.status).toBe(404);
    expect(calls.delete).toHaveLength(0);
  });

  it('403 when the parent agent is in another workspace', async () => {
    tableQueue.CustomAgent.push({ data: AGENT_OTHER, error: null });
    const res = await DELETE(deleteReq(), subCtx);
    expect(res.status).toBe(403);
  });
});
