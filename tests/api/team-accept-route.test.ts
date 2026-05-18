/**
 * POST /api/team/accept/[token] — route tests.
 *
 * The bar:
 *   - 401 unauthed.
 *   - 404 unknown token.
 *   - 410 expired or already accepted.
 *   - 403 when accepter's email doesn't match the invite.
 *   - 200 happy: inserts TeamMembership + marks invite acceptedAt.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(async () => ({ userId: 'clerk_accepter' })),
}));

const { getUserMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
}));
vi.mock('@clerk/nextjs/server', () => ({
  createClerkClient: () => ({
    users: { getUser: getUserMock },
  }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// Mutable state controlled per-test.
let inviteLookup:
  | null
  | {
      id: string;
      teamId: string;
      email: string;
      role: 'admin' | 'member';
      expiresAt: string;
      acceptedAt: string | null;
    } = null;
let membershipInsertError: { message: string } | null = null;
let inviteUpdateError: { message: string } | null = null;

const { insertCalls, updateCalls } = vi.hoisted(() => ({
  insertCalls: [] as Array<{ table: string; row: Record<string, unknown> }>,
  updateCalls: [] as Array<{ table: string; patch: Record<string, unknown> }>,
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
        if (table === 'TeamInvite') {
          return Promise.resolve({ data: inviteLookup, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      insert(row: Record<string, unknown>) {
        insertCalls.push({ table, row });
        return Promise.resolve(
          membershipInsertError
            ? { data: null, error: membershipInsertError }
            : { data: null, error: null },
        );
      },
      update(patch: Record<string, unknown>) {
        updateCalls.push({ table, patch });
        return {
          eq: () =>
            Promise.resolve(
              inviteUpdateError
                ? { data: null, error: inviteUpdateError }
                : { data: null, error: null },
            ),
        };
      },
    }),
  },
}));

import { POST } from '@/app/api/team/accept/[token]/route';
import { requireAuth } from '@/lib/api-auth';

const mockRequireAuth = vi.mocked(requireAuth);

function makeArgs(token: string) {
  const req = new Request(
    `http://localhost/api/team/accept/${token}`,
    { method: 'POST' },
  ) as unknown as Parameters<typeof POST>[0];
  return { req, params: Promise.resolve({ token }) };
}

const futureIso = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString();
const pastIso = new Date(Date.now() - 60 * 1000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  insertCalls.length = 0;
  updateCalls.length = 0;
  inviteLookup = null;
  membershipInsertError = null;
  inviteUpdateError = null;
  mockRequireAuth.mockResolvedValue({ userId: 'clerk_accepter' });
  getUserMock.mockResolvedValue({
    primaryEmailAddressId: 'eml_1',
    emailAddresses: [{ id: 'eml_1', emailAddress: 'invitee@example.com' }],
  });
});

describe('POST /api/team/accept/[token] — auth + lookup', () => {
  it('returns 401 unauthed', async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const { req, params } = makeArgs('abc');
    const res = await POST(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 404 for an unknown token', async () => {
    inviteLookup = null;
    const { req, params } = makeArgs('unknown');
    const res = await POST(req, { params });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/team/accept/[token] — invite state', () => {
  it('returns 410 when the invite has already been accepted', async () => {
    inviteLookup = {
      id: 'i1',
      teamId: 't1',
      email: 'invitee@example.com',
      role: 'member',
      expiresAt: futureIso,
      acceptedAt: new Date().toISOString(),
    };
    const { req, params } = makeArgs('tok');
    const res = await POST(req, { params });
    expect(res.status).toBe(410);
  });

  it('returns 410 when the invite has expired', async () => {
    inviteLookup = {
      id: 'i1',
      teamId: 't1',
      email: 'invitee@example.com',
      role: 'member',
      expiresAt: pastIso,
      acceptedAt: null,
    };
    const { req, params } = makeArgs('tok');
    const res = await POST(req, { params });
    expect(res.status).toBe(410);
  });
});

describe('POST /api/team/accept/[token] — email match', () => {
  it("returns 403 when the logged-in user's email differs from the invite", async () => {
    inviteLookup = {
      id: 'i1',
      teamId: 't1',
      email: 'invitee@example.com',
      role: 'member',
      expiresAt: futureIso,
      acceptedAt: null,
    };
    getUserMock.mockResolvedValue({
      primaryEmailAddressId: 'eml_1',
      emailAddresses: [{ id: 'eml_1', emailAddress: 'someone-else@example.com' }],
    });
    const { req, params } = makeArgs('tok');
    const res = await POST(req, { params });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/team/accept/[token] — happy path', () => {
  it('inserts a TeamMembership row, marks the invite accepted, returns 200', async () => {
    inviteLookup = {
      id: 'i1',
      teamId: 'team_42',
      email: 'invitee@example.com',
      role: 'admin',
      expiresAt: futureIso,
      acceptedAt: null,
    };
    const { req, params } = makeArgs('tok');
    const res = await POST(req, { params });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { teamId: string; role: string };
    expect(body.teamId).toBe('team_42');
    expect(body.role).toBe('admin');

    const membershipInsert = insertCalls.find((c) => c.table === 'TeamMembership');
    expect(membershipInsert).toBeTruthy();
    expect(membershipInsert?.row).toMatchObject({
      teamId: 'team_42',
      userId: 'clerk_accepter',
      role: 'admin',
    });

    const inviteUpdate = updateCalls.find((c) => c.table === 'TeamInvite');
    expect(inviteUpdate?.patch.acceptedAt).toBeTruthy();
  });

  it('email match is case-insensitive', async () => {
    inviteLookup = {
      id: 'i1',
      teamId: 'team_42',
      email: 'Invitee@EXAMPLE.com',
      role: 'member',
      expiresAt: futureIso,
      acceptedAt: null,
    };
    getUserMock.mockResolvedValue({
      primaryEmailAddressId: 'eml_1',
      emailAddresses: [{ id: 'eml_1', emailAddress: 'invitee@example.com' }],
    });
    const { req, params } = makeArgs('tok');
    const res = await POST(req, { params });
    expect(res.status).toBe(200);
  });

  it('treats duplicate-membership errors as success (idempotent re-accept)', async () => {
    inviteLookup = {
      id: 'i1',
      teamId: 'team_42',
      email: 'invitee@example.com',
      role: 'member',
      expiresAt: futureIso,
      acceptedAt: null,
    };
    membershipInsertError = { message: 'duplicate key value violates unique constraint' };
    const { req, params } = makeArgs('tok');
    const res = await POST(req, { params });
    expect(res.status).toBe(200);
  });
});
