/**
 * Tests for lib/space/list-for-user.ts.
 *
 * Locks the contract that powers the workspace switcher: owners come from
 * Space.ownerId, members come from TeamMembership joined via Team.spaceId,
 * duplicates are deduped owner-beats-member, and the result is sorted
 * current → owner → admin → member, alphabetical within each tier.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type UserRow = { id: string; clerkId?: string; name?: string | null; email?: string | null };
type SpaceRow = { id: string; slug: string; name: string; ownerId: string };
type TeamRow = { id: string; spaceId: string };
type MembershipRow = { teamId: string; userId: string; role: string };

let users: UserRow[] = [];
let spaces: SpaceRow[] = [];
let teams: TeamRow[] = [];
let memberships: MembershipRow[] = [];

function isIn(value: unknown, list: unknown[]): boolean {
  return list.some((v) => v === value);
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const eqFilters: Array<{ col: string; val: unknown }> = [];
      const inFilters: Array<{ col: string; vals: unknown[] }> = [];

      const dataset = (): Record<string, unknown>[] => {
        if (table === 'User') return users as unknown as Record<string, unknown>[];
        if (table === 'Space') return spaces as unknown as Record<string, unknown>[];
        if (table === 'Team') return teams as unknown as Record<string, unknown>[];
        if (table === 'TeamMembership')
          return memberships as unknown as Record<string, unknown>[];
        return [];
      };

      const filtered = (): Record<string, unknown>[] =>
        dataset().filter(
          (row) =>
            eqFilters.every((f) => row[f.col] === f.val) &&
            inFilters.every((f) => isIn(row[f.col], f.vals)),
        );

      const builder = {
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          eqFilters.push({ col, val });
          return builder;
        },
        in(col: string, vals: unknown[]) {
          inFilters.push({ col, vals });
          return builder;
        },
        maybeSingle() {
          const rows = filtered();
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
        then(resolve: (v: unknown) => unknown) {
          return resolve({ data: filtered(), error: null });
        },
      };
      return builder;
    },
  },
}));

import { listSpacesForUser } from '@/lib/space/list-for-user';

beforeEach(() => {
  users = [];
  spaces = [];
  teams = [];
  memberships = [];
});

describe('listSpacesForUser — owner-only', () => {
  it('returns the single space the user owns', async () => {
    users.push({ id: 'u_1', clerkId: 'clerk_1', name: 'Jane' });
    spaces.push({ id: 'space_1', slug: 'jane', name: 'Jane HQ', ownerId: 'u_1' });

    const result = await listSpacesForUser('clerk_1');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'space_1',
      slug: 'jane',
      name: 'Jane HQ',
      role: 'owner',
      ownerName: 'Jane',
      isCurrent: false,
    });
  });

  it('returns all owned spaces sorted alphabetically when none is current', async () => {
    users.push({ id: 'u_1', clerkId: 'clerk_1', name: 'Jane' });
    spaces.push(
      { id: 'space_b', slug: 'beta', name: 'Beta', ownerId: 'u_1' },
      { id: 'space_a', slug: 'alpha', name: 'Alpha', ownerId: 'u_1' },
      { id: 'space_c', slug: 'charlie', name: 'Charlie', ownerId: 'u_1' },
    );

    const result = await listSpacesForUser('clerk_1');
    expect(result.map((s) => s.name)).toEqual(['Alpha', 'Beta', 'Charlie']);
    expect(result.every((s) => s.role === 'owner')).toBe(true);
  });

  it('falls back to email when the owner has no name', async () => {
    users.push({ id: 'u_1', clerkId: 'clerk_1', name: null, email: 'j@x.io' });
    spaces.push({ id: 'space_1', slug: 'jane', name: 'Jane HQ', ownerId: 'u_1' });

    const result = await listSpacesForUser('clerk_1');
    expect(result[0]?.ownerName).toBe('j@x.io');
  });
});

describe('listSpacesForUser — membership-only', () => {
  it('returns spaces the user has membership in, with the persisted role', async () => {
    users.push(
      { id: 'u_caller', clerkId: 'clerk_caller', name: 'Member Mary' },
      { id: 'u_owner', clerkId: 'clerk_owner', name: 'Founder Fred' },
    );
    spaces.push({ id: 'space_1', slug: 'fred', name: 'Fred Co', ownerId: 'u_owner' });
    teams.push({ id: 'team_1', spaceId: 'space_1' });
    memberships.push({ teamId: 'team_1', userId: 'clerk_caller', role: 'admin' });

    const result = await listSpacesForUser('clerk_caller');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'space_1',
      name: 'Fred Co',
      role: 'admin',
      ownerName: 'Founder Fred',
    });
  });

  it('returns empty when the user owns nothing and has no memberships', async () => {
    users.push({ id: 'u_1', clerkId: 'clerk_lonely' });

    const result = await listSpacesForUser('clerk_lonely');
    expect(result).toEqual([]);
  });

  it('returns empty when the User row does not exist at all', async () => {
    const result = await listSpacesForUser('clerk_ghost');
    expect(result).toEqual([]);
  });

  it('ignores memberships whose Team row no longer points to a real space', async () => {
    users.push({ id: 'u_caller', clerkId: 'clerk_caller' });
    // membership references a team that does not exist
    memberships.push({ teamId: 'team_missing', userId: 'clerk_caller', role: 'member' });

    const result = await listSpacesForUser('clerk_caller');
    expect(result).toEqual([]);
  });
});

describe('listSpacesForUser — owner + member dedupe', () => {
  it('keeps the owner role when the user is both owner and a TeamMembership row', async () => {
    users.push({ id: 'u_1', clerkId: 'clerk_1', name: 'Jane' });
    spaces.push({ id: 'space_1', slug: 'jane', name: 'Jane HQ', ownerId: 'u_1' });
    teams.push({ id: 'team_1', spaceId: 'space_1' });
    memberships.push({ teamId: 'team_1', userId: 'clerk_1', role: 'member' });

    const result = await listSpacesForUser('clerk_1');
    expect(result).toHaveLength(1);
    expect(result[0]?.role).toBe('owner');
  });

  it('merges owned and member spaces without duplicates', async () => {
    users.push(
      { id: 'u_caller', clerkId: 'clerk_caller', name: 'Caller' },
      { id: 'u_other', clerkId: 'clerk_other', name: 'Other' },
    );
    spaces.push(
      { id: 'space_own', slug: 'own', name: 'My Bet', ownerId: 'u_caller' },
      { id: 'space_other', slug: 'other', name: 'Their Bet', ownerId: 'u_other' },
    );
    teams.push({ id: 'team_other', spaceId: 'space_other' });
    memberships.push({ teamId: 'team_other', userId: 'clerk_caller', role: 'member' });

    const result = await listSpacesForUser('clerk_caller');
    expect(result).toHaveLength(2);
    const own = result.find((s) => s.id === 'space_own');
    const other = result.find((s) => s.id === 'space_other');
    expect(own?.role).toBe('owner');
    expect(other?.role).toBe('member');
    expect(other?.ownerName).toBe('Other');
  });
});

describe('listSpacesForUser — sort order', () => {
  it('puts the current workspace first, then owned, then member, alphabetical within tier', async () => {
    users.push(
      { id: 'u_caller', clerkId: 'clerk_caller', name: 'Caller' },
      { id: 'u_other', clerkId: 'clerk_other', name: 'Other' },
    );
    spaces.push(
      { id: 'space_z', slug: 'zeta', name: 'Zeta', ownerId: 'u_caller' },
      { id: 'space_a', slug: 'alpha', name: 'Alpha', ownerId: 'u_caller' },
      { id: 'space_m', slug: 'mu', name: 'Mu', ownerId: 'u_caller' },
      { id: 'space_p', slug: 'partner', name: 'Partner', ownerId: 'u_other' },
      { id: 'space_q', slug: 'qoz', name: 'Qoz', ownerId: 'u_other' },
    );
    teams.push(
      { id: 'team_p', spaceId: 'space_p' },
      { id: 'team_q', spaceId: 'space_q' },
    );
    memberships.push(
      { teamId: 'team_p', userId: 'clerk_caller', role: 'member' },
      { teamId: 'team_q', userId: 'clerk_caller', role: 'admin' },
    );

    const result = await listSpacesForUser('clerk_caller', 'space_m');
    // Current first (Mu), then owned alphabetical (Alpha, Zeta), then admin
    // (Qoz), then member (Partner).
    expect(result.map((s) => s.name)).toEqual(['Mu', 'Alpha', 'Zeta', 'Qoz', 'Partner']);
    expect(result[0]?.isCurrent).toBe(true);
    expect(result.slice(1).every((s) => !s.isCurrent)).toBe(true);
  });

  it('marks the matching workspace isCurrent and nothing else', async () => {
    users.push({ id: 'u_1', clerkId: 'clerk_1' });
    spaces.push(
      { id: 'space_a', slug: 'alpha', name: 'Alpha', ownerId: 'u_1' },
      { id: 'space_b', slug: 'beta', name: 'Beta', ownerId: 'u_1' },
    );

    const result = await listSpacesForUser('clerk_1', 'space_b');
    expect(result.find((s) => s.id === 'space_b')?.isCurrent).toBe(true);
    expect(result.find((s) => s.id === 'space_a')?.isCurrent).toBe(false);
  });

  it('does not mark anything current when currentSpaceId is omitted', async () => {
    users.push({ id: 'u_1', clerkId: 'clerk_1' });
    spaces.push({ id: 'space_a', slug: 'alpha', name: 'Alpha', ownerId: 'u_1' });

    const result = await listSpacesForUser('clerk_1');
    expect(result[0]?.isCurrent).toBe(false);
  });

  it('puts a member-only current workspace ahead of an owned one', async () => {
    users.push(
      { id: 'u_caller', clerkId: 'clerk_caller', name: 'Caller' },
      { id: 'u_other', clerkId: 'clerk_other', name: 'Other' },
    );
    spaces.push(
      { id: 'space_own', slug: 'own', name: 'Owned', ownerId: 'u_caller' },
      { id: 'space_member', slug: 'mem', name: 'Member', ownerId: 'u_other' },
    );
    teams.push({ id: 'team_m', spaceId: 'space_member' });
    memberships.push({ teamId: 'team_m', userId: 'clerk_caller', role: 'member' });

    const result = await listSpacesForUser('clerk_caller', 'space_member');
    expect(result[0]?.id).toBe('space_member');
    expect(result[1]?.id).toBe('space_own');
  });
});

describe('listSpacesForUser — role normalization', () => {
  it('downgrades an unknown TeamMembership role to member rather than throwing', async () => {
    users.push(
      { id: 'u_caller', clerkId: 'clerk_caller' },
      { id: 'u_other', clerkId: 'clerk_other', name: 'Other' },
    );
    spaces.push({ id: 'space_1', slug: 'x', name: 'X', ownerId: 'u_other' });
    teams.push({ id: 'team_1', spaceId: 'space_1' });
    memberships.push({ teamId: 'team_1', userId: 'clerk_caller', role: 'wizard' });

    const result = await listSpacesForUser('clerk_caller');
    expect(result).toHaveLength(1);
    expect(result[0]?.role).toBe('member');
  });
});
