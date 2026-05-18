/**
 * POST /api/agent-bridge/delegate
 *
 * Bridges a department delegation from the TS chat surface to the Python
 * manager (agent/web/bridge.py via Modal). The Python side persists
 * SwarmMember rows itself — we just forward and return the result.
 *
 * Body: { department: Department; task: string; context?: string; runId?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import {
  callDelegate,
  BridgeAuthError,
  BridgeConfigError,
  BridgeHttpError,
  DEPARTMENTS,
  type Department,
} from '@/lib/agent-bridge/client';

interface PostBody {
  department?: unknown;
  task?: unknown;
  context?: unknown;
  runId?: unknown;
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

  const department = typeof body.department === 'string' ? body.department : '';
  const task = typeof body.task === 'string' ? body.task.trim() : '';
  const context = typeof body.context === 'string' ? body.context : undefined;
  const runId = typeof body.runId === 'string' ? body.runId : undefined;

  if (!task) {
    return NextResponse.json({ error: 'task required' }, { status: 400 });
  }
  if (!(DEPARTMENTS as readonly string[]).includes(department)) {
    return NextResponse.json(
      { error: `department must be one of: ${DEPARTMENTS.join(', ')}` },
      { status: 400 },
    );
  }

  try {
    const result = await callDelegate({
      spaceId: space.id,
      runId,
      department: department as Department,
      task,
      context,
    });
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
