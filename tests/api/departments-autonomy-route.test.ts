/**
 * PATCH /api/departments/[slug]/autonomy route tests.
 *
 * The bar:
 *   - 401 unauthed (and never touches the persistence helper).
 *   - 404 unknown department slug.
 *   - 400 on bad / missing autonomyLevel.
 *   - 403 when caller has no space.
 *   - 200 happy path persists exactly once with the right args.
 *   - 500 on persistence error, with no stack trace leaked in the body.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(async () => ({ userId: 'user_clerk_1' })),
}));

vi.mock('@/lib/space', () => ({
  getSpaceForUser: vi.fn(async () => ({
    id: 'space_1',
    slug: 'jane',
    name: 'Jane',
    ownerId: 'u_1',
  })),
}));

const { setMock } = vi.hoisted(() => ({ setMock: vi.fn(async () => undefined) }));
vi.mock('@/lib/departments/autonomy', async () => {
  const actual = await vi.importActual<typeof import('@/lib/departments/autonomy')>(
    '@/lib/departments/autonomy',
  );
  return {
    ...actual,
    setDepartmentAutonomy: setMock,
  };
});

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { PATCH } from '@/app/api/departments/[slug]/autonomy/route';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';

const mockRequireAuth = vi.mocked(requireAuth);
const mockGetSpaceForUser = vi.mocked(getSpaceForUser);

function makeRequest(slug: string, body: unknown): {
  req: Parameters<typeof PATCH>[0];
  params: Promise<{ slug: string }>;
} {
  const init: RequestInit = { method: 'PATCH' };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const req = new Request(
    `http://localhost/api/departments/${slug}/autonomy`,
    init,
  ) as unknown as Parameters<typeof PATCH>[0];
  return { req, params: Promise.resolve({ slug }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user_clerk_1' });
  mockGetSpaceForUser.mockResolvedValue({
    id: 'space_1',
    slug: 'jane',
    name: 'Jane',
    emoji: '',
    ownerId: 'u_1',
    brokerageId: null,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeSubscriptionStatus: 'active',
    stripePeriodEnd: null,
  });
  setMock.mockResolvedValue(undefined);
});

describe('PATCH /api/departments/[slug]/autonomy — auth', () => {
  it('returns 401 when unauthenticated and never calls the persistence helper', async () => {
    const unauth = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    mockRequireAuth.mockResolvedValue(unauth);
    const { req, params } = makeRequest('engineering', { autonomyLevel: 'ask' });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(401);
    expect(setMock).not.toHaveBeenCalled();
  });

  it('returns 403 when caller has no space', async () => {
    mockGetSpaceForUser.mockResolvedValue(null);
    const { req, params } = makeRequest('engineering', { autonomyLevel: 'ask' });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(403);
    expect(setMock).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/departments/[slug]/autonomy — slug validation', () => {
  it('returns 404 for an unknown department slug', async () => {
    const { req, params } = makeRequest('legal', { autonomyLevel: 'ask' });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(404);
    expect(setMock).not.toHaveBeenCalled();
  });

  it('accepts every documented department slug', async () => {
    const slugs = ['engineering', 'design', 'marketing', 'sales', 'support', 'ops_finance'];
    for (const slug of slugs) {
      const { req, params } = makeRequest(slug, { autonomyLevel: 'ask' });
      const res = await PATCH(req, { params });
      expect(res.status).toBe(200);
    }
    expect(setMock).toHaveBeenCalledTimes(slugs.length);
  });
});

describe('PATCH /api/departments/[slug]/autonomy — body validation', () => {
  it('returns 400 when the body is not JSON', async () => {
    const { req, params } = makeRequest('engineering', 'not-json{');
    const res = await PATCH(req, { params });
    expect(res.status).toBe(400);
    expect(setMock).not.toHaveBeenCalled();
  });

  it('returns 400 when autonomyLevel is missing', async () => {
    const { req, params } = makeRequest('engineering', {});
    const res = await PATCH(req, { params });
    expect(res.status).toBe(400);
    expect(setMock).not.toHaveBeenCalled();
  });

  it('returns 400 when autonomyLevel is not one of the 4 known values', async () => {
    const { req, params } = makeRequest('engineering', { autonomyLevel: 'YOLO' });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(400);
    expect(setMock).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/departments/[slug]/autonomy — happy path', () => {
  it('persists with the right (spaceId, slug, level) and returns the new state', async () => {
    const { req, params } = makeRequest('engineering', { autonomyLevel: 'autonomous' });
    const res = await PATCH(req, { params });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      slug: string;
      autonomyLevel: string;
      updatedAt: string;
    };
    expect(body.slug).toBe('engineering');
    expect(body.autonomyLevel).toBe('autonomous');
    expect(typeof body.updatedAt).toBe('string');

    expect(setMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith('space_1', 'engineering', 'autonomous');
  });
});

describe('PATCH /api/departments/[slug]/autonomy — persistence failure', () => {
  it('returns 500 with a generic message — no stack/DB internals in the body', async () => {
    setMock.mockRejectedValue(new Error('postgres: connection refused at 127.0.0.1:5432'));
    const { req, params } = makeRequest('engineering', { autonomyLevel: 'ask' });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain('postgres');
    expect(body.error).not.toContain('127.0.0.1');
    expect(body.error.length).toBeLessThan(120);
  });
});
