/**
 * GET /api/cron/canvas-activity-bridge
 *
 * Polling bridge that turns recent SwarmMember status transitions into
 * Convex canvasActivity pings. Cheap and idempotent. Runs once a minute
 * via vercel.json; the per-process de-dupe set inside the bridge keeps
 * us from re-emitting the same transition on overlapping invocations.
 *
 * Auth: Bearer ${CRON_SECRET} (same pattern as the other crons here).
 */

import { NextRequest, NextResponse } from 'next/server';
import { runCanvasActivityBridge } from '@/lib/convex/dept-activity-bridge';

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  const auth = req.headers.get('Authorization');
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await runCanvasActivityBridge();
  return NextResponse.json({ ok: true, ...result }, { status: 200 });
}
