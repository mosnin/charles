/**
 * GET /api/cron/audit-backfill
 *
 * Drains the Convex liveMessages bridge into Supabase TaskMessage on a
 * ten-minute cadence. Same Bearer-secret guard as the other cron
 * routes. Returns aggregate counts; never throws.
 */

import { NextRequest, NextResponse } from 'next/server';
import { backfillUnpersistedMessages } from '@/lib/convex/audit-backfill';
import { logger } from '@/lib/logger';

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logger.error('[cron.audit-backfill] CRON_SECRET not set');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  const auth = req.headers.get('Authorization');
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await backfillUnpersistedMessages();
    logger.info('[cron.audit-backfill] complete', {
      persisted: result.persisted,
      failed: result.failed,
    });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[cron.audit-backfill] threw', { err: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
