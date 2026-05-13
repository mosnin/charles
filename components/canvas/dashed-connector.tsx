/**
 * 1px dashed connector — the line that ties an orbiting dept node back to the
 * centerpiece, or one task to the next across stages.
 *
 * Renders an SVG `<line>` between absolute `from` and `to` coordinates. The
 * host is expected to position this inside a parent that already establishes
 * the coordinate space (typically the canvas surface itself). The stroke is
 * a pale gray dashed line; the accent prop swaps it to the canvas-accent
 * blue for the one connector that's highlighted at a time (the active node).
 *
 * Pure SVG, no animation, no interactivity. Decorative — `aria-hidden`.
 */

import { cn } from '@/lib/utils';

export interface DashedConnectorProps {
  /** Starting point in container coordinates (px). */
  from: { x: number; y: number };
  /** Ending point in container coordinates (px). */
  to: { x: number; y: number };
  /** Highlight the line with the canvas accent color (for active edges). */
  accent?: boolean;
  /** Override the dash pattern. Default `4 4` mirrors `border-dashed`. */
  dashArray?: string;
  /** SVG strokeWidth — default 1. */
  strokeWidth?: number;
  /** Optional extra class on the wrapping <svg>. */
  className?: string;
}

/**
 * The wrapping SVG sizes itself to the bounding box of (from, to) and uses
 * absolute positioning so it lays cleanly over a positioned canvas without
 * pushing siblings around. The line draws relative to the inset so a 1-2px
 * stroke isn't clipped at the edge.
 */
export function DashedConnector({
  from,
  to,
  accent = false,
  dashArray = '4 4',
  strokeWidth = 1,
  className,
}: DashedConnectorProps) {
  const minX = Math.min(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const maxX = Math.max(from.x, to.x);
  const maxY = Math.max(from.y, to.y);
  const pad = Math.max(strokeWidth, 2);
  const width = Math.max(maxX - minX + pad * 2, pad * 2);
  const height = Math.max(maxY - minY + pad * 2, pad * 2);

  const x1 = from.x - minX + pad;
  const y1 = from.y - minY + pad;
  const x2 = to.x - minX + pad;
  const y2 = to.y - minY + pad;

  return (
    <svg
      aria-hidden
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('pointer-events-none absolute', className)}
      style={{ left: minX - pad, top: minY - pad }}
    >
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={accent ? 'var(--color-canvas-accent)' : 'currentColor'}
        strokeWidth={strokeWidth}
        strokeDasharray={dashArray}
        strokeLinecap="round"
        className={accent ? '' : 'text-slate-300'}
      />
    </svg>
  );
}
