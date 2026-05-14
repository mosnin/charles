/**
 * API authentication helpers — replace repeated auth boilerplate in every route.
 *
 * Usage:
 *   const result = await requireSpaceOwner(slug);
 *   if (result instanceof NextResponse) return result;
 *   const { userId, space } = result;
 */

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getSpaceFromSlug, getSpaceForUser } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import type { Space } from '@/lib/types';

/**
 * Returns { userId } or a 401/403 NextResponse.
 *
 * Offboarding hard-stop: after Clerk auth succeeds we look up the User row
 * and reject with 403 if `status === 'offboarded'`. The realtor-era usage
 * (broker offboarding an agent) is gone with the Brokerage tables, but the
 * gate stays because the Charles team model will reuse the same flag — a
 * founder can revoke a teammate without waiting for Clerk session expiry.
 * Resilience: a missing User row or absent `status` column falls through as
 * active so this check is safe to ship ahead of any schema work.
 */
export async function requireAuth(): Promise<{ userId: string } | NextResponse> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { data: userRow } = await supabase
      .from('User')
      .select('id, status')
      .eq('clerkId', userId)
      .maybeSingle();

    if (userRow && (userRow as { status?: string }).status === 'offboarded') {
      return NextResponse.json(
        { error: 'Your access has been revoked.', code: 'offboarded' },
        { status: 403 },
      );
    }
  } catch {
    // Swallow: treat as active. We never want this lookup to break
    // authenticated traffic on a transient DB hiccup.
  }

  return { userId };
}

/**
 * Checks that a space has an active or trialing subscription.
 * Admins bypass the check. Returns null if OK, or a 403 NextResponse.
 */
export async function requireActiveSubscription(
  space: Space,
  userId?: string,
): Promise<NextResponse | null> {
  const status = space.stripeSubscriptionStatus ?? 'inactive';
  if (status === 'active' || status === 'trialing') return null;

  // Check if user is a platform admin (admins bypass paywall)
  if (userId) {
    const { data: userRow } = await supabase
      .from('User')
      .select('platformRole')
      .eq('clerkId', userId)
      .maybeSingle();
    if (userRow?.platformRole === 'admin') return null;
  }

  return NextResponse.json(
    { error: 'Active subscription required' },
    { status: 403 },
  );
}

/**
 * Verifies the calling user owns the given workspace slug.
 * Returns { userId, space } or a 4xx NextResponse.
 *
 * The realtor-era broker-managed-space fallback was removed with the
 * Brokerage tables. Charles teams will provide a similar shared-access
 * pathway when the team model lands.
 */
export async function requireSpaceOwner(
  slug: string,
): Promise<{ userId: string; space: Space } | NextResponse> {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const [space, userSpace] = await Promise.all([
    getSpaceFromSlug(slug),
    getSpaceForUser(userId),
  ]);
  if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

  if (userSpace && space.id === userSpace.id) {
    return { userId, space };
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

/**
 * Same as requireSpaceOwner but also enforces active subscription.
 */
export async function requirePaidSpaceOwner(
  slug: string,
): Promise<{ userId: string; space: Space } | NextResponse> {
  const result = await requireSpaceOwner(slug);
  if (result instanceof NextResponse) return result;
  const { userId, space } = result;

  const subCheck = await requireActiveSubscription(space, userId);
  if (subCheck) return subCheck;

  return { userId, space };
}

