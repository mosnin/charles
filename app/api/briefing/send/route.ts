/**
 * POST /api/briefing/send
 *
 * Sends a daily founder briefing to a single space's owner. Auth via
 * `Authorization: Bearer ${CRON_SECRET}` so only the cron runner (or a
 * manually-triggered admin curl) can hit it. Body: `{ spaceId }`.
 *
 * On Resend failure returns 502 with the error message — never crashes
 * the caller. On success returns `{ sent: true, messageId }`.
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

async function loadOwnerEmail(
  spaceId: string,
): Promise<{ email: string; slug: string } | null> {
  const { data: space, error: spaceErr } = await supabase
    .from('Space')
    .select('id, slug, ownerId')
    .eq('id', spaceId)
    .maybeSingle();
  if (spaceErr || !space) return null;
  const { data: user, error: userErr } = await supabase
    .from('User')
    .select('email')
    .eq('id', (space as { ownerId: string }).ownerId)
    .maybeSingle();
  if (userErr || !user) return null;
  const email = (user as { email: string | null }).email;
  if (!email) return null;
  return { email, slug: (space as { slug: string }).slug };
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logger.error('[briefing.send] CRON_SECRET not set');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  const auth = req.headers.get('Authorization');
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { spaceId?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const spaceId = typeof body.spaceId === 'string' ? body.spaceId : null;
  if (!spaceId) {
    return NextResponse.json({ error: 'spaceId required' }, { status: 400 });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return NextResponse.json({ error: 'Resend not configured' }, { status: 500 });
  }

  const owner = await loadOwnerEmail(spaceId);
  if (!owner) {
    return NextResponse.json({ error: 'Space or owner not found' }, { status: 404 });
  }

  const briefing = await buildDailyBriefing(spaceId);
  if (!briefing) {
    return NextResponse.json({ error: 'Failed to build briefing' }, { status: 500 });
  }

  const email = renderDailyBriefing(briefing, owner.slug);

  try {
    const resend = new Resend(resendKey);
    const { data, error } = await resend.emails.send({
      from: getFromAddress(),
      to: owner.email,
      subject: email.subject,
      html: email.html,
      text: email.plainText,
    });
    if (error) {
      logger.error('[briefing.send] Resend returned error', {
        spaceId,
        err: error.message,
      });
      return NextResponse.json(
        { error: error.message ?? 'Resend failed' },
        { status: 502 },
      );
    }
    return NextResponse.json({ sent: true, messageId: data?.id ?? null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[briefing.send] Resend threw', { spaceId, err: msg });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
