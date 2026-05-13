'use client';

/**
 * ConvexHealthBadge — a single 6px amber dot in the top bar, visible
 * only when the live-state layer is unreachable.
 *
 * Polls /api/health/convex every 60s. Renders nothing for healthy or
 * unconfigured states; renders an amber dot with a hover tooltip
 * ("Live layer offline") for unhealthy. No banner, no modal — the
 * design shouldn't shout.
 */

import { useEffect, useRef, useState } from 'react';

export type HealthState = 'healthy' | 'unhealthy' | 'unconfigured' | 'unknown';

export const POLL_MS = 60_000;

/**
 * Pure decision: should the badge dot be visible for this state?
 * Exported so tests can pin the contract without rendering React.
 */
export function shouldRenderBadge(state: HealthState): boolean {
  return state === 'unhealthy';
}

/**
 * Normalize a /api/health/convex response body into our state union.
 * Anything we don't recognize maps to 'unhealthy' — a defensive default
 * so a malformed response surfaces as a visible amber dot, not silence.
 */
export function stateFromBody(body: unknown): HealthState {
  if (!body || typeof body !== 'object') return 'unhealthy';
  const status = (body as { status?: unknown }).status;
  if (status === 'healthy') return 'healthy';
  if (status === 'unconfigured') return 'unconfigured';
  return 'unhealthy';
}

export function ConvexHealthBadge() {
  const [state, setState] = useState<HealthState>('unknown');
  const [hover, setHover] = useState(false);
  const aborted = useRef(false);

  useEffect(() => {
    aborted.current = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll(): Promise<void> {
      try {
        const res = await fetch('/api/health/convex', { cache: 'no-store' });
        if (aborted.current) return;
        const body = (await res.json()) as unknown;
        setState(stateFromBody(body));
      } catch {
        if (!aborted.current) setState('unhealthy');
      } finally {
        if (!aborted.current) timer = setTimeout(poll, POLL_MS);
      }
    }

    void poll();

    return () => {
      aborted.current = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!shouldRenderBadge(state)) return null;

  return (
    <div
      className="relative inline-flex items-center"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
    >
      <span
        role="status"
        aria-label="Live layer offline"
        className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
        tabIndex={0}
      />
      {hover && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-1/2 top-[calc(100%+6px)] z-50 -translate-x-1/2 whitespace-nowrap rounded-md border border-border/60 bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-sm"
        >
          Live layer offline
        </span>
      )}
    </div>
  );
}
