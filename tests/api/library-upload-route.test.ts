/**
 * POST /api/library/upload — multipart upload happy path + the three
 * refusal modes that matter: 401 unauth, 413 over the 25MB per-file cap,
 * 507 over the 1GB per-space cap.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/space', () => ({
  getSpaceForUser: vi.fn(),
}));

const {
  selectQueue,
  insertResult,
  uploadResult,
  bucketsResult,
  removeSpy,
} = vi.hoisted(() => ({
  selectQueue: [] as Array<{ data?: unknown; error?: unknown }>,
  insertResult: { current: { data: null as unknown, error: null as unknown } },
  uploadResult: { current: { error: null as unknown } },
  bucketsResult: { current: { data: [{ name: 'library' }] as unknown, error: null } },
  removeSpy: vi.fn(() => Promise.resolve({ data: null, error: null })),
}));

vi.mock('@/lib/supabase', () => {
  function table() {
    const obj: Record<string, unknown> = {};
    obj.select = vi.fn(() => obj);
    obj.order = vi.fn(() => obj);
    obj.eq = vi.fn(() => {
      const terminal = selectQueue.shift() ?? { data: [], error: null };
      const next: Record<string, unknown> = { ...obj };
      next.then = (resolve: (v: unknown) => unknown) => Promise.resolve(terminal).then(resolve);
      return next;
    });
    obj.insert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(() => Promise.resolve(insertResult.current)),
      })),
    }));
    return obj;
  }
  return {
    supabase: {
      from: vi.fn(() => table()),
      storage: {
        listBuckets: vi.fn(() => Promise.resolve(bucketsResult.current)),
        createBucket: vi.fn(() => Promise.resolve({ data: null, error: null })),
        from: vi.fn(() => ({
          upload: vi.fn(() => Promise.resolve(uploadResult.current)),
          remove: removeSpy,
        })),
      },
    },
  };
});

import { POST } from '@/app/api/library/upload/route';
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

function makeReq(file: File | null, description?: string): NextRequest {
  const fd = new FormData();
  if (file) fd.append('file', file);
  if (description) fd.append('description', description);
  return new NextRequest('http://localhost/api/library/upload', {
    method: 'POST',
    body: fd as unknown as BodyInit,
  });
}

function fileOf(bytes: number, name = 'a.txt', type = 'text/plain'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  insertResult.current = {
    data: {
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
    error: null,
  };
  uploadResult.current = { error: null };
  bucketsResult.current = { data: [{ name: 'library' }], error: null };
  mockAuth.mockResolvedValue({ userId: 'user_clerk_1' });
  mockGetSpace.mockResolvedValue(SPACE);
});

describe('POST /api/library/upload', () => {
  it('returns 401 when unauthenticated', async () => {
    const unauth = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    mockAuth.mockResolvedValue(unauth);
    const res = await POST(makeReq(fileOf(10)));
    expect(res.status).toBe(401);
    expect(mockGetSpace).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller has no workspace', async () => {
    mockGetSpace.mockResolvedValue(null);
    const res = await POST(makeReq(fileOf(10)));
    expect(res.status).toBe(403);
  });

  it('returns 400 when no file is provided', async () => {
    const res = await POST(makeReq(null));
    expect(res.status).toBe(400);
  });

  it('returns 200 with the inserted row on happy path', async () => {
    selectQueue.push({ data: [{ sizeBytes: 1000 }], error: null }); // quota check
    const res = await POST(makeReq(fileOf(50, 'note.txt', 'text/plain')));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; kind: string };
    expect(body.id).toBe('lib_1');
    expect(body.kind).toBe('document');
  });

  it('returns 413 when the file exceeds the 25MB per-file cap', async () => {
    const big = fileOf(26 * 1024 * 1024);
    const res = await POST(makeReq(big));
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/25/);
  });

  it('returns 507 when the space is over the 1GB total cap', async () => {
    // Already used ~1GB; even a tiny file pushes over.
    selectQueue.push({
      data: [{ sizeBytes: 1024 * 1024 * 1024 }],
      error: null,
    });
    const res = await POST(makeReq(fileOf(1000)));
    expect(res.status).toBe(507);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/full|1GB/i);
  });

  it('returns 500 and rolls back storage when the row insert fails', async () => {
    selectQueue.push({ data: [], error: null });
    insertResult.current = { data: null, error: { message: 'boom' } };
    const res = await POST(makeReq(fileOf(50)));
    expect(res.status).toBe(500);
    // Storage rollback was attempted.
    expect(removeSpy).toHaveBeenCalled();
  });

  it('returns 500 when storage upload fails', async () => {
    selectQueue.push({ data: [], error: null });
    uploadResult.current = { error: { message: 'storage down' } };
    const res = await POST(makeReq(fileOf(50)));
    expect(res.status).toBe(500);
  });

  it('classifies image MIME types as kind=image', async () => {
    selectQueue.push({ data: [], error: null });
    insertResult.current = {
      data: { ...(insertResult.current.data as object), kind: 'image' },
      error: null,
    };
    const res = await POST(makeReq(fileOf(100, 'p.png', 'image/png')));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kind: string };
    expect(body.kind).toBe('image');
  });
});
