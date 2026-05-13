/**
 * DELETE /api/team/members/[memberId]
 *
 * Remove a teammate from the team. Caller must be at least 'admin'.
 *
 *   - The team owner cannot be removed. There is exactly one owner and the
 *     team cannot exist without them.
 *   - Self-removal is rejected here. A separate "leave team" flow can be
 *     added later if needed; mixing it in here invites surprising failure
 *     modes (admin removes themselves, no one left to manage).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { requireRole } from '@/lib/team/permissions';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ memberId: string }> },
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { memberId } = await params;
  if (!memberId) {
    return NextResponse.json({ error: 'Member id is required.' }, { status: 400 });
  }

  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    await requireRole(space.id, userId, 'admin');
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Resolve the membership and the team in one shot, scoped to the caller's
  // space so an admin from team A can't reach into team B by guessing ids.
  const { data: team } = await supabase
    .from('Team')
    .select('id')
    .eq('spaceId', space.id)
    .maybeSingle();
  const teamId = (team as { id?: string } | null)?.id;
  if (!teamId) {
    return NextResponse.json({ error: 'Team not found.' }, { status: 404 });
  }

  const { data: membership } = await supabase
    .from('TeamMembership')
    .select('id, teamId, userId, role')
    .eq('id', memberId)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: 'Member not found.' }, { status: 404 });
  }

  const m = membership as { id: string; teamId: string; userId: string; role: string };

  if (m.teamId !== teamId) {
    // The id exists but belongs to a different team — surface as not-found
    // rather than leaking cross-team existence.
    return NextResponse.json({ error: 'Member not found.' }, { status: 404 });
  }

  if (m.role === 'owner') {
    return NextResponse.json(
      { error: "The team owner cannot be removed." },
      { status: 400 },
    );
  }

  if (m.userId === userId) {
    return NextResponse.json(
      { error: "You can't remove yourself here." },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from('TeamMembership')
    .delete()
    .eq('id', m.id);

  if (error) {
    logger.error('[team.members.delete] delete failed', {
      userId,
      memberId: m.id,
      err: error.message,
    });
    return NextResponse.json(
      { error: 'Could not remove member. Try again.' },
      { status: 500 },
    );
  }

  return new NextResponse(null, { status: 204 });
}
