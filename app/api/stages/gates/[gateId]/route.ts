/**
 * PATCH /api/stages/gates/[gateId] — toggle a StageGate's isComplete flag.
 *
 * Auth: caller must own the space the gate belongs to (or be a broker
 * owner/admin of the brokerage that manages it — same rules as the rest
 * of the API).
 *
 * Body: { isComplete: boolean }
 * 200:  { id, isComplete, completedAt }
 * 400:  body missing / wrong shape
 * 401:  unauthenticated
 * 403:  gate exists but the caller does not own its space
 * 404:  gate does not exist
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ gateId: string }> },
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { gateId } = await params;
  if (!gateId) {
    return NextResponse.json({ error: 'gateId required' }, { status: 400 });
  }

  let body: { isComplete?: unknown };
  try {
    body = (await req.json()) as { isComplete?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (typeof body.isComplete !== 'boolean') {
    return NextResponse.json(
      { error: 'isComplete (boolean) is required' },
      { status: 400 },
    );
  }
  const nextComplete = body.isComplete;

  const { data: gate, error: gateErr } = await supabase
    .from('StageGate')
    .select('id, spaceId, isComplete')
    .eq('id', gateId)
    .maybeSingle();
  if (gateErr) {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (!gate) {
    return NextResponse.json({ error: 'Gate not found' }, { status: 404 });
  }

  const callerSpace = await getSpaceForUser(userId);
  if (!callerSpace || callerSpace.id !== (gate as { spaceId: string }).spaceId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const completedAt = nextComplete ? new Date().toISOString() : null;

  const { data: updated, error: updateErr } = await supabase
    .from('StageGate')
    .update({ isComplete: nextComplete, completedAt })
    .eq('id', gateId)
    .select('id, isComplete, completedAt')
    .single();
  if (updateErr || !updated) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  return NextResponse.json(updated);
}
