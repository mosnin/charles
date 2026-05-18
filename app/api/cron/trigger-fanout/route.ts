/**
 * GET /api/cron/trigger-fanout
 *
 * The agent calendar's executor + the daily heartbeat tick. Two
 * responsibilities, one cron because they share the Modal-wake path
 * and we want to wake each space at most once per invocation.
 *
 * (1) Scheduled-trigger fanout
 *     Queries ScheduledTrigger WHERE status='pending' AND runAt <= now,
 *     LIMIT 50 (cap so one slow cron doesn't blow the route timeout).
 *     For each row: push a 'scheduled_wake' event onto the space's
 *     Redis trigger queue with the trigger's reason + payload, then
 *     mark the row fired.
 *
 * (2) Daily heartbeat
 *     For every space whose AgentSettings.enabled=true, if the current
 *     UTC hour matches AgentSettings.heartbeatHourUtc AND
 *     lastHeartbeatAt is null or >23h ago, push a 'heartbeat' event
 *     onto the queue and update lastHeartbeatAt. This wakes Charles
 *     into sweep mode even with no external trigger — gives the
 *     orbit a pulse.
 *
 * After both fan-outs complete, POST Modal's run_now_webhook ONCE per
 * unique spaceId — the orchestrator pops the whole queue on wake, so
 * one HTTP call drains everything we just enqueued.
 *
 * Suggested cadence: every 5 minutes. The 5-min granularity means the
 * heartbeat fires within 5 minutes of the configured hour, and
 * agent-scheduled wakes are accurate to within 5 minutes — fine for a
 * cofounder's calendar.
 *
 * Auth: same Bearer CRON_SECRET pattern as the other cron routes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import {
  listReadyTriggers,
  markTriggerFired,
  type ScheduledTrigger,
} from '@/lib/triggers/scheduled-trigger-repo';

const READY_LIMIT = 50;
const HEARTBEAT_MIN_GAP_HOURS = 23;

interface EnabledSpaceRow {
  spaceId: string;
  heartbeatHourUtc: number;
  lastHeartbeatAt: string | null;
}

interface FanoutSummary {
  scheduledFired: number;
  heartbeatsFired: number;
  modalWakes: number;
  errors: string[];
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (process.env.CRON_TRIGGER_FANOUT_DISABLED === 'true') {
    return NextResponse.json({ ok: true, skipped: 'kill-switch on' });
  }

  const now = new Date();
  const spacesToWake = new Set<string>();
  const summary: FanoutSummary = {
    scheduledFired: 0,
    heartbeatsFired: 0,
    modalWakes: 0,
    errors: [],
  };

  // ── (1) Scheduled-trigger fanout ─────────────────────────────────────
  let ready: ScheduledTrigger[] = [];
  try {
    ready = await listReadyTriggers(now, READY_LIMIT);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push(`listReadyTriggers: ${msg}`);
    logger.error('[cron.trigger-fanout] listReadyTriggers failed', { err: msg });
  }

  for (const trigger of ready) {
    try {
      await pushTriggerEvent(trigger.spaceId, {
        event: 'scheduled_wake',
        triggerId: trigger.id,
        reason: trigger.reason,
        payload: trigger.payload,
        scheduledFor: trigger.runAt,
        source: trigger.source,
      });
      await markTriggerFired(trigger.id);
      spacesToWake.add(trigger.spaceId);
      summary.scheduledFired += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.errors.push(`trigger ${trigger.id}: ${msg}`);
      logger.error('[cron.trigger-fanout] trigger fire failed', {
        triggerId: trigger.id,
        err: msg,
      });
    }
  }

  // ── (2) Daily heartbeat per enabled space ────────────────────────────
  const enabled = await loadEnabledSpaces();
  const nowHour = now.getUTCHours();
  const heartbeatCutoffMs = now.getTime() - HEARTBEAT_MIN_GAP_HOURS * 3600_000;

  for (const space of enabled) {
    if (space.heartbeatHourUtc !== nowHour) continue;
    if (
      space.lastHeartbeatAt &&
      new Date(space.lastHeartbeatAt).getTime() > heartbeatCutoffMs
    ) {
      continue;
    }
    try {
      await pushTriggerEvent(space.spaceId, {
        event: 'heartbeat',
        reason:
          'Daily check-in. Review open tasks, scheduled wakes, and stalled work. ' +
          'If nothing needs attention, end the run cleanly.',
        scheduledFor: now.toISOString(),
        source: 'heartbeat',
      });
      await supabase
        .from('AgentSettings')
        .update({ lastHeartbeatAt: now.toISOString() })
        .eq('spaceId', space.spaceId);
      spacesToWake.add(space.spaceId);
      summary.heartbeatsFired += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.errors.push(`heartbeat ${space.spaceId}: ${msg}`);
      logger.error('[cron.trigger-fanout] heartbeat failed', {
        spaceId: space.spaceId,
        err: msg,
      });
    }
  }

  // ── (3) Wake Modal once per unique space ─────────────────────────────
  const modalUrl = process.env.MODAL_WEBHOOK_URL;
  const modalSecret = process.env.AGENT_INTERNAL_SECRET;
  if (modalUrl && modalSecret) {
    await Promise.all(
      Array.from(spacesToWake).map(async (spaceId) => {
        try {
          const res = await fetch(modalUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ space_id: spaceId, secret: modalSecret }),
          });
          if (!res.ok) {
            const text = await res.text();
            summary.errors.push(
              `modal wake ${spaceId}: ${res.status} ${text.slice(0, 200)}`,
            );
            return;
          }
          summary.modalWakes += 1;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          summary.errors.push(`modal wake ${spaceId}: ${msg}`);
        }
      }),
    );
  } else if (spacesToWake.size > 0) {
    summary.errors.push(
      'MODAL_WEBHOOK_URL or AGENT_INTERNAL_SECRET not set — triggers queued in Redis but Modal not woken',
    );
  }

  return NextResponse.json({ ok: true, now: now.toISOString(), ...summary });
}

// ── helpers ────────────────────────────────────────────────────────────

/**
 * Push a trigger event onto the space's Redis queue in the exact shape
 * agent/orchestrator.py:pop_triggers expects. Format matches what the
 * existing /api/agent/trigger route writes so the orchestrator's
 * trigger-handling code path doesn't need to branch.
 */
async function pushTriggerEvent(
  spaceId: string,
  body: {
    event: string;
    reason: string;
    scheduledFor: string;
    source: string;
    triggerId?: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  const key = `agent:triggers:${spaceId}`;
  const json = JSON.stringify({
    ...body,
    spaceId,
    queuedAt: new Date().toISOString(),
  });
  await redis.rpush(key, json);
}

async function loadEnabledSpaces(): Promise<EnabledSpaceRow[]> {
  const { data, error } = await supabase
    .from('AgentSettings')
    .select('spaceId, heartbeatHourUtc, lastHeartbeatAt')
    .eq('enabled', true);
  if (error) {
    logger.error('[cron.trigger-fanout] loadEnabledSpaces failed', { err: error.message });
    return [];
  }
  return (data ?? []) as EnabledSpaceRow[];
}
