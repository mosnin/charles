/**
 * GET /api/library and DELETE /api/library/[id] — list and delete the
 * founder's library files. Locks down the auth + workspace gates and
 * the happy paths.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/space', () => ({
  getSpaceForUser: vi.fn(),
}));

const { listResult, lookupResult, deleteResult, storageRemoveSpy } = vi.hoisted(() => ({
  listResult: { current: { data: [] as unknown, error: null as unknown } },
  lookupResult: { current: { data: null as unknown, error: null as unknown } },
  deleteResult: { current: { data: null as unknown, error: null as unknown } },
  storageRemoveSpy: vi.fn(() => Promise.resolve({ data: null, error: null })),
}));

vi.mock('@/lib/supabase', () => {
  function table() {
    const obj: Record<string, unknown> = {};
    obj.select = vi.fn(() => obj);
    obj.order = vi.fn(() => Promise.resolve(listResult.current));
    obj.eq = vi.fn(() => {
      const next: Record<string, unknown> = { ...obj };
      next.maybeSingle = vi.fn(() => Promise.resolve(lookupResult.current));
      next.order = vi.fn(() => Promise.resolve(listResult.current));
      next.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(listResult.current).then(resolve);
      next.eq = obj.eq;
      next.delete = obj.delete;
      return next;
    });
    obj.delete = vi.fn(() => ({
      eq: vi.fn(() => Promise.resolve(deleteResult.current)),
    }));
    return obj;
  }
  return {
    supabase: {
      from: vi.fn(() => table()),
      storage: {
        from: vi.fn(() => ({
          remove: storageRemoveSpy,
        })),
      },
    },
  };
});

import { GET as LIST } from '@/app/api/library/route';
import { DELETE } from '@/app/api/library/[id]/route';
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

beforeEach(() => {
  vi.clearAllMocks();
  listResult.current = { data: [], error: null };
  lookupResult.current = { data: null, error: null };
  deleteResult.current = { data: null, error: null };
  mockAuth.mockResolvedValue({ userId: 'user_clerk_1' });
  mockGetSpace.mockResolvedValue(SPACE);
});

describe('GET /api/library — list', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await LIST();
    expect(res.status).toBe(401);
  });

  it('returns 403 when caller has no workspace', async () => {
    mockGetSpace.mockResolvedValue(null);
    const res = await LIST();
    expect(res.status).toBe(403);
  });

  it('returns the workspace files', async () => {
    listResult.current = {
      data: [
        {
          id: 'lib_1',
          spaceId: 'space_1',
          uploaderId: 'user_clerk_1',
          name: 'a.txt',
          mimeType: 'text/plain',
          sizeBytes: 100,
          storagePath: 'space_1/abc-a.txt',
          kind: 'document',
          description: '',
          createdAt: '2026-05-13T00:00:00.000Z',
        },
      ],
      error: null,
    };
    const res = await LIST();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('lib_1');
  });

  it('returns 500 when the query errors', async () => {
    listResult.current = { data: null, error: { message: 'boom' } };
    const res = await LIST();
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/library/[id]', () => {
  function p(id: string) {
    return { params: Promise.resolve({ id }) };
  }

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await DELETE(new Request('http://x'), p('lib_1'));
    expect(res.status).toBe(401);
  });

  it('returns 404 when the row does not exist', async () => {
    lookupResult.current = { data: null, error: null };
    const res = await DELETE(new Request('http://x'), p('lib_missing'));
    expect(res.status).toBe(404);
  });

  it('returns 403 when the row belongs to another space', async () => {
    lookupResult.current = {
      data: { id: 'lib_1', spaceId: 'other_space', storagePath: 'p' },
      error: null,
    };
    const res = await DELETE(new Request('http://x'), p('lib_1'));
    expect(res.status).toBe(403);
  });

  it('deletes the row and removes the storage object on happy path', async () => {
    lookupResult.current = {
      data: { id: 'lib_1', spaceId: 'space_1', storagePath: 'space_1/abc-a.txt' },
      error: null,
    };
    const res = await DELETE(new Request('http://x'), p('lib_1'));
    expect(res.status).toBe(200);
    expect(storageRemoveSpy).toHaveBeenCalledWith(['space_1/abc-a.txt']);
  });
});
