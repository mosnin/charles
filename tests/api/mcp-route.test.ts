/**
 * Tests for POST /api/mcp — the public Charles MCP server.
 *
 * Bar:
 *   - 401 when no bearer or bad bearer.
 *   - 429 on IP and on per-space rate limit.
 *   - tools/list returns exactly the 10 Charles tools (no realtor names).
 *   - Happy paths for the four most-load-bearing tools:
 *       workspace_health, get_mission, list_departments, audit_feed.
 *   - GET without auth surfaces resource-metadata for OAuth discovery.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp: vi.fn(() => '1.2.3.4'),
}));

vi.mock('@/lib/observability/audit-feed', () => ({
  loadAuditFeed: vi.fn(async () => [
    {
      id: 'swarm:1:completed',
      type: 'agent_run_completed',
      occurredAt: '2026-05-12T12:00:00.000Z',
      actor: 'agent',
      summary: 'Engineering completed: build something.',
    },
  ]),
}));

vi.mock('@/lib/observability/cost-events', () => ({
  loadRollup: vi.fn(async () => [
    { day: '2026-05-12', department: 'engineering', model: 'gpt-5', totalInputTokens: 1000, totalOutputTokens: 500, totalCostUsd: 0.0125 },
    { day: '2026-05-11', department: 'sales', model: 'gpt-5-mini', totalInputTokens: 200, totalOutputTokens: 100, totalCostUsd: 0.0002 },
  ]),
}));

vi.mock('@/lib/departments/autonomy', async () => {
  const actual = await vi.importActual<typeof import('@/lib/departments/autonomy')>(
    '@/lib/departments/autonomy',
  );
  return {
    ...actual,
    getAllDepartmentAutonomy: vi.fn(async () => ({
      engineering: 'autonomous',
      design: 'ask',
      marketing: 'ask',
      sales: 'observe',
      support: 'ask',
      ops_finance: 'ask',
    })),
  };
});

type Terminal = { data?: unknown; error?: unknown; count?: number };
const { tableQueue } = vi.hoisted(() => ({
  tableQueue: {} as Record<string, Terminal[]>,
}));

vi.mock('@/lib/supabase', () => {
  function chain(table: string) {
    const terminal: Terminal =
      tableQueue[table]?.shift() ?? { data: null, error: null, count: 0 };
    const obj: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'is', 'in', 'not', 'gte', 'lte']) {
      obj[m] = vi.fn(() => obj);
    }
    obj.maybeSingle = vi.fn(() => Promise.resolve(terminal));
    obj.single = vi.fn(() => Promise.resolve(terminal));
    (obj as { then: unknown }).then = (resolve: (v: Terminal) => unknown) =>
      Promise.resolve(terminal).then(resolve);
    obj.insert = vi.fn(() => Promise.resolve({ error: null }));
    obj.update = vi.fn(() => {
      const upd: Record<string, unknown> = {};
      upd.eq = vi.fn(() => Promise.resolve({ error: null }));
      (upd as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ error: null }).then(resolve);
      return upd;
    });
    return obj;
  }
  return { supabase: { from: vi.fn((table: string) => chain(table)) } };
});

import { POST, GET } from '@/app/api/mcp/route';
import { checkRateLimit } from '@/lib/rate-limit';

const mockRate = vi.mocked(checkRateLimit);

// Helper: build a JSON-RPC POST request with a valid bearer.
// The bearer maps to spaceId via the mocked McpApiKey table lookup.
function jsonRpc(method: string, params?: unknown, headers: Record<string, string> = {}): Request {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? {} });
  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: 'Bearer chs_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ...headers,
    },
    body,
  });
}

// Default queues: McpApiKey lookup resolves to spaceId='space_1'.
function primeAuth() {
  tableQueue['McpApiKey'] = [{ data: { spaceId: 'space_1' }, error: null }];
}

async function readJsonRpc(res: Response): Promise<{
  result?: { content?: Array<{ type: string; text: string }>; tools?: Array<{ name: string }> };
  error?: { code: number; message: string };
}> {
  const text = await res.text();
  // Streamable HTTP returns either JSON or SSE; in enableJsonResponse=true it's JSON.
  try {
    return JSON.parse(text);
  } catch {
    // SSE fallback — pick the first `data:` line.
    const line = text.split('\n').find((l) => l.startsWith('data: '));
    if (!line) throw new Error(`Unparseable response: ${text.slice(0, 200)}`);
    return JSON.parse(line.slice(6));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tableQueue)) delete tableQueue[k];
  mockRate.mockResolvedValue({ allowed: true });
});

describe('POST /api/mcp — auth', () => {
  it('401 when no Authorization header', async () => {
    const req = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Bearer');
  });

  it('401 when bearer is unknown', async () => {
    // No row queued — McpApiKey lookup returns null.
    const res = await POST(jsonRpc('tools/list') as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(401);
  });

  it('401 when bearer is too short', async () => {
    const req = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer abc',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/mcp — rate limits', () => {
  it('429 when IP rate limit trips', async () => {
    mockRate.mockResolvedValueOnce({ allowed: false }); // IP limit
    const res = await POST(jsonRpc('tools/list') as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(429);
  });

  it('429 when per-space rate limit trips after auth', async () => {
    primeAuth();
    mockRate
      .mockResolvedValueOnce({ allowed: true }) // IP
      .mockResolvedValueOnce({ allowed: false }); // space
    const res = await POST(jsonRpc('tools/list') as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(429);
  });
});

describe('POST /api/mcp — tools/list', () => {
  it('returns exactly the 10 Charles tools (no realtor names)', async () => {
    primeAuth();
    const res = await POST(jsonRpc('tools/list') as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);
    const body = await readJsonRpc(res);
    const names = (body.result?.tools ?? []).map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'audit_feed',
        'cost_rollup',
        'get_current_stage',
        'get_mission',
        'list_departments',
        'list_integrations',
        'list_pending_approvals',
        'list_recent_runs',
        'recent_drafts',
        'workspace_health',
      ].sort(),
    );
    // No realtor names sneaking back in.
    for (const dead of ['list_contacts', 'get_contact', 'list_deals', 'get_deal', 'list_tours', 'list_notes', 'follow_ups_due', 'dashboard_summary', 'list_calendar_events']) {
      expect(names).not.toContain(dead);
    }
  });
});

describe('POST /api/mcp — tools/call happy paths', () => {
  it('workspace_health returns the snapshot shape', async () => {
    primeAuth();
    // Mission, then four head-count queries, then nothing for rollup (mocked).
    tableQueue['Mission'] = [{ data: { stage: 'building' }, error: null }];
    tableQueue['StageGate'] = [{ data: null, error: null, count: 2 }];
    tableQueue['AgentDraft'] = [{ data: null, error: null, count: 3 }];
    tableQueue['AgentPausedRun'] = [{ data: null, error: null, count: 1 }];
    tableQueue['IntegrationConnection'] = [{ data: null, error: null, count: 4 }];

    const res = await POST(
      jsonRpc('tools/call', { name: 'workspace_health', arguments: {} }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const body = await readJsonRpc(res);
    const text = body.result?.content?.[0]?.text ?? '';
    const parsed = JSON.parse(text);
    expect(parsed.stage).toBe('building');
    expect(parsed.gatesRemaining).toBe(2);
    expect(parsed.pendingApprovals).toBe(4); // 3 drafts + 1 paused
    expect(parsed.activeIntegrations).toBe(4);
    expect(typeof parsed.last7DaysCostUsd).toBe('number');
  });

  it('get_mission returns mission + core memory map', async () => {
    primeAuth();
    tableQueue['Mission'] = [
      {
        data: {
          title: 'Charles',
          oneLinePitch: 'AI cofounder.',
          targetCustomer: 'Solo founders.',
          stage: 'building',
          description: null,
        },
        error: null,
      },
    ];
    tableQueue['CoreMemory'] = [
      {
        data: [
          { slot: 'voice', value: 'calm' },
          { slot: 'audience', value: null },
        ],
        error: null,
      },
    ];

    const res = await POST(
      jsonRpc('tools/call', { name: 'get_mission', arguments: {} }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const body = await readJsonRpc(res);
    const parsed = JSON.parse(body.result?.content?.[0]?.text ?? '{}');
    expect(parsed.mission.title).toBe('Charles');
    expect(parsed.core.voice).toBe('calm');
    expect(parsed.core.audience).toBeNull();
  });

  it('list_departments returns all six with autonomy levels', async () => {
    primeAuth();
    const res = await POST(
      jsonRpc('tools/call', { name: 'list_departments', arguments: {} }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const body = await readJsonRpc(res);
    const parsed = JSON.parse(body.result?.content?.[0]?.text ?? '{}');
    expect(parsed.departments).toHaveLength(6);
    const eng = parsed.departments.find((d: { slug: string }) => d.slug === 'engineering');
    expect(eng.autonomyLevel).toBe('autonomous');
  });

  it('audit_feed returns events from loadAuditFeed', async () => {
    primeAuth();
    const res = await POST(
      jsonRpc('tools/call', { name: 'audit_feed', arguments: { limit: 10 } }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const body = await readJsonRpc(res);
    const parsed = JSON.parse(body.result?.content?.[0]?.text ?? '{}');
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0].type).toBe('agent_run_completed');
  });

  it('get_current_stage merges stage catalog with StageGate completion', async () => {
    primeAuth();
    tableQueue['Mission'] = [{ data: { stage: 'idea' }, error: null }];
    tableQueue['StageGate'] = [
      {
        data: [
          { title: 'Define your company in one sentence', isComplete: true, completedAt: '2026-05-10T00:00:00.000Z' },
        ],
        error: null,
      },
    ];
    const res = await POST(
      jsonRpc('tools/call', { name: 'get_current_stage', arguments: {} }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const body = await readJsonRpc(res);
    const parsed = JSON.parse(body.result?.content?.[0]?.text ?? '{}');
    expect(parsed.slug).toBe('idea');
    expect(parsed.gates.length).toBeGreaterThan(0);
    const one = parsed.gates.find((g: { title: string }) => g.title === 'Define your company in one sentence');
    expect(one.isComplete).toBe(true);
  });
});

describe('GET /api/mcp', () => {
  it('401 without auth + WWW-Authenticate to resource metadata', async () => {
    const res = await GET(
      new Request('http://localhost/api/mcp') as unknown as Parameters<typeof GET>[0],
    );
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('oauth-protected-resource');
  });

  it('405 with auth header (SSE not supported in stateless mode)', async () => {
    const res = await GET(
      new Request('http://localhost/api/mcp', {
        headers: { Authorization: 'Bearer chs_anything' },
      }) as unknown as Parameters<typeof GET>[0],
    );
    expect(res.status).toBe(405);
  });
});
