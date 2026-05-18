/**
 * POST /api/agent-bridge/advance-stage
 *
 * Body: { newStage: string; reason?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import {
  callAdvanceStage,
  BridgeAuthError,
  BridgeConfigError,
  BridgeHttpError,
} from '@/lib/agent-bridge/client';

const VALID_STAGES = ['idea', 'initial', 'identity', 'building', 'selling', 'scaling'];

interface PostBody {
  newStage?: unknown;
  reason?: unknown;
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const newStage = typeof body.newStage === 'string' ? body.newStage.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason : undefined;

  if (!VALID_STAGES.includes(newStage)) {
    return NextResponse.json(
      { error: `newStage must be one of: ${VALID_STAGES.join(', ')}` },
      { status: 400 },
    );
  }

  try {
    const result = await callAdvanceStage({ spaceId: space.id, newStage, reason });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof BridgeConfigError) {
      return NextResponse.json(
        { error: 'Modal bridge not configured', detail: err.message },
        { status: 503 },
      );
    }
    if (err instanceof BridgeAuthError) {
      return NextResponse.json(
        { error: 'Bridge auth failure', detail: err.message },
        { status: 502 },
      );
    }
    if (err instanceof BridgeHttpError) {
      return NextResponse.json(
        { error: 'Bridge call failed', detail: err.message },
        { status: 502 },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Bridge error', detail: msg }, { status: 502 });
  }
}
