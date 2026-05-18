/**
 * Polling bridge: Supabase SwarmMember status transitions -> Convex
 * canvasActivity events. The Python agent runtime owns SwarmMember
 * writes; rather than reach across the language boundary, we sample
 * recent rows from a TS cron and emit Convex pings for transitions we
 * haven't seen before.
 *
 * Idempotency is per-process: an in-memory Set tracks "(memberId, kind)"
 * keys that we've already emitted. Cold starts re-emit at most ~60s of
 * recent transitions; the Convex TTL absorbs the duplicates.
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { ALL_DEPARTMENTS, type DepartmentSlug } from '@/lib/departments/autonomy';
import {
  emitCanvasActivity,
  type CanvasActivityKind,
} from './server-emit';

// Statuses we care about, mapped to the canvasActivity `kind` vocabulary.
const STATUS_TO_KIND: Record<string, CanvasActivityKind> = {
  queued: 'queued',
  running: 'running',
  completed: 'done',
  failed: 'failed',
};

// Look-back window. Long enough that a one-minute cron can never miss a
// transition; short enough that a cold-started process doesn't replay
// hours of history.
const LOOKBACK_MS = 60_000;

// Process-local de-dupe set. Keyed by `${memberId}:${kind}`.
const seen = new Set<string>();
// Cap the set so a long-running process doesn't grow it without bound.
const SEEN_MAX = 5_000;

interface SwarmMemberRow {
  id: string;
  role: string | null;
  status: string | null;
  name: string | null;
  task: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
  swarmRun: { id: string; spaceId: string } | null;
}

function pickTransitionTime(r: SwarmMemberRow, status: string): number | null {
  const raw =
    status === 'completed' || status === 'failed'
      ? r.completedAt
      : status === 'running'
        ? r.startedAt
        : r.createdAt;
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

function rememberKey(key: string): void {
  if (seen.size >= SEEN_MAX) {
    // Crude eviction — clear half the set. Cheap, predictable.
    let dropped = 0;
    const target = Math.floor(SEEN_MAX / 2);
    for (const k of seen) {
      seen.delete(k);
      if (++dropped >= target) break;
    }
  }
  seen.add(key);
}

export interface BridgeResult {
  scanned: number;
  emitted: number;
  skipped: number;
  errored: number;
}

/**
 * Pull SwarmMember rows whose most recent transition timestamp falls
 * inside the look-back window, then emit a Convex canvasActivity event
 * for any (memberId, kind) we haven't seen this process.
 */
export async function runCanvasActivityBridge(
  now: number = Date.now(),
): Promise<BridgeResult> {
  const cutoffIso = new Date(now - LOOKBACK_MS).toISOString();
  const result: BridgeResult = { scanned: 0, emitted: 0, skipped: 0, errored: 0 };

  let rows: SwarmMemberRow[] = [];
  try {
    const { data, error } = await supabase
      .from('SwarmMember')
      .select(
        'id, role, status, name, task, startedAt, completedAt, createdAt, swarmRun:SwarmRun!inner(id, spaceId)',
      )
      .or(
        `startedAt.gte.${cutoffIso},completedAt.gte.${cutoffIso},createdAt.gte.${cutoffIso}`,
      )
      .limit(200);
    if (error) throw error;
    rows = (data ?? []) as unknown as SwarmMemberRow[];
  } catch (err) {
    logger.warn('[canvas-activity-bridge] query failed', { err: String(err) });
    result.errored = 1;
    return result;
  }

  result.scanned = rows.length;

  for (const r of rows) {
    if (!r || !r.id || !r.status) {
      result.skipped += 1;
      continue;
    }
    const kind = STATUS_TO_KIND[r.status];
    if (!kind) {
      result.skipped += 1;
      continue;
    }
    if (!r.role || !(ALL_DEPARTMENTS as readonly string[]).includes(r.role)) {
      result.skipped += 1;
      continue;
    }
    const spaceId = r.swarmRun?.spaceId;
    if (!spaceId) {
      result.skipped += 1;
      continue;
    }
    const transitionAt = pickTransitionTime(r, r.status);
    if (transitionAt === null || transitionAt < now - LOOKBACK_MS) {
      result.skipped += 1;
      continue;
    }

    const key = `${r.id}:${kind}`;
    if (seen.has(key)) {
      result.skipped += 1;
      continue;
    }

    const summary = (r.name && r.name.trim()) || (r.task && r.task.trim().slice(0, 80)) || r.role;
    const ok = await emitCanvasActivity({
      spaceId,
      department: r.role as DepartmentSlug,
      kind,
      summary,
    });
    if (ok) {
      rememberKey(key);
      result.emitted += 1;
    } else {
      result.errored += 1;
    }
  }

  return result;
}

/**
 * Test-only escape hatch. Not exported via the index; tests reach in by
 * path. Resets the per-process de-dupe set.
 */
export function __resetSeenForTests(): void {
  seen.clear();
}
