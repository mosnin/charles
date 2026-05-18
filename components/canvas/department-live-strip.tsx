'use client';

/**
 * Live "what's in flight right now" strip for one department page.
 *
 * Subscribes to Convex `canvasActivity` filtered to this department.
 * Renders the most recent running / queued rows as a small horizontal
 * strip above the static feed — the moment Charles starts working in
 * this department, the founder sees it pulse here.
 *
 * Silent when there's no live activity (and when Convex is unavailable).
 * The static feed below remains the historical record.
 */

import { useMemo } from 'react';
import { useCanvasActivity } from '@/lib/convex/use-canvas-activity';
import { cn } from '@/lib/utils';
import { CAPTION, SECTION_LABEL, BODY_MUTED } from '@/lib/typography';

interface Props {
  spaceId: string;
  deptSlug: string;
}

export function DepartmentLiveStrip({ spaceId, deptSlug }: Props) {
  const all = useCanvasActivity(spaceId);
  const rows = useMemo(
    () =>
      all
        .filter((r) => r.department === deptSlug)
        .filter((r) => r.kind === 'running' || r.kind === 'queued')
        .slice(0, 4),
    [all, deptSlug],
  );

  if (rows.length === 0) return null;

  return (
    <section className="rounded-xl border border-border bg-background px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className={SECTION_LABEL}>In flight</p>
        <span className={cn(CAPTION, 'inline-flex items-center gap-1.5')}>
          <span className="relative inline-flex h-2 w-2">
            <span className="absolute inset-0 inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          live
        </span>
      </div>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
                row.kind === 'running'
                  ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {row.kind}
            </span>
            <p className={cn(BODY_MUTED, 'leading-snug truncate')}>{row.summary}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
