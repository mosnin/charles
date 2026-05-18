/**
 * POST /api/agent-bridge/get-mission
 *
 * Body: {} — the space is inferred from the authenticated user.
 *
 * Why POST not GET? All bridge endpoints are POST on the Python side
 * (Modal fastapi_endpoint). Keeping shape uniform across the four routes
 * makes the client trivial.
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import {
  callGetMission,
  BridgeAuthError,
  BridgeConfigError,
  BridgeHttpError,
} from '@/lib/agent-bridge/client';

export async function POST() {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const result = await callGetMission(space.id);
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
