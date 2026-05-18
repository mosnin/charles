/**
 * POST /api/team/invite — route tests.
 *
 * The bar:
 *   - 401 unauthed.
 *   - 403 when caller has no space.
 *   - 403 when caller is not at least admin.
 *   - 400 on missing/bad body.
 *   - 200 happy path returns { inviteId, token, expiresAt, acceptUrl }.
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

const { sendTeamInviteMock } = vi.hoisted(() => ({
  sendTeamInviteMock: vi.fn(async () => undefined),
}));
vi.mock('@/lib/email', () => ({
  sendTeamInvite: sendTeamInviteMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// Supabase fake — supports the .from().select().eq().maybeSingle() and
// .from().insert().select('id').single() chains the route uses.
const fakeTeamRow = { id: 'team_1', name: 'Acme' };
const insertedInviteRow = { id: 'invite_1' };
let teamLookup: typeof fakeTeamRow | null = fakeTeamRow;
let inviteInsertError: { message: string } | null = null;

const { insertCalls } = vi.hoisted(() => ({
  insertCalls: [] as Array<{ table: string; row: Record<string, unknown> }>,
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
        if (table === 'Team') {
          return Promise.resolve({ data: teamLookup, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      insert(row: Record<string, unknown>) {
        insertCalls.push({ table, row });
        return {
          select() {
            return this;
          },
          single: () =>
            Promise.resolve(
              inviteInsertError
                ? { data: null, error: inviteInsertError }
                : table === 'TeamInvite'
                  ? { data: insertedInviteRow, error: null }
                  : { data: { id: 'team_new', name: 'Acme' }, error: null },
            ),
        };
      },
    }),
  },
}));

import { POST } from '@/app/api/team/invite/route';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';

const mockRequireAuth = vi.mocked(requireAuth);
const mockGetSpaceForUser = vi.mocked(getSpaceForUser);

function makeReq(body: unknown): Parameters<typeof POST>[0] {
  const init: RequestInit = { method: 'POST' };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return new Request('http://localhost/api/team/invite', init) as unknown as Parameters<
    typeof POST
  >[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  insertCalls.length = 0;
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
  sendTeamInviteMock.mockResolvedValue(undefined);
  teamLookup = fakeTeamRow;
  inviteInsertError = null;
});

describe('POST /api/team/invite — auth', () => {
  it('returns 401 when unauthenticated', async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await POST(makeReq({ email: 'a@b.co', role: 'member' }));
    expect(res.status).toBe(401);
  });

  it('returns 403 when caller has no space', async () => {
    mockGetSpaceForUser.mockResolvedValue(null);
    const res = await POST(makeReq({ email: 'a@b.co', role: 'member' }));
    expect(res.status).toBe(403);
  });

  it('returns 403 when caller is not at least admin', async () => {
    requireRoleMock.mockRejectedValue(new Error('Insufficient role'));
    const res = await POST(makeReq({ email: 'a@b.co', role: 'member' }));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/team/invite — body validation', () => {
  it('returns 400 on non-JSON body', async () => {
    const res = await POST(makeReq('not-json{'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when email is missing or invalid', async () => {
    const res1 = await POST(makeReq({ role: 'member' }));
    expect(res1.status).toBe(400);
    const res2 = await POST(makeReq({ email: 'not-an-email', role: 'member' }));
    expect(res2.status).toBe(400);
  });

  it('returns 400 when role is not admin or member', async () => {
    const res = await POST(makeReq({ email: 'a@b.co', role: 'owner' }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/team/invite — happy path', () => {
  it('returns inviteId + token + expiresAt + acceptUrl', async () => {
    const res = await POST(makeReq({ email: 'New@Example.COM', role: 'member' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      inviteId: string;
      token: string;
      expiresAt: string;
      acceptUrl: string;
    };
    expect(body.inviteId).toBe('invite_1');
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(20);
    expect(body.acceptUrl).toBe(`/team/accept/${body.token}`);
    // 7-day expiry, give or take.
    const ttl = new Date(body.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(ttl).toBeLessThan(8 * 24 * 60 * 60 * 1000);
  });

  it('lowercases the email before persisting', async () => {
    await POST(makeReq({ email: 'Mixed@Case.IO', role: 'admin' }));
    const inviteInsert = insertCalls.find((c) => c.table === 'TeamInvite');
    expect(inviteInsert?.row.email).toBe('mixed@case.io');
  });

  it('dispatches the invite email asynchronously', async () => {
    await POST(makeReq({ email: 'x@y.co', role: 'member' }));
    // The route uses `void sendTeamInvite(...)` so we wait a tick.
    await new Promise((r) => setTimeout(r, 0));
    expect(sendTeamInviteMock).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/team/invite — conflict path', () => {
  it('returns 409 on duplicate pending invite', async () => {
    inviteInsertError = { message: 'duplicate key value violates TeamInvite_team_email_pending_uq' };
    const res = await POST(makeReq({ email: 'a@b.co', role: 'member' }));
    expect(res.status).toBe(409);
  });
});
