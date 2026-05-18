/**
 * POST /api/agent-bridge/emit-realtime
 *
 * Python → TS bridge for emitting realtime ticks. The Python orchestrator
 * pauses an AgentTask for approval (or any other audit-relevant write) and
 * calls this endpoint so connected clients refresh without polling. The
 * tick lives in Convex (`realtimeTicks.emit`); this route is the thin
 * server-side wrapper that authenticates Python and forwards.
 *
 * Auth: `Authorization: Bearer ${AGENT_INTERNAL_SECRET}` — the same
 * shared secret /api/agent/events uses for the existing Modal → Next.js
 * channel (see agent/tools/streaming.py:publish_event).
 *
 * Body: { spaceId: string; kind: 'approval' | 'audit'; summary?: string }
 *
 * Response: { emitted: boolean } — best-effort. 200 even when Convex is
 * unavailable; the producer doesn't care, the live signal is a layer on
 * top of the focus-refresh fallback.
 */

import { NextRequest, NextResponse } from 'next/server';
import { emitRealtimeTick, type RealtimeTickKind } from '@/lib/convex/server-emit-tick';

const VALID_KINDS: ReadonlySet<RealtimeTickKind> = new Set(['approval', 'audit']);

function checkBridgeAuth(authHeader: string | null): boolean {
  const expected = process.env.AGENT_INTERNAL_SECRET;
  if (!expected) return false;
  if (!authHeader) return false;
  const prefix = 'Bearer ';
  if (!authHeader.startsWith(prefix)) return false;
  return authHeader.slice(prefix.length).trim() === expected;
}

interface PostBody {
  spaceId?: unknown;
  kind?: unknown;
  summary?: unknown;
}

export async function POST(req: NextRequest) {
  if (!checkBridgeAuth(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body.spaceId !== 'string' || body.spaceId.length === 0) {
    return NextResponse.json({ error: 'spaceId (string) required' }, { status: 400 });
  }
  if (typeof body.kind !== 'string' || !VALID_KINDS.has(body.kind as RealtimeTickKind)) {
    return NextResponse.json(
      { error: `kind must be one of: ${Array.from(VALID_KINDS).join(', ')}` },
      { status: 400 },
    );
  }

  const summary =
    typeof body.summary === 'string' && body.summary.trim().length > 0
      ? body.summary.trim().slice(0, 200)
      : undefined;

  const emitted = await emitRealtimeTick({
    spaceId: body.spaceId,
    kind: body.kind as RealtimeTickKind,
    summary,
  });

  return NextResponse.json({ emitted });
}
