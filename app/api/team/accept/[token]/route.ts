/**
 * POST /api/team/accept/[token]
 *
 * Accept a pending TeamInvite. Caller must be logged into Clerk and their
 * primary email must match the invite. We insert a TeamMembership row with
 * the invite's role and flip acceptedAt.
 *
 * Status codes:
 *   401 — not logged in
 *   404 — token does not exist
 *   410 — expired or already accepted (the link is gone)
 *   403 — logged-in user's email does not match the invite
 *   200 — { teamId, role }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClerkClient } from '@clerk/nextjs/server';
import { requireAuth } from '@/lib/api-auth';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY!,
});

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { token } = await params;
  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'Invalid invite link.' }, { status: 404 });
  }

  const { data: invite } = await supabase
    .from('TeamInvite')
    .select('id, teamId, email, role, expiresAt, acceptedAt')
    .eq('token', token)
    .maybeSingle();

  if (!invite) {
    return NextResponse.json({ error: 'Invite not found.' }, { status: 404 });
  }

  const row = invite as {
    id: string;
    teamId: string;
    email: string;
    role: 'admin' | 'member';
    expiresAt: string;
    acceptedAt: string | null;
  };

  if (row.acceptedAt) {
    return NextResponse.json({ error: 'This invite has already been used.' }, { status: 410 });
  }
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    return NextResponse.json({ error: 'This invite has expired.' }, { status: 410 });
  }

  // Email match check — the accepter has to be the person who was invited.
  let primaryEmail: string | null = null;
  try {
    const clerkUser = await clerkClient.users.getUser(userId);
    const primary = clerkUser.emailAddresses.find(
      (e) => e.id === clerkUser.primaryEmailAddressId,
    );
    primaryEmail = primary?.emailAddress?.toLowerCase() ?? null;
  } catch (err) {
    logger.error('[team.accept] clerk user lookup failed', {
      userId,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'Could not verify your account. Try again.' },
      { status: 500 },
    );
  }

  if (!primaryEmail || primaryEmail !== row.email.toLowerCase()) {
    return NextResponse.json(
      { error: 'Sign in with the email this invite was sent to.' },
      { status: 403 },
    );
  }

  // Insert the membership. UNIQUE (teamId, userId) prevents duplicates if
  // the accepter clicks twice — treat that as success (idempotent).
  const { error: insertErr } = await supabase
    .from('TeamMembership')
    .insert({
      teamId: row.teamId,
      userId,
      role: row.role,
    });

  if (insertErr) {
    const msg = insertErr.message ?? '';
    const isDup = msg.includes('duplicate key') || msg.includes('TeamMembership_teamId_userId_key');
    if (!isDup) {
      logger.error('[team.accept] membership insert failed', {
        userId,
        teamId: row.teamId,
        err: msg,
      });
      return NextResponse.json(
        { error: 'Could not join the team. Try again.' },
        { status: 500 },
      );
    }
  }

  const { error: updateErr } = await supabase
    .from('TeamInvite')
    .update({ acceptedAt: new Date().toISOString() })
    .eq('id', row.id);

  if (updateErr) {
    // Membership exists; flipping the flag failed. Log loud, succeed anyway —
    // the row will look pending in the UI until a manual cleanup. The
    // alternative is rolling back a valid membership, which is worse.
    logger.error('[team.accept] mark-accepted failed', {
      inviteId: row.id,
      err: updateErr.message,
    });
  }

  return NextResponse.json({ teamId: row.teamId, role: row.role });
}
