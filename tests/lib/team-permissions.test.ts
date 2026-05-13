/**
 * Tests for lib/team/permissions.ts.
 *
 * The contract this file enforces:
 *   - getMemberRole returns the persisted TeamMembership.role when one exists.
 *   - Missing TeamMembership but matching Space.ownerId → 'owner' fallback.
 *   - Neither → null (never throws).
 *   - requireRole throws on insufficient, returns the actual role on success.
 *   - hasAtLeast respects the 3-tier ordering (owner > admin > member).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type TeamRow = { id: string; spaceId: string };
type MembershipRow = { teamId: string; userId: string; role: string };
type UserRow = { clerkId: string; id: string };
type SpaceRow = { id: string; ownerId: string };

let teams: TeamRow[] = [];
let memberships: MembershipRow[] = [];
let users: UserRow[] = [];
let spaces: SpaceRow[] = [];

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const filters: Array<{ col: string; val: unknown }> = [];
      const builder = {
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          filters.push({ col, val });
          return builder;
        },
        maybeSingle() {
          const match = (row: Record<string, unknown>) =>
            filters.every((f) => row[f.col] === f.val);
          let row: Record<string, unknown> | undefined;
          if (table === 'Team') row = teams.find(match);
          else if (table === 'TeamMembership') row = memberships.find(match);
          else if (table === 'User') row = users.find(match);
          else if (table === 'Space') row = spaces.find(match);
          return Promise.resolve({ data: row ?? null, error: null });
        },
      };
      return builder;
    },
  },
}));

import {
  ROLE_ORDER,
  hasAtLeast,
  getMemberRole,
  requireRole,
  isRole,
} from '@/lib/team/permissions';

beforeEach(() => {
  teams = [];
  memberships = [];
  users = [];
  spaces = [];
});

describe('ROLE_ORDER + isRole', () => {
  it('orders owner first, then admin, then member', () => {
    expect(ROLE_ORDER).toEqual(['owner', 'admin', 'member']);
  });

  it('isRole accepts the three known roles and rejects others', () => {
    expect(isRole('owner')).toBe(true);
    expect(isRole('admin')).toBe(true);
    expect(isRole('member')).toBe(true);
    expect(isRole('superuser')).toBe(false);
    expect(isRole('')).toBe(false);
    expect(isRole(null)).toBe(false);
  });
});

describe('hasAtLeast', () => {
  it('owner is at least every role', () => {
    expect(hasAtLeast('owner', 'owner')).toBe(true);
    expect(hasAtLeast('owner', 'admin')).toBe(true);
    expect(hasAtLeast('owner', 'member')).toBe(true);
  });

  it('admin clears member but not owner', () => {
    expect(hasAtLeast('admin', 'member')).toBe(true);
    expect(hasAtLeast('admin', 'admin')).toBe(true);
    expect(hasAtLeast('admin', 'owner')).toBe(false);
  });

  it('member only clears member', () => {
    expect(hasAtLeast('member', 'member')).toBe(true);
    expect(hasAtLeast('member', 'admin')).toBe(false);
    expect(hasAtLeast('member', 'owner')).toBe(false);
  });
});

describe('getMemberRole', () => {
  it('returns the persisted TeamMembership role', async () => {
    teams.push({ id: 'team_1', spaceId: 'space_1' });
    memberships.push({ teamId: 'team_1', userId: 'clerk_admin', role: 'admin' });
    const role = await getMemberRole('space_1', 'clerk_admin');
    expect(role).toBe('admin');
  });

  it('returns member when persisted as member', async () => {
    teams.push({ id: 'team_1', spaceId: 'space_1' });
    memberships.push({ teamId: 'team_1', userId: 'clerk_mem', role: 'member' });
    const role = await getMemberRole('space_1', 'clerk_mem');
    expect(role).toBe('member');
  });

  it("returns 'owner' via Space.ownerId fallback when no TeamMembership row exists", async () => {
    // No team, no membership — but caller is the space owner.
    users.push({ clerkId: 'clerk_founder', id: 'u_1' });
    spaces.push({ id: 'space_1', ownerId: 'u_1' });
    const role = await getMemberRole('space_1', 'clerk_founder');
    expect(role).toBe('owner');
  });

  it('returns null when there is no membership and the caller is not the owner', async () => {
    users.push({ clerkId: 'clerk_stranger', id: 'u_99' });
    spaces.push({ id: 'space_1', ownerId: 'u_1' });
    const role = await getMemberRole('space_1', 'clerk_stranger');
    expect(role).toBe(null);
  });

  it('returns null when the user has no User row at all', async () => {
    spaces.push({ id: 'space_1', ownerId: 'u_1' });
    const role = await getMemberRole('space_1', 'clerk_ghost');
    expect(role).toBe(null);
  });

  it('TeamMembership beats the owner fallback when both could apply', async () => {
    teams.push({ id: 'team_1', spaceId: 'space_1' });
    memberships.push({ teamId: 'team_1', userId: 'clerk_founder', role: 'owner' });
    users.push({ clerkId: 'clerk_founder', id: 'u_1' });
    spaces.push({ id: 'space_1', ownerId: 'u_1' });
    const role = await getMemberRole('space_1', 'clerk_founder');
    expect(role).toBe('owner');
  });
});

describe('requireRole', () => {
  it('returns the actual role when it meets the bar', async () => {
    teams.push({ id: 'team_1', spaceId: 'space_1' });
    memberships.push({ teamId: 'team_1', userId: 'clerk_admin', role: 'admin' });
    const role = await requireRole('space_1', 'clerk_admin', 'member');
    expect(role).toBe('admin');
  });

  it('throws when the role is insufficient', async () => {
    teams.push({ id: 'team_1', spaceId: 'space_1' });
    memberships.push({ teamId: 'team_1', userId: 'clerk_mem', role: 'member' });
    await expect(requireRole('space_1', 'clerk_mem', 'admin')).rejects.toThrow(
      /insufficient/i,
    );
  });

  it('throws when the user has no membership at all', async () => {
    await expect(requireRole('space_1', 'clerk_ghost', 'member')).rejects.toThrow(
      /insufficient/i,
    );
  });
});
