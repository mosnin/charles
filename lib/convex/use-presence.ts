'use client';

/**
 * Client hook that wires a surface into Convex presence.
 *
 * Heartbeats every 8s, on visibility regain, and (optionally) on pointer
 * movement throttled to 10 Hz. Cleans up on unmount. Returns the list of
 * OTHER active users on the same space, filtering out self. Bails out and
 * returns [] when NEXT_PUBLIC_CONVEX_URL isn't set, so local dev without
 * Convex still renders.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { usePathname } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { api } from '@/convex/_generated/api';

export interface PresentUser {
  userId: string;
  userName: string;
  userImage?: string;
  surface: string;
  cursorX?: number;
  cursorY?: number;
  lastActiveAt: number;
}

interface UsePresenceOpts {
  spaceId: string;
  /** Optional override; otherwise pathname is used as the surface key. */
  surface?: string;
  /** ms between heartbeats. Default 8000. */
  heartbeatMs?: number;
  /** Track cursor coordinates (presence-with-cursor mode). Default false. */
  withCursor?: boolean;
}

const DEFAULT_HEARTBEAT_MS = 8000;
const CURSOR_THROTTLE_MS = 100; // 10 Hz

const CONVEX_ENABLED =
  typeof process !== 'undefined' &&
  Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

export function usePresence(opts: UsePresenceOpts): PresentUser[] {
  const { spaceId, surface, heartbeatMs = DEFAULT_HEARTBEAT_MS, withCursor = false } = opts;
  const pathname = usePathname() ?? '/';
  const { user } = useUser();
  const surfaceKey = surface ?? pathname;

  // Convex hooks must always run in the same order; pass `'skip'` to disable.
  const enabled = CONVEX_ENABLED && Boolean(spaceId);
  const heartbeat = useMutation(api.presence.heartbeat);
  const clear = useMutation(api.presence.clear);
  const queryArgs = enabled ? { spaceId } : 'skip';
  const rows = useQuery(api.presence.listActive, queryArgs as any) as
    | PresentUser[]
    | undefined;

  // Latest cursor coords held in a ref so the heartbeat interval reads fresh
  // values without re-running the effect.
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const lastSentRef = useRef(0);

  // Periodic + visibility-driven heartbeat.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const send = () => {
      if (cancelled) return;
      const c = cursorRef.current;
      void heartbeat({
        spaceId,
        surface: surfaceKey,
        cursorX: withCursor ? c?.x : undefined,
        cursorY: withCursor ? c?.y : undefined,
      }).catch(() => {
        // Swallow — presence is best-effort decoration.
      });
    };

    send();
    const id = window.setInterval(send, heartbeatMs);
    const onVis = () => {
      if (document.visibilityState === 'visible') send();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      void clear({ spaceId }).catch(() => {});
    };
  }, [enabled, spaceId, surfaceKey, heartbeatMs, withCursor, heartbeat, clear]);

  // Cursor tracking — throttled to 10/s. On move we both stash the latest
  // coords AND opportunistically fire a heartbeat so other clients see a
  // smooth path, not just an 8s tick.
  useEffect(() => {
    if (!enabled || !withCursor) return;
    const onMove = (e: PointerEvent) => {
      cursorRef.current = { x: e.clientX, y: e.clientY };
      const now = Date.now();
      if (now - lastSentRef.current < CURSOR_THROTTLE_MS) return;
      lastSentRef.current = now;
      void heartbeat({
        spaceId,
        surface: surfaceKey,
        cursorX: e.clientX,
        cursorY: e.clientY,
      }).catch(() => {});
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [enabled, withCursor, spaceId, surfaceKey, heartbeat]);

  // Filter self out of the list.
  const selfId = user?.id;
  return useMemo(() => {
    if (!rows) return [];
    return rows.filter((r) => r.userId !== selfId);
  }, [rows, selfId]);
}
