/**
 * GET /api/agent/plan/[runId]
 *
 * The Plan View polling endpoint. The detail page's client island
 * (PlanDetailPoll) hits this every 5s until the run is terminal and
 * re-renders the surface in place. Read-only.
 *
 * Auth: scoped to the calling user's space. A run id from a different
 * space returns 404, not 403 — we don't reveal whether the run
 * exists.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { loadPlanForRun } from '@/lib/plans/plan-repo';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const space = await getSpaceForUser(userId);
  if (!space) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { runId } = await context.params;
  const run = await loadPlanForRun(space.id, runId);
  if (!run) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(
    { run },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
