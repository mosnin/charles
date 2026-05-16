'use client';

/**
 * useRealtimeTick — reactive view of the most-recent `realtimeTicks` row
 * for one (spaceId, kind). Returns the row's createdAt as a number, or
 * null when nothing has happened recently (or when Convex is unavailable).
 *
 * The intended pattern: subscribe in a client island, watch the timestamp,
 * call your refresh function (e.g. `router.refresh()` for a server
 * component, or your own re-fetch) when it advances. The tick itself
 * carries no payload — the canonical data lives in Supabase.
 */

import { useEffect, useRef } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';

export type RealtimeTickKind = 'approval' | 'audit';

interface TickRow {
  _id: string;
  spaceId: string;
  kind: RealtimeTickKind;
  summary?: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Subscribes to the latest tick for (spaceId, kind). Returns the createdAt
 * timestamp of the most recent tick, or null when none is live.
 *
 * Empty when Convex is unavailable (no provider mounted, no URL, query
 * errored) — caller's fallback behaviour kicks in.
 */
export function useRealtimeTick(spaceId: string, kind: RealtimeTickKind): number | null {
  const fn = (api as unknown as {
    realtimeTicks: { latestForSpace: unknown };
  }).realtimeTicks.latestForSpace;

  const q = useQuery as unknown as (f: unknown, a: unknown) => unknown;
  const row = q(fn, { spaceId, kind }) as TickRow | null | undefined;

  // useQuery returns undefined while loading and on error.
  if (row == null) return null;
  return row.createdAt;
}

/**
 * Calls `onTick` exactly once per new tick after the first observed value.
 * The first observed value is treated as the baseline so the callback
 * doesn't fire on mount for an already-stored tick. Common shape for
 * "refresh when something happens" wiring.
 */
export function useOnRealtimeTick(
  spaceId: string,
  kind: RealtimeTickKind,
  onTick: () => void,
): void {
  const lastSeen = useRef<number | null>(null);
  const tick = useRealtimeTick(spaceId, kind);

  useEffect(() => {
    if (tick == null) return;
    // First observed value — establish the baseline without firing.
    if (lastSeen.current == null) {
      lastSeen.current = tick;
      return;
    }
    if (tick > lastSeen.current) {
      lastSeen.current = tick;
      onTick();
    }
  }, [tick, onTick]);
}
