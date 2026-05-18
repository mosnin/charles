/**
 * POST /api/team/invite
 *
 * Issue a pending TeamInvite. Caller must be at least 'admin' in their
 * team. Owners cannot be invited — there is exactly one owner per team and
 * that's the founder. Side effect: emails the invitee via Resend if the
 * key is set; the row is the source of truth either way.
 *
 * Body: { email: string; role: 'admin' | 'member' }
 * Returns: { inviteId, token, expiresAt, acceptUrl }
 */
import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { requireRole } from '@/lib/team/permissions';
import { supabase } from '@/lib/supabase';
import { sendTeamInvite } from '@/lib/email';
import { logger } from '@/lib/logger';

const INVITE_TTL_DAYS = 7;

function isEmail(v: unknown): v is string {
  return typeof v === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { email, role } = (body ?? {}) as { email?: unknown; role?: unknown };
  if (!isEmail(email)) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  }
  if (role !== 'admin' && role !== 'member') {
    return NextResponse.json(
      { error: "Role must be 'admin' or 'member'." },
      { status: 400 },
    );
  }

  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    await requireRole(space.id, userId, 'admin');
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Resolve / ensure Team row. Most spaces already have one from onboarding;
  // for older spaces we lazy-create on first invite so the founder never has
  // to think about it.
  const { data: existingTeam } = await supabase
    .from('Team')
    .select('id, name')
    .eq('spaceId', space.id)
    .maybeSingle();

  let teamId = (existingTeam as { id?: string } | null)?.id ?? null;
  let teamName = (existingTeam as { name?: string } | null)?.name ?? space.name;

  if (!teamId) {
    const { data: created, error: createErr } = await supabase
      .from('Team')
      .insert({ spaceId: space.id, name: space.name })
      .select('id, name')
      .single();
    if (createErr || !created) {
      logger.error('[team.invite] team auto-create failed', {
        userId,
        spaceId: space.id,
        err: createErr?.message,
      });
      return NextResponse.json(
        { error: 'Could not start the invite. Try again.' },
        { status: 500 },
      );
    }
    teamId = (created as { id: string }).id;
    teamName = (created as { name: string }).name;
  }

  const token = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  const { data: inserted, error } = await supabase
    .from('TeamInvite')
    .insert({
      teamId,
      email: (email as string).toLowerCase(),
      role,
      token,
      invitedById: userId,
      expiresAt: expiresAt.toISOString(),
    })
    .select('id')
    .single();

  if (error || !inserted) {
    const msg = error?.message ?? '';
    // Unique partial index on (teamId, email) where acceptedAt IS NULL.
    if (msg.includes('TeamInvite_team_email_pending_uq') || msg.includes('duplicate key')) {
      return NextResponse.json(
        { error: 'There is already a pending invite for that email.' },
        { status: 409 },
      );
    }
    logger.error('[team.invite] insert failed', {
      userId,
      teamId,
      err: msg,
    });
    return NextResponse.json(
      { error: 'Could not send the invite. Try again.' },
      { status: 500 },
    );
  }

  const inviteId = (inserted as { id: string }).id;
  const acceptUrl = `/team/accept/${token}`;

  // Fire-and-forget the email. Failure here does not roll back the row —
  // the founder can copy the acceptUrl from the page if email is misconfigured.
  void sendTeamInvite({
    toEmail: (email as string).toLowerCase(),
    teamName,
    inviterName: null,
    role,
    token,
  }).catch((err) => {
    logger.error('[team.invite] email dispatch failed', {
      teamId,
      err: err instanceof Error ? err.message : String(err),
    });
  });

  return NextResponse.json({
    inviteId,
    token,
    expiresAt: expiresAt.toISOString(),
    acceptUrl,
  });
}
