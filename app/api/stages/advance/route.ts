/**
 * POST /api/stages/advance — move the caller's workspace to the next stage.
 *
 * Body: { override?: boolean }
 *
 * Behaviour:
 *   1. Resolve caller's space + current Mission.stage.
 *   2. If current stage is the last one ('scaling') → 400.
 *   3. If override !== true and incomplete gates exist for the current stage,
 *      respond 409 with the list of remaining gate titles.
 *   4. Otherwise: close the open WorkspaceStage row (exitedAt = now,
 *      exitedBy = override ? 'founder' : 'gate'), insert a new WorkspaceStage
 *      row for nextStage, update Mission.stage.
 *
 * 200: { stage, advancedAt }
 * 400: already at final stage / malformed body
 * 401: unauth
 * 403: caller has no space / no mission
 * 409: incomplete gates blocking advance (when override is false)
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { nextStage, type Stage } from '@/lib/stages/catalog';

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  let body: { override?: unknown } = {};
  try {
    body = (await req.json().catch(() => ({}))) as { override?: unknown };
  } catch {
    body = {};
  }
  const override = body.override === true;

  const space = await getSpaceForUser(userId);
  if (!space) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: mission, error: missionErr } = await supabase
    .from('Mission')
    .select('id, stage')
    .eq('spaceId', space.id)
    .maybeSingle();
  if (missionErr) {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (!mission) {
    return NextResponse.json({ error: 'No mission for this space' }, { status: 403 });
  }

  const current = (mission as { stage: Stage }).stage;
  const next = nextStage(current);
  if (!next) {
    return NextResponse.json(
      { error: 'Already at the final stage' },
      { status: 400 },
    );
  }

  if (!override) {
    const { data: incompleteGates, error: gateErr } = await supabase
      .from('StageGate')
      .select('id, title')
      .eq('spaceId', space.id)
      .eq('stage', current)
      .eq('isComplete', false);
    if (gateErr) {
      return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
    }
    if (incompleteGates && incompleteGates.length > 0) {
      return NextResponse.json(
        {
          error: 'Incomplete gates',
          gates: (incompleteGates as Array<{ title: string }>).map((g) => g.title),
        },
        { status: 409 },
      );
    }
  }

  const advancedAt = new Date().toISOString();

  // Close the currently-open WorkspaceStage row, if any. Best-effort —
  // if no row exists (older spaces predating the table) we still advance.
  await supabase
    .from('WorkspaceStage')
    .update({ exitedAt: advancedAt, exitedBy: override ? 'founder' : 'gate' })
    .eq('spaceId', space.id)
    .is('exitedAt', null);

  const { error: insertErr } = await supabase.from('WorkspaceStage').insert({
    spaceId: space.id,
    stage: next,
    enteredAt: advancedAt,
  });
  if (insertErr) {
    return NextResponse.json({ error: 'Could not record stage transition' }, { status: 500 });
  }

  const { error: missionUpdateErr } = await supabase
    .from('Mission')
    .update({ stage: next, updatedAt: advancedAt })
    .eq('spaceId', space.id);
  if (missionUpdateErr) {
    return NextResponse.json({ error: 'Could not update mission' }, { status: 500 });
  }

  // Seed the new stage's gates. Idempotent on the SQL side — re-advancing or
  // skipping back is safe. Failure here doesn't block the advance; the
  // founder can call advance again or the manager will lazy-seed on its next turn.
  await supabase.rpc('seed_stage_gates', { p_space_id: space.id, p_stage: next });

  return NextResponse.json({ stage: next, advancedAt });
}
