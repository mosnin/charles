/**
 * List every workspace a founder can step into.
 *
 * Owners come from Space.ownerId. Members come from TeamMembership joined
 * via Team.spaceId. We merge the two lists, dedupe (owner beats member),
 * and sort: current → owned → alphabetical. Owner names are looked up in
 * one batched User query for the "owned by Jane" subtitle in the switcher.
 */

import { supabase } from '@/lib/supabase';

export type UserSpaceRole = 'owner' | 'admin' | 'member';

export interface UserSpace {
  id: string;
  slug: string;
  name: string;
  ownerName: string;
  role: UserSpaceRole;
  isCurrent: boolean;
}

const ROLES: ReadonlySet<UserSpaceRole> = new Set(['owner', 'admin', 'member']);

function normalizeRole(value: unknown): UserSpaceRole {
  return typeof value === 'string' && ROLES.has(value as UserSpaceRole)
    ? (value as UserSpaceRole)
    : 'member';
}

/**
 * Resolve the caller's Clerk id to the internal User.id. Returns null when
 * the user has no row yet (mid-onboarding) — callers should treat that as
 * "no spaces".
 */
async function resolveInternalUserId(clerkId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('User')
    .select('id')
    .eq('clerkId', clerkId)
    .maybeSingle();
  if (error) throw error;
  const id = (data as { id?: string } | null)?.id;
  return id ?? null;
}

/**
 * Returns all spaces the caller owns or has a TeamMembership in.
 *
 * `userId` is the Clerk id (same shape as `auth().userId`). `currentSpaceId`
 * marks one entry as current and sorts it to the top.
 *
 * Sort order: current first, then owned spaces (by name), then member
 * spaces (by name). Owner always beats member on dedupe.
 */
export async function listSpacesForUser(
  userId: string,
  currentSpaceId?: string,
): Promise<UserSpace[]> {
  const internalUserId = await resolveInternalUserId(userId);

  // 1. Spaces the caller owns directly.
  const ownedRowsPromise = internalUserId
    ? supabase
        .from('Space')
        .select('id, slug, name, ownerId')
        .eq('ownerId', internalUserId)
    : Promise.resolve({ data: [] as unknown[], error: null });

  // 2. Memberships, keyed on the Clerk id (TeamMembership.userId is the Clerk id).
  const membershipsPromise = supabase
    .from('TeamMembership')
    .select('teamId, role')
    .eq('userId', userId);

  const [ownedRes, membershipRes] = await Promise.all([
    ownedRowsPromise,
    membershipsPromise,
  ]);

  if ('error' in ownedRes && ownedRes.error) throw ownedRes.error;
  if (membershipRes.error) throw membershipRes.error;

  const ownedRows = (ownedRes.data ?? []) as Array<{
    id: string;
    slug: string;
    name: string;
    ownerId: string;
  }>;
  const membershipRows = (membershipRes.data ?? []) as Array<{
    teamId: string;
    role: string;
  }>;

  // 3. Resolve membership teams → spaceIds, skipping ones the user already owns.
  const teamIds = membershipRows.map((m) => m.teamId);
  let memberSpaces: Array<{
    id: string;
    slug: string;
    name: string;
    ownerId: string;
    role: UserSpaceRole;
  }> = [];

  if (teamIds.length > 0) {
    const { data: teamRows, error: teamErr } = await supabase
      .from('Team')
      .select('id, spaceId')
      .in('id', teamIds);
    if (teamErr) throw teamErr;

    const teamIdToSpaceId = new Map<string, string>();
    for (const t of (teamRows ?? []) as Array<{ id: string; spaceId: string }>) {
      teamIdToSpaceId.set(t.id, t.spaceId);
    }

    const ownedIds = new Set(ownedRows.map((s) => s.id));
    const memberSpaceIdToRole = new Map<string, UserSpaceRole>();
    for (const m of membershipRows) {
      const spaceId = teamIdToSpaceId.get(m.teamId);
      if (!spaceId || ownedIds.has(spaceId)) continue;
      // Keep the highest role if duplicates somehow exist.
      const next = normalizeRole(m.role);
      const prev = memberSpaceIdToRole.get(spaceId);
      if (!prev || rank(next) < rank(prev)) memberSpaceIdToRole.set(spaceId, next);
    }

    const memberSpaceIds = [...memberSpaceIdToRole.keys()];
    if (memberSpaceIds.length > 0) {
      const { data: spaceRows, error: spaceErr } = await supabase
        .from('Space')
        .select('id, slug, name, ownerId')
        .in('id', memberSpaceIds);
      if (spaceErr) throw spaceErr;

      memberSpaces = ((spaceRows ?? []) as Array<{
        id: string;
        slug: string;
        name: string;
        ownerId: string;
      }>).map((s) => ({
        ...s,
        role: memberSpaceIdToRole.get(s.id) ?? 'member',
      }));
    }
  }

  // 4. Batch-fetch owner names for the "owned by Jane" subtitle.
  const ownerIds = Array.from(
    new Set([
      ...ownedRows.map((s) => s.ownerId),
      ...memberSpaces.map((s) => s.ownerId),
    ]),
  );

  const ownerNameById = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: ownerRows, error: ownerErr } = await supabase
      .from('User')
      .select('id, name, email')
      .in('id', ownerIds);
    if (ownerErr) throw ownerErr;
    for (const u of (ownerRows ?? []) as Array<{
      id: string;
      name: string | null;
      email: string | null;
    }>) {
      ownerNameById.set(u.id, u.name?.trim() || u.email?.trim() || 'Unknown');
    }
  }

  // 5. Merge to UserSpace records.
  const merged: UserSpace[] = [
    ...ownedRows.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      ownerName: ownerNameById.get(s.ownerId) ?? 'Unknown',
      role: 'owner' as const,
      isCurrent: currentSpaceId !== undefined && s.id === currentSpaceId,
    })),
    ...memberSpaces.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      ownerName: ownerNameById.get(s.ownerId) ?? 'Unknown',
      role: s.role,
      isCurrent: currentSpaceId !== undefined && s.id === currentSpaceId,
    })),
  ];

  // 6. Sort: current first, then owners, then members. Within each tier,
  //    by name (case-insensitive).
  merged.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    if (a.role !== b.role) {
      if (a.role === 'owner') return -1;
      if (b.role === 'owner') return 1;
      // admin before member among non-owners
      if (a.role === 'admin' && b.role === 'member') return -1;
      if (b.role === 'admin' && a.role === 'member') return 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return merged;
}

function rank(role: UserSpaceRole): number {
  if (role === 'owner') return 0;
  if (role === 'admin') return 1;
  return 2;
}
