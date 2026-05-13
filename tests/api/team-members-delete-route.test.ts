/**
 * DELETE /api/team/members/[memberId] — route tests.
 *
 * The bar:
 *   - 401 unauthed.
 *   - 403 when caller has no space.
 *   - 403 when caller is not at least admin.
 *   - 400 when target is the owner — owner cannot be removed.
 *   - 400 when caller tries to self-remove.
 *   - 204 happy path.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(async () => ({ userId: 'clerk_admin' })),
}));

vi.mock('@/lib/space', () => ({
  getSpaceForUser: vi.fn(async () => ({
    id: 'space_1',
    slug: 'acme',
    name: 'Acme',
    ownerId: 'u_owner',
  })),
}));

const { requireRoleMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(async () => 'admin' as const),
}));
vi.mock('@/lib/team/permissions', () => ({
  requireRole: requireRoleMock,
  getMemberRole: vi.fn(),
  hasAtLeast: vi.fn(),
  ROLE_ORDER: ['owner', 'admin', 'member'],
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

let teamLookup: { id: string } | null = { id: 'team_1' };
let membershipLookup:
  | null
  | { id: string; teamId: string; userId: string; role: string } = null;
let deleteError: { message: string } | null = null;
const { deleteCalls } = vi.hoisted(() => ({
  deleteCalls: [] as Array<{ table: string }>,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select() {
        return this;
      },
      eq() {
        return this;
      },
      maybeSingle() {
        if (table === 'Team') return Promise.resolve({ data: teamLookup, error: null });
        if (table === 'TeamMembership')
          return Promise.resolve({ data: membershipLookup, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      delete() {
        deleteCalls.push({ table });
        return {
          eq: () =>
            Promise.resolve(
              deleteError
                ? { data: null, error: deleteError }
                : { data: null, error: null },
            ),
        };
      },
    }),
  },
}));

import { DELETE } from '@/app/api/team/members/[memberId]/route';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';

const mockRequireAuth = vi.mocked(requireAuth);
const mockGetSpaceForUser = vi.mocked(getSpaceForUser);

function makeArgs(memberId: string) {
  const req = new Request(
    `http://localhost/api/team/members/${memberId}`,
    { method: 'DELETE' },
  ) as unknown as Parameters<typeof DELETE>[0];
  return { req, params: Promise.resolve({ memberId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  deleteCalls.length = 0;
  teamLookup = { id: 'team_1' };
  membershipLookup = null;
  deleteError = null;
  mockRequireAuth.mockResolvedValue({ userId: 'clerk_admin' });
  mockGetSpaceForUser.mockResolvedValue({
    id: 'space_1',
    slug: 'acme',
    name: 'Acme',
    emoji: '',
    ownerId: 'u_owner',
    brokerageId: null,
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeSubscriptionStatus: 'active',
    stripePeriodEnd: null,
  });
  requireRoleMock.mockResolvedValue('admin');
});

describe('DELETE /api/team/members/[memberId] — auth', () => {
  it('returns 401 unauthed', async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const { req, params } = makeArgs('m1');
    const res = await DELETE(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 when caller has no space', async () => {
    mockGetSpaceForUser.mockResolvedValue(null);
    const { req, params } = makeArgs('m1');
    const res = await DELETE(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 403 when caller is not at least admin', async () => {
    requireRoleMock.mockRejectedValue(new Error('Insufficient role'));
    const { req, params } = makeArgs('m1');
    const res = await DELETE(req, { params });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/team/members/[memberId] — invariants', () => {
  it('returns 400 when trying to remove the team owner', async () => {
    membershipLookup = {
      id: 'm_owner',
      teamId: 'team_1',
      userId: 'clerk_founder',
      role: 'owner',
    };
    const { req, params } = makeArgs('m_owner');
    const res = await DELETE(req, { params });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain('owner');
    expect(deleteCalls).toHaveLength(0);
  });

  it("returns 400 when the caller tries to remove themselves", async () => {
    membershipLookup = {
      id: 'm_self',
      teamId: 'team_1',
      userId: 'clerk_admin',
      role: 'admin',
    };
    const { req, params } = makeArgs('m_self');
    const res = await DELETE(req, { params });
    expect(res.status).toBe(400);
    expect(deleteCalls).toHaveLength(0);
  });

  it('returns 404 when the membership id belongs to a different team', async () => {
    membershipLookup = {
      id: 'm_x',
      teamId: 'team_OTHER',
      userId: 'clerk_other',
      role: 'member',
    };
    const { req, params } = makeArgs('m_x');
    const res = await DELETE(req, { params });
    expect(res.status).toBe(404);
    expect(deleteCalls).toHaveLength(0);
  });
});

describe('DELETE /api/team/members/[memberId] — happy path', () => {
  it('deletes the membership and returns 204', async () => {
    membershipLookup = {
      id: 'm_target',
      teamId: 'team_1',
      userId: 'clerk_mem',
      role: 'member',
    };
    const { req, params } = makeArgs('m_target');
    const res = await DELETE(req, { params });
    expect(res.status).toBe(204);
    expect(deleteCalls.some((c) => c.table === 'TeamMembership')).toBe(true);
  });
});
