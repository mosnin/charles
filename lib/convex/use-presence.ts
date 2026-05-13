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
  typingConversationId?: string;
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
  /**
   * The TaskConversation id this client is actively typing into, or
   * undefined. Cleared on blur or after a 1s idle in the parent.
   */
  typingConversationId?: string;
}

const DEFAULT_HEARTBEAT_MS = 8000;
const CURSOR_THROTTLE_MS = 100; // 10 Hz

const CONVEX_ENABLED =
  typeof process !== 'undefined' &&
  Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

export function usePresence(opts: UsePresenceOpts): PresentUser[] {
  const {
    spaceId,
    surface,
    heartbeatMs = DEFAULT_HEARTBEAT_MS,
    withCursor = false,
    typingConversationId,
  } = opts;
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
  // typingConversationId can flip many times a second; keep it in a ref so
  // we don't restart the heartbeat interval every keystroke.
  const typingRef = useRef<string | undefined>(typingConversationId);
  typingRef.current = typingConversationId;

  // When typing starts/stops we want a heartbeat immediately so peers see
  // the indicator without waiting 8s for the next tick. Watch the value
  // and fire a one-shot when it changes.
  const lastTypingRef = useRef<string | undefined>(undefined);

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
        typingConversationId: typingRef.current,
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

  // Fire an immediate heartbeat when typing state flips (start or stop)
  // so the indicator appears/disappears without an 8s lag.
  useEffect(() => {
    if (!enabled) return;
    if (lastTypingRef.current === typingConversationId) return;
    lastTypingRef.current = typingConversationId;
    const c = cursorRef.current;
    void heartbeat({
      spaceId,
      surface: surfaceKey,
      cursorX: withCursor ? c?.x : undefined,
      cursorY: withCursor ? c?.y : undefined,
      typingConversationId,
    }).catch(() => {});
  }, [enabled, typingConversationId, spaceId, surfaceKey, withCursor, heartbeat]);

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
        typingConversationId: typingRef.current,
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

/**
 * Read-only sibling to usePresence: returns OTHER users whose presence row
 * marks them as typing into the given conversation. No heartbeat — purely
 * a Convex subscription. Use this in components where a parent already
 * holds a heartbeat (e.g. the task-chat thread, where the heartbeat lives
 * on the page-level PresenceHeartbeat).
 */
export function useTypingPeers(
  spaceId: string,
  conversationId: string | null,
): PresentUser[] {
  const { user } = useUser();
  const enabled = CONVEX_ENABLED && Boolean(spaceId) && Boolean(conversationId);
  const queryArgs = enabled ? { spaceId } : 'skip';
  const rows = useQuery(api.presence.listActive, queryArgs as any) as
    | PresentUser[]
    | undefined;

  const selfId = user?.id;
  return useMemo(() => {
    if (!rows || !conversationId) return [];
    return rows.filter(
      (r) => r.userId !== selfId && r.typingConversationId === conversationId,
    );
  }, [rows, selfId, conversationId]);
}

/**
 * Pure typing-indicator copy. Extracted so the wording is unit-testable
 * without rendering React. The component is dumb: feed it names, get a
 * line. Three-or-more falls back to a count to avoid runaway commas.
 */
export function typingIndicatorText(names: string[]): string | null {
  const clean = names.map((n) => n.trim()).filter((n) => n.length > 0);
  if (clean.length === 0) return null;
  if (clean.length === 1) return `${clean[0]} is typing…`;
  if (clean.length === 2) return `${clean[0]} and ${clean[1]} are typing…`;
  return `${clean.length} people are typing…`;
}
