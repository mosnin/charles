/**
 * DELETE /api/team/invites/[inviteId]
 *
 * Revoke a pending TeamInvite. Caller must be at least 'admin' in their
 * team. Accepted invites cannot be revoked here — those are historical
 * records, not pending state.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { requireRole } from '@/lib/team/permissions';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ inviteId: string }> },
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { inviteId } = await params;
  if (!inviteId) {
    return NextResponse.json({ error: 'Invite id is required.' }, { status: 400 });
  }

  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    await requireRole(space.id, userId, 'admin');
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: team } = await supabase
    .from('Team')
    .select('id')
    .eq('spaceId', space.id)
    .maybeSingle();
  const teamId = (team as { id?: string } | null)?.id;
  if (!teamId) {
    return NextResponse.json({ error: 'Invite not found.' }, { status: 404 });
  }

  const { data: invite } = await supabase
    .from('TeamInvite')
    .select('id, teamId, acceptedAt')
    .eq('id', inviteId)
    .maybeSingle();

  if (!invite) {
    return NextResponse.json({ error: 'Invite not found.' }, { status: 404 });
  }

  const row = invite as { id: string; teamId: string; acceptedAt: string | null };
  if (row.teamId !== teamId) {
    return NextResponse.json({ error: 'Invite not found.' }, { status: 404 });
  }
  if (row.acceptedAt) {
    return NextResponse.json(
      { error: 'This invite has already been accepted.' },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from('TeamInvite')
    .delete()
    .eq('id', row.id);

  if (error) {
    logger.error('[team.invites.delete] delete failed', {
      userId,
      inviteId: row.id,
      err: error.message,
    });
    return NextResponse.json(
      { error: 'Could not revoke the invite. Try again.' },
      { status: 500 },
    );
  }

  return new NextResponse(null, { status: 204 });
}
