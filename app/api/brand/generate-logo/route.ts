/**
 * POST /api/brand/generate-logo — hit OpenAI Images for a logo seed.
 *
 * Server-side because the OpenAI key never touches the client. We cap
 * generations to MAX_PER_HOUR per space using a process-local map. The cap
 * is intentionally cheap and ephemeral — its only job is to stop a founder
 * from running up an OpenAI bill while playing with the wizard. If the
 * process restarts the counter resets; that's acceptable.
 *
 * 200: { url }
 * 400: bad body
 * 401: unauthenticated
 * 403: caller has no workspace
 * 429: hourly cap exceeded
 * 502: image gen upstream failed
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { openaiGenerateImage } from '@/lib/integrations/adapters/openai-images';

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_HOUR = 3;

// Module-level so the counter survives between requests within a single
// Node process. Vercel's serverless model means this cap is best-effort
// across instances — that's fine. It's a spend brake, not a paywall.
const buckets = new Map<string, number[]>();

function checkAndRecord(spaceId: string, now: number): { ok: true } | { ok: false; remainingMs: number } {
  const stamps = buckets.get(spaceId) ?? [];
  const fresh = stamps.filter((t) => now - t < WINDOW_MS);
  if (fresh.length >= MAX_PER_HOUR) {
    const oldest = fresh[0]!;
    return { ok: false, remainingMs: WINDOW_MS - (now - oldest) };
  }
  fresh.push(now);
  buckets.set(spaceId, fresh);
  return { ok: true };
}

/** Test-only reset. Not exported in any client code path. */
export function __resetBuckets(): void {
  buckets.clear();
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  let body: { prompt?: unknown };
  try {
    body = (await req.json()) as { prompt?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
    return NextResponse.json({ error: 'prompt (string) is required' }, { status: 400 });
  }
  // Length sanity-check — OpenAI accepts long prompts but a 5k-character
  // prompt is almost always a bug or an injection attempt.
  if (body.prompt.length > 2000) {
    return NextResponse.json({ error: 'prompt is too long' }, { status: 400 });
  }

  const space = await getSpaceForUser(userId);
  if (!space) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const gate = checkAndRecord(space.id, Date.now());
  if (!gate.ok) {
    return NextResponse.json(
      { error: 'Too many generations this hour. Wait or save what you have.' },
      { status: 429 },
    );
  }

  try {
    const result = await openaiGenerateImage(space.id, {
      prompt: body.prompt,
      size: '1024x1024',
      n: 1,
    });
    const url = result.urls[0];
    if (!url) {
      return NextResponse.json({ error: 'Image generation returned no result.' }, { status: 502 });
    }
    return NextResponse.json({ url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Image generation failed.';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
