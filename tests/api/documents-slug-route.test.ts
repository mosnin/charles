/**
 * Route-level tests for `GET|PATCH /api/documents/[slug]`.
 *
 * What we lock down:
 *   - Auth required (401 without).
 *   - Unknown slug → 404 on both verbs.
 *   - 403 when the caller has no workspace.
 *   - GET falls back to the catalog default when no DB row exists.
 *   - GET returns the DB row when one exists.
 *   - PATCH 400 on bad body, then upserts on the happy path (insert + update).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/space', () => ({
  getSpaceForUser: vi.fn(),
}));

// Per-table queue for select chains + spies for upsert.
const { documentQueue, upsertSpy } = vi.hoisted(() => ({
  documentQueue: [] as Array<{ data?: unknown; error?: unknown }>,
  upsertSpy: vi.fn(),
}));

vi.mock('@/lib/supabase', () => {
  function chain() {
    const terminal = documentQueue.shift() ?? { data: null, error: null };
    const obj: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'limit']) {
      obj[m] = vi.fn(() => obj);
    }
    obj.maybeSingle = vi.fn(() => Promise.resolve(terminal));
    obj.single = vi.fn(() => Promise.resolve(terminal));
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
    return obj;
  }
  return { supabase: { from: vi.fn(() => chain()) } };
});

import { GET, PATCH } from '@/app/api/documents/[slug]/route';
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

function makeGetReq(): Request {
  return new Request('http://localhost/api/documents/executive-summary', {
    method: 'GET',
  });
}
function makePatchReq(body: unknown): Request {
  return new Request('http://localhost/api/documents/executive-summary', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  vi.clearAllMocks();
  documentQueue.length = 0;
  mockAuth.mockResolvedValue({ userId: 'user_clerk_1' });
  mockGetSpace.mockResolvedValue(SPACE);
});

describe('GET /api/documents/[slug]', () => {
  it('401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await GET(
      makeGetReq() as unknown as Parameters<typeof GET>[0],
      params('executive-summary'),
    );
    expect(res.status).toBe(401);
  });

  it('404 when the slug is not in the catalog', async () => {
    const res = await GET(
      makeGetReq() as unknown as Parameters<typeof GET>[0],
      params('not-a-real-doc'),
    );
    expect(res.status).toBe(404);
  });

  it('403 when the caller has no workspace', async () => {
    mockGetSpace.mockResolvedValue(null);
    const res = await GET(
      makeGetReq() as unknown as Parameters<typeof GET>[0],
      params('executive-summary'),
    );
    expect(res.status).toBe(403);
  });

  it('200 falls back to the catalog default when no DB row exists', async () => {
    documentQueue.push({ data: null, error: null });
    const res = await GET(
      makeGetReq() as unknown as Parameters<typeof GET>[0],
      params('executive-summary'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe('executive-summary');
    expect(body.title).toBeTruthy();
    expect(body.blurb).toBeTruthy();
    expect(body.group).toBeTruthy();
    expect(body.content).toBe('');
    expect(body.updatedAt).toBeNull();
  });

  it('200 returns the DB row when one exists', async () => {
    documentQueue.push({
      data: {
        content: '# Hello\n\nThis is a test.',
        updatedAt: '2026-05-01T10:00:00.000Z',
      },
      error: null,
    });
    const res = await GET(
      makeGetReq() as unknown as Parameters<typeof GET>[0],
      params('executive-summary'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe('# Hello\n\nThis is a test.');
    expect(body.updatedAt).toBe('2026-05-01T10:00:00.000Z');
  });

  it('500 when the lookup errors', async () => {
    documentQueue.push({ data: null, error: { message: 'boom' } });
    const res = await GET(
      makeGetReq() as unknown as Parameters<typeof GET>[0],
      params('executive-summary'),
    );
    expect(res.status).toBe(500);
  });

  it('does NOT call upsert on GET (read-only)', async () => {
    documentQueue.push({ data: null, error: null });
    await GET(
      makeGetReq() as unknown as Parameters<typeof GET>[0],
      params('executive-summary'),
    );
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/documents/[slug]', () => {
  it('401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await PATCH(
      makePatchReq({ content: 'hi' }) as unknown as Parameters<typeof PATCH>[0],
      params('executive-summary'),
    );
    expect(res.status).toBe(401);
  });

  it('404 when the slug is not in the catalog', async () => {
    const res = await PATCH(
      makePatchReq({ content: 'hi' }) as unknown as Parameters<typeof PATCH>[0],
      params('not-a-real-doc'),
    );
    expect(res.status).toBe(404);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('400 when the JSON body is malformed', async () => {
    const res = await PATCH(
      makePatchReq('{not-json') as unknown as Parameters<typeof PATCH>[0],
      params('executive-summary'),
    );
    expect(res.status).toBe(400);
  });

  it('400 when content is missing', async () => {
    const res = await PATCH(
      makePatchReq({}) as unknown as Parameters<typeof PATCH>[0],
      params('executive-summary'),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/content/);
  });

  it('400 when content is not a string', async () => {
    const res = await PATCH(
      makePatchReq({ content: 42 }) as unknown as Parameters<typeof PATCH>[0],
      params('executive-summary'),
    );
    expect(res.status).toBe(400);
  });

  it('403 when the caller has no workspace', async () => {
    mockGetSpace.mockResolvedValue(null);
    const res = await PATCH(
      makePatchReq({ content: 'hi' }) as unknown as Parameters<typeof PATCH>[0],
      params('executive-summary'),
    );
    expect(res.status).toBe(403);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('200 upserts on the insert path (no existing row)', async () => {
    const res = await PATCH(
      makePatchReq({ content: '# fresh' }) as unknown as Parameters<typeof PATCH>[0],
      params('executive-summary'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updatedAt).toBeTruthy();

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const [payload, opts] = upsertSpy.mock.calls[0];
    expect((payload as Record<string, unknown>).spaceId).toBe(SPACE.id);
    expect((payload as Record<string, unknown>).slug).toBe('executive-summary');
    expect((payload as Record<string, unknown>).content).toBe('# fresh');
    expect((payload as Record<string, unknown>).title).toBeTruthy();
    expect(typeof (payload as Record<string, unknown>).updatedAt).toBe('string');
    expect((opts as { onConflict?: string } | undefined)?.onConflict).toBe('spaceId,slug');
  });

  it('200 upserts on the update path (existing row gets overwritten)', async () => {
    const res = await PATCH(
      makePatchReq({ content: 'updated body' }) as unknown as Parameters<typeof PATCH>[0],
      params('business-plan'),
    );
    expect(res.status).toBe(200);
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const payload = upsertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.slug).toBe('business-plan');
    expect(payload.content).toBe('updated body');
  });

  it('200 accepts an empty string (clearing the document)', async () => {
    const res = await PATCH(
      makePatchReq({ content: '' }) as unknown as Parameters<typeof PATCH>[0],
      params('marketing-plan'),
    );
    expect(res.status).toBe(200);
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const payload = upsertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.content).toBe('');
  });
});
