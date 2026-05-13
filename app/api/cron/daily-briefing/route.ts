/**
 * GET /api/cron/daily-briefing
 *
 * Iterates every active Space (subscription active or trialing, owner has
 * email) and sends the daily founder briefing via Resend. Failures are
 * logged but never crash the whole job. Returns an aggregate summary.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}`. Same guard pattern as the
 * other cron routes in `app/api/cron/*`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { buildDailyBriefing } from '@/lib/briefing/build-daily-briefing';
import { renderDailyBriefing } from '@/lib/briefing/render-briefing-email';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

function getFromAddress(): string {
  const raw = process.env.RESEND_FROM_EMAIL ?? 'notifications@alerts.usechippi.com';
  return raw.includes('@') ? raw : `notifications@${raw}`;
}

interface SpaceWithOwnerRow {
  id: string;
  slug: string;
  ownerId: string;
  owner?: { email: string | null; name: string | null } | { email: string | null; name: string | null }[] | null;
}

interface Failure {
  spaceId: string;
  error: string;
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logger.error('[cron.daily-briefing] CRON_SECRET not set');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  const auth = req.headers.get('Authorization');
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return NextResponse.json({ error: 'Resend not configured' }, { status: 500 });
  }
  const resend = new Resend(resendKey);

  // Load active spaces. Embedded owner read avoids a second round-trip per
  // space; PostgREST returns the join as an array (or object, depending on
  // FK cardinality) so we normalise below.
  const { data, error } = await supabase
    .from('Space')
    .select('id, slug, ownerId, owner:User!Space_ownerId_fkey(email, name)')
    .in('stripeSubscriptionStatus', ['active', 'trialing']);

  if (error) {
    logger.error('[cron.daily-briefing] failed to load spaces', { err: error.message });
    return NextResponse.json({ error: 'DB query failed' }, { status: 500 });
  }

  const spaces = (data ?? []) as SpaceWithOwnerRow[];
  const failures: Failure[] = [];
  let sent = 0;

  for (const space of spaces) {
    const owner = Array.isArray(space.owner) ? space.owner[0] : space.owner;
    const email = owner?.email ?? null;
    if (!email) {
      failures.push({ spaceId: space.id, error: 'no_owner_email' });
      continue;
    }

    try {
      const briefing = await buildDailyBriefing(space.id);
      if (!briefing) {
        failures.push({ spaceId: space.id, error: 'build_failed' });
        continue;
      }
      const rendered = renderDailyBriefing(briefing, space.slug);
      const { error: sendErr } = await resend.emails.send({
        from: getFromAddress(),
        to: email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.plainText,
      });
      if (sendErr) {
        logger.warn('[cron.daily-briefing] send failed', {
          spaceId: space.id,
          err: sendErr.message,
        });
        failures.push({ spaceId: space.id, error: sendErr.message });
        continue;
      }
      sent += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('[cron.daily-briefing] threw for space', {
        spaceId: space.id,
        err: msg,
      });
      failures.push({ spaceId: space.id, error: msg });
    }
  }

  const summary = {
    total: spaces.length,
    sent,
    failed: failures.length,
    failures,
  };
  logger.info('[cron.daily-briefing] complete', summary);
  return NextResponse.json(summary);
}
