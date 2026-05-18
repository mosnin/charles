'use client';

/**
 * Dashed connector underlay for the stages kanban.
 *
 * Draws the pale gray arc that bridges adjacent stage columns. V1 is
 * dynamic: after layout, we read the bottom-right of each "from" card and
 * the top-left of each "to" card from the DOM, then render an SVG path
 * between them. ResizeObserver keeps the paths honest when the founder
 * resizes the window or the surrounding panel reflows.
 *
 * Cards are tagged with `data-connector-anchor="from:<stage>"` /
 * `data-connector-anchor="to:<stage>"` by the canvas. If either anchor is
 * missing for a pair (e.g. a column has zero rows) the connector for that
 * pair is silently skipped — degrading to nothing is better than drawing a
 * line to nowhere.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Stage } from '@/lib/stages/catalog';
import type { StagePair } from '@/lib/stages/canvas-helpers';

interface Props {
  pairs: readonly StagePair[];
  /** The positioned container the SVG lives inside; coords are relative to it. */
  containerRef: React.RefObject<HTMLElement | null>;
}

interface Segment {
  key: string;
  d: string;
}

// useLayoutEffect on the server is a noop + warning, so swap when SSR.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function ConnectorOverlay({ pairs, containerRef }: Props) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const rafRef = useRef<number | null>(null);

  useIsoLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function compute() {
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const w = container.scrollWidth;
      const h = container.scrollHeight;
      const next: Segment[] = [];

      for (const pair of pairs) {
        const fromEl = container.querySelector<HTMLElement>(
          `[data-from-stage="${pair.from satisfies Stage}"]`,
        );
        const toEl = container.querySelector<HTMLElement>(
          `[data-to-stage="${pair.to satisfies Stage}"]`,
        );
        if (!fromEl || !toEl) continue;

        const f = fromEl.getBoundingClientRect();
        const t = toEl.getBoundingClientRect();

        // Coordinates relative to the container's content box.
        const x1 = f.right - containerRect.left + container.scrollLeft;
        const y1 = f.top + f.height / 2 - containerRect.top + container.scrollTop;
        const x2 = t.left - containerRect.left + container.scrollLeft;
        const y2 = t.top + t.height / 2 - containerRect.top + container.scrollTop;

        // Smooth horizontal S-curve.
        const midX = (x1 + x2) / 2;
        const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
        next.push({ key: `${pair.from}->${pair.to}`, d });
      }

      setSegments(next);
      setSize({ w, h });
    }

    function schedule() {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(compute);
    }

    schedule();

    const ro = new ResizeObserver(schedule);
    ro.observe(container);
    container
      .querySelectorAll('[data-from-stage], [data-to-stage]')
      .forEach((el) => ro.observe(el));

    window.addEventListener('resize', schedule);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [pairs, containerRef]);

  if (segments.length === 0) return null;

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0"
      width={size.w || '100%'}
      height={size.h || '100%'}
      viewBox={`0 0 ${size.w || 1} ${size.h || 1}`}
      preserveAspectRatio="none"
    >
      {segments.map((s) => (
        <path
          key={s.key}
          d={s.d}
          fill="none"
          stroke="rgb(212 212 216)" // zinc-300
          strokeWidth={1}
          strokeDasharray="4 4"
        />
      ))}
    </svg>
  );
}
