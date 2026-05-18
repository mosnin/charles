/**
 * Central permission helpers.
 *
 * Two account levels survive the Charles cleanup:
 *   1. Founder (default) — single-workspace owner
 *   2. Platform Admin — User.platformRole = 'admin'
 *
 * The realtor-era Broker/Brokerage layer is gone with the Brokerage and
 * BrokerageMembership tables. The Charles team model (Team /
 * TeamMembership / TeamInvite) replaces it; its permission helpers will
 * land alongside the team join flow in a later phase.
 */

import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';

// ── Platform admin ────────────────────────────────────────────────────────────

/**
 * Returns true if the current Clerk user is a platform admin.
 * Only check: User.platformRole = 'admin' in DB (single source of truth).
 */
export async function isPlatformAdmin(): Promise<boolean> {
  const session = await auth();
  if (!session.userId) return false;

  const { data } = await supabase
    .from('User')
    .select('platformRole')
    .eq('clerkId', session.userId)
    .maybeSingle();
  return data?.platformRole === 'admin';
}

/**
 * Require platform admin access. Throws if not admin.
 * Use at the top of admin route handlers and server components.
 */
export async function requirePlatformAdmin(): Promise<{ clerkUserId: string }> {
  const session = await auth();
  if (!session.userId) throw new Error('Forbidden: not authenticated');

  const ok = await isPlatformAdmin();
  if (!ok) throw new Error('Forbidden: platform admin access required');

  return { clerkUserId: session.userId };
}

// ── Shared auth helper ────────────────────────────────────────────────────────

/**
 * Resolve the current Clerk user to their internal User row.
 * Returns null if not authenticated or not in DB.
 */
export async function getCurrentDbUser(): Promise<{ id: string; clerkId: string } | null> {
  const session = await auth();
  if (!session.userId) return null;

  const { data } = await supabase
    .from('User')
    .select('id, clerkId')
    .eq('clerkId', session.userId)
    .maybeSingle();
  return data ?? null;
}
