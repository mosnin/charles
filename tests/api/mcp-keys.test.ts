/**
 * Tests for /api/mcp-keys — list, create (chs_ prefix), revoke.
 *
 * Bar:
 *   - 401 when unauthenticated.
 *   - 404 when caller has no space.
 *   - 429 when key creation rate limit trips.
 *   - 400 at 20-key cap.
 *   - 201 on create with `chs_` raw key and prefix recorded.
 *   - 200 on revoke; 404 when revoking a key not in this space; 400 missing id.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

vi.mock('@/lib/api-auth', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/space', () => ({ getSpaceForUser: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
}));

type Terminal = { data?: unknown; error?: unknown; count?: number };
const { tableQueue, calls } = vi.hoisted(() => ({
  tableQueue: {} as Record<string, Terminal[]>,
  calls: {
    insert: [] as Array<{ table: string; payload: Record<string, unknown> }>,
    delete: [] as Array<{ table: string; id?: string }>,
  },
}));

vi.mock('@/lib/supabase', () => {
  function chain(table: string) {
    const terminal: Terminal = tableQueue[table]?.shift() ?? { data: null, error: null, count: 0 };
    const obj: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'is', 'in']) {
      obj[m] = vi.fn(() => obj);
    }
    obj.maybeSingle = vi.fn(() => Promise.resolve(terminal));
    obj.single = vi.fn(() => Promise.resolve(terminal));
    (obj as { then: unknown }).then = (resolve: (v: Terminal) => unknown) =>
      Promise.resolve(terminal).then(resolve);
    obj.insert = vi.fn((payload: Record<string, unknown>) => {
      calls.insert.push({ table, payload });
      const ins: Record<string, unknown> = {};
      ins.select = vi.fn(() => ins);
      ins.single = vi.fn(() =>
        Promise.resolve({
          data: {
            id: 'key_1',
            name: payload.name,
            keyPrefix: payload.keyPrefix,
            createdAt: '2026-05-13T00:00:00.000Z',
            clientId: payload.clientId,
          },
          error: null,
        }),
      );
      return ins;
    });
    obj.delete = vi.fn(() => {
      const del: Record<string, unknown> = {};
      del.eq = vi.fn((_col: string, val: string) => {
        calls.delete.push({ table, id: val });
        return Promise.resolve({ error: null });
      });
      return del;
    });
    obj.update = vi.fn(() => {
      const upd: Record<string, unknown> = {};
      upd.eq = vi.fn(() => Promise.resolve({ error: null }));
      return upd;
    });
    return obj;
  }
  return { supabase: { from: vi.fn((table: string) => chain(table)) } };
});

import { GET, POST, DELETE } from '@/app/api/mcp-keys/route';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { checkRateLimit } from '@/lib/rate-limit';

const mockAuth = vi.mocked(requireAuth);
const mockGetSpace = vi.mocked(getSpaceForUser);
const mockRate = vi.mocked(checkRateLimit);

const SPACE = {
  id: 'space_1',
  slug: 'jane',
  name: 'Jane',
  emoji: null,
  ownerId: 'user_db_1',
  brokerageId: null,
  createdAt: '2026-04-01T00:00:00.000Z',
} as unknown as NonNullable<Awaited<ReturnType<typeof getSpaceForUser>>>;

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tableQueue)) delete tableQueue[k];
  calls.insert.length = 0;
  calls.delete.length = 0;
  mockAuth.mockResolvedValue({ userId: 'user_clerk_1' });
  mockGetSpace.mockResolvedValue(SPACE);
  mockRate.mockResolvedValue({ allowed: true });
});

function req(method: 'GET' | 'POST' | 'DELETE', body?: unknown): NextRequest {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return new Request('http://localhost/api/mcp-keys', init) as unknown as NextRequest;
}

describe('GET /api/mcp-keys', () => {
  it('401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await GET(req('GET'));
    expect(res.status).toBe(401);
  });

  it('404 when caller has no space', async () => {
    mockGetSpace.mockResolvedValue(null);
    const res = await GET(req('GET'));
    expect(res.status).toBe(404);
  });

  it('returns the list of keys for the space', async () => {
    tableQueue['McpApiKey'] = [
      {
        data: [
          { id: 'k1', name: 'Default', keyPrefix: 'chs_abc...', lastUsedAt: null, createdAt: '2026-05-01T00:00:00.000Z' },
        ],
        error: null,
      },
    ];
    const res = await GET(req('GET'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { keys: Array<{ keyPrefix: string }> };
    expect(body.keys[0].keyPrefix).toBe('chs_abc...');
  });
});

describe('POST /api/mcp-keys', () => {
  it('401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await POST(req('POST', { name: 'a' }));
    expect(res.status).toBe(401);
  });

  it('429 when rate limit trips', async () => {
    mockRate.mockResolvedValue({ allowed: false });
    const res = await POST(req('POST', { name: 'a' }));
    expect(res.status).toBe(429);
  });

  it('400 when workspace already has 20 keys', async () => {
    // First chain call is the count() query (head: true).
    tableQueue['McpApiKey'] = [{ data: null, error: null, count: 20 }];
    const res = await POST(req('POST', { name: 'a' }));
    expect(res.status).toBe(400);
  });

  it('creates a key with chs_ prefix and returns the raw value once', async () => {
    // count(), then insert returns the row via .single().
    tableQueue['McpApiKey'] = [{ data: null, error: null, count: 0 }];
    const res = await POST(req('POST', { name: 'Claude Desktop' }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      key: string;
      clientId: string;
      clientSecret: string;
      tokenUrl: string;
      mcpUrl: string;
    };
    expect(body.key).toMatch(/^chs_[a-f0-9]{48}$/);
    expect(body.clientId).toMatch(/^chs_[a-f0-9]{32}$/);
    expect(body.clientSecret).toMatch(/^cs_[a-f0-9]{64}$/);
    expect(body.mcpUrl.endsWith('/api/mcp')).toBe(true);
    expect(body.tokenUrl.endsWith('/api/mcp/oauth/token')).toBe(true);
    expect(body.mcpUrl).not.toContain('usechippi');
    // Insert was called once with chs_ prefix in keyPrefix.
    expect(calls.insert).toHaveLength(1);
    expect(calls.insert[0].table).toBe('McpApiKey');
    expect(String(calls.insert[0].payload.keyPrefix)).toMatch(/^chs_/);
  });

  it('sanitises the name (strip angle/quote characters, cap 100)', async () => {
    tableQueue['McpApiKey'] = [{ data: null, error: null, count: 0 }];
    const res = await POST(req('POST', { name: '<script>"alert"</script>' + 'x'.repeat(200) }));
    expect(res.status).toBe(201);
    const payload = calls.insert[0].payload;
    const name = String(payload.name);
    expect(name).not.toContain('<');
    expect(name).not.toContain('>');
    expect(name).not.toContain('"');
    expect(name.length).toBeLessThanOrEqual(100);
  });
});

describe('DELETE /api/mcp-keys', () => {
  it('401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await DELETE(req('DELETE', { id: 'k1' }));
    expect(res.status).toBe(401);
  });

  it('400 when id missing', async () => {
    const res = await DELETE(req('DELETE', {}));
    expect(res.status).toBe(400);
  });

  it('404 when key does not belong to caller space', async () => {
    tableQueue['McpApiKey'] = [{ data: null, error: null }];
    const res = await DELETE(req('DELETE', { id: 'k_other' }));
    expect(res.status).toBe(404);
  });

  it('200 when key is owned and deleted', async () => {
    tableQueue['McpApiKey'] = [{ data: { id: 'k1' }, error: null }];
    const res = await DELETE(req('DELETE', { id: 'k1' }));
    expect(res.status).toBe(200);
    expect(calls.delete.some((c) => c.id === 'k1')).toBe(true);
  });
});
