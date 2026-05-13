/**
 * GET /api/documents — workspace documents path (no contactId).
 *
 * The bar:
 *   - 401 unauth                        — never touches the DB.
 *   - 403 no workspace                  — never touches the DB.
 *   - 200 returns nine entries even when DB has zero rows.
 *   - 200 surfaces hasContent / updatedAt when a DB row exists with content.
 *   - 500 with a generic message on DB failure (no internals leaked).
 *
 * The legacy `?contactId=...` shape is owned by the original contact-uploads
 * test surface; this file covers only the workspace-docs branch added by the
 * documents feature.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(),
  // requireContactAccess isn't exercised in the workspace-docs branch but the
  // route imports it from the same module, so we stub it to a no-op.
  requireContactAccess: vi.fn(),
}));

vi.mock('@/lib/space', () => ({
  getSpaceForUser: vi.fn(),
}));

// Per-table queue lets each test queue the (data, error) the route will see.
const { tableQueue } = vi.hoisted(() => ({
  tableQueue: { Document: [] as Array<{ data?: unknown; error?: unknown }> },
}));

vi.mock('@/lib/supabase', () => {
  function chain(table: string) {
    const terminal =
      tableQueue[table as keyof typeof tableQueue]?.shift() ?? { data: [], error: null };
    const obj: Record<string, unknown> = {};
    // `.eq()` is the terminal call here — the route awaits its result.
    obj.select = vi.fn(() => obj);
    obj.order = vi.fn(() => obj);
    obj.limit = vi.fn(() => obj);
    obj.maybeSingle = vi.fn(() => Promise.resolve(terminal));
    obj.single = vi.fn(() => Promise.resolve(terminal));
    // .eq() returns a thenable that resolves to terminal, so `await query` works.
    obj.eq = vi.fn(() => {
      const next: Record<string, unknown> = { ...obj };
      next.then = (resolve: (v: unknown) => unknown) => Promise.resolve(terminal).then(resolve);
      return next;
    });
    return obj;
  }
  return { supabase: { from: vi.fn((table: string) => chain(table)) } };
});

import { GET } from '@/app/api/documents/route';
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
  return new NextRequest(`http://localhost/api/documents${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  tableQueue.Document.length = 0;
  mockAuth.mockResolvedValue({ userId: 'user_clerk_1' });
  mockGetSpace.mockResolvedValue(SPACE);
});

describe('GET /api/documents — auth', () => {
  it('returns 401 when unauthenticated and never queries the workspace', async () => {
    const unauth = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    mockAuth.mockResolvedValue(unauth);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(mockGetSpace).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller has no workspace', async () => {
    mockGetSpace.mockResolvedValue(null);
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/workspace/i);
  });
});

describe('GET /api/documents — empty workspace (no rows)', () => {
  it('returns 200 with all nine catalog entries when DB has zero rows', async () => {
    tableQueue.Document.push({ data: [], error: null });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      documents: Array<{
        slug: string;
        title: string;
        blurb: string;
        group: string;
        hasContent: boolean;
        updatedAt: string | null;
      }>;
    };
    expect(body.documents).toHaveLength(9);
    for (const doc of body.documents) {
      expect(doc.hasContent).toBe(false);
      expect(doc.updatedAt).toBeNull();
      expect(doc.title.length).toBeGreaterThan(0);
      expect(doc.blurb.length).toBeGreaterThan(0);
    }
  });

  it('covers every catalogue slug in the response', async () => {
    tableQueue.Document.push({ data: [], error: null });
    const res = await GET(makeReq());
    const body = (await res.json()) as { documents: Array<{ slug: string }> };
    const slugs = body.documents.map((d) => d.slug).sort();
    expect(slugs).toEqual(
      [
        'brand-kit',
        'business-model-canvas',
        'business-plan',
        'executive-summary',
        'growth-blueprint',
        'marketing-plan',
        'pitch-deck',
        'product-prd',
        'sales-plan',
      ].sort(),
    );
  });

  it('groups: mission(2) + identity(2) + strategy(2) + execution(3) = 9', async () => {
    tableQueue.Document.push({ data: [], error: null });
    const res = await GET(makeReq());
    const body = (await res.json()) as { documents: Array<{ group: string }> };
    const counts: Record<string, number> = {};
    for (const d of body.documents) counts[d.group] = (counts[d.group] ?? 0) + 1;
    expect(counts).toEqual({ mission: 2, identity: 2, strategy: 2, execution: 3 });
  });
});

describe('GET /api/documents — rows present', () => {
  it('marks hasContent=true and surfaces updatedAt when a row has content', async () => {
    const stamp = '2026-05-01T12:00:00.000Z';
    tableQueue.Document.push({
      data: [
        { slug: 'executive-summary', content: '# Hello\n\nReal content.', updatedAt: stamp },
        { slug: 'pitch-deck', content: '', updatedAt: stamp },
      ],
      error: null,
    });

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      documents: Array<{ slug: string; hasContent: boolean; updatedAt: string | null }>;
    };

    const exec = body.documents.find((d) => d.slug === 'executive-summary');
    expect(exec).toBeDefined();
    expect(exec?.hasContent).toBe(true);
    expect(exec?.updatedAt).toBe(stamp);

    // Pitch deck row exists but content is blank → hasContent false, but
    // updatedAt still tracks when the row last changed.
    const pitch = body.documents.find((d) => d.slug === 'pitch-deck');
    expect(pitch?.hasContent).toBe(false);
    expect(pitch?.updatedAt).toBe(stamp);

    // Untouched slugs stay in the response with no row info.
    const sales = body.documents.find((d) => d.slug === 'sales-plan');
    expect(sales?.hasContent).toBe(false);
    expect(sales?.updatedAt).toBeNull();
  });

  it('only counts whitespace as empty (trim before reporting hasContent)', async () => {
    tableQueue.Document.push({
      data: [{ slug: 'business-plan', content: '   \n  ', updatedAt: '2026-05-01T12:00:00.000Z' }],
      error: null,
    });
    const res = await GET(makeReq());
    const body = (await res.json()) as { documents: Array<{ slug: string; hasContent: boolean }> };
    const plan = body.documents.find((d) => d.slug === 'business-plan');
    expect(plan?.hasContent).toBe(false);
  });
});

describe('GET /api/documents — DB failure', () => {
  it('returns 500 with a short generic message when the query fails', async () => {
    tableQueue.Document.push({
      data: null,
      error: { message: 'postgres: connection refused at 127.0.0.1:5432' },
    });
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain('postgres');
    expect(body.error).not.toContain('127.0.0.1');
    expect(body.error.length).toBeLessThan(120);
  });
});
