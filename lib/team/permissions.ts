/**
 * Team permissions — single source of truth for "who is allowed to do what
 * inside a Charles workspace".
 *
 * The model is intentionally small. Three roles, ordered:
 *
 *     owner   — the founder. There is exactly one. Cannot be removed.
 *     admin   — can invite, can remove non-owner members, can revoke invites.
 *     member  — can use Charles. Cannot manage the team.
 *
 * That's the whole list. Settings tabs, billing, scopes per integration —
 * none of that exists here. If we need a fourth role later, we'll add it;
 * configuration is a failure to decide, and three is the right number for
 * a founding team.
 *
 * Membership lives in TeamMembership keyed by (teamId, userId) where
 * `userId` is the Clerk id. A solo founder with no TeamMembership row falls
 * back to Space.ownerId — if the caller owns the space, they are 'owner'.
 * This is the only path that doesn't require a row in TeamMembership, and
 * it exists so pre-multi-seat workspaces keep working.
 */

import { supabase } from '@/lib/supabase';

export type Role = 'owner' | 'admin' | 'member';

/** Sorted strongest → weakest. Index === seniority. */
export const ROLE_ORDER: readonly Role[] = ['owner', 'admin', 'member'] as const;

const ROLE_RANK: Record<Role, number> = {
  owner: 0,
  admin: 1,
  member: 2,
};

export function isRole(v: unknown): v is Role {
  return v === 'owner' || v === 'admin' || v === 'member';
}

/**
 * Returns true if `actual` is at least as senior as `required`.
 * hasAtLeast('admin', 'member') === true
 * hasAtLeast('member', 'admin') === false
 */
export function hasAtLeast(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] <= ROLE_RANK[required];
}

/**
 * Looks up the caller's role in the team that owns `spaceId`.
 *
 * Defensive: returns null on any "no membership" signal — never throws on
 * missing rows. Callers that need to enforce a minimum use `requireRole`.
 *
 * Fallback path: if the space has no Team row yet (single-tenant pre-team
 * workspaces) but `userId` is the Clerk id of the space owner, we return
 * 'owner'. This keeps the founder in control of their own space even when
 * the Team row hasn't been seeded.
 */
export async function getMemberRole(
  spaceId: string,
  userId: string,
): Promise<Role | null> {
  // 1. Find the Team for this space (if any).
  const { data: team } = await supabase
    .from('Team')
    .select('id')
    .eq('spaceId', spaceId)
    .maybeSingle();

  const teamId = (team as { id?: string } | null)?.id ?? null;

  // 2. If a Team exists, look up the membership row.
  if (teamId) {
    const { data: membership } = await supabase
      .from('TeamMembership')
      .select('role')
      .eq('teamId', teamId)
      .eq('userId', userId)
      .maybeSingle();

    const role = (membership as { role?: string } | null)?.role;
    if (isRole(role)) return role;
  }

  // 3. Fallback: caller is the space owner — treat as 'owner'. The Space
  //    table stores ownerId as the internal User.id (not the Clerk id), so
  //    resolve the caller's User row first. If that lookup misses for any
  //    reason, we return null rather than blocking — `requireRole` will
  //    convert that into a 403 at the route boundary.
  const { data: user } = await supabase
    .from('User')
    .select('id')
    .eq('clerkId', userId)
    .maybeSingle();

  const internalId = (user as { id?: string } | null)?.id;
  if (!internalId) return null;

  const { data: space } = await supabase
    .from('Space')
    .select('ownerId')
    .eq('id', spaceId)
    .maybeSingle();

  const ownerId = (space as { ownerId?: string } | null)?.ownerId;
  if (ownerId && ownerId === internalId) return 'owner';

  return null;
}

/**
 * Returns the actual role if the caller has at least `minRole`, otherwise
 * throws. Routes catch the throw and surface a 403.
 *
 * This is the only function that throws. `getMemberRole` is the silent
 * lookup; `requireRole` is the gatekeeper.
 */
export async function requireRole(
  spaceId: string,
  userId: string,
  minRole: Role,
): Promise<Role> {
  const role = await getMemberRole(spaceId, userId);
  if (!role || !hasAtLeast(role, minRole)) {
    const err = new Error('Insufficient role');
    (err as Error & { code?: string }).code = 'forbidden';
    throw err;
  }
  return role;
}
