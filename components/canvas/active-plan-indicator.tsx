'use client';

/**
 * ActivePlanIndicator — surfaces an in-flight plan on the canvas.
 *
 * Renders only when an active SwarmRun exists (status in
 * planning/running/auditing). Clicks through to the Plan View detail
 * page so the founder can watch the plan unfold step by step.
 *
 * Design: a quiet pill that lives on the canvas chrome, near the
 * workspace badge. It doesn't compete with the morning briefing or
 * FirstMoveCard — when a plan is in flight there's a lot to look at
 * and we want this to be a tap target, not a tile.
 *
 * Pattern mirrors the other canvas chrome bits — hairline border,
 * sentence case, no shadow, `data-no-pan` so canvas panning ignores
 * it.
 */

import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CAPTION } from '@/lib/typography';

interface ActivePlanIndicatorProps {
  slug: string;
  runId: string;
  goal: string;
  completedSteps: number;
  totalSteps: number;
}

export function ActivePlanIndicator({
  slug,
  runId,
  goal,
  completedSteps,
  totalSteps,
}: ActivePlanIndicatorProps) {
  return (
    <Link
      href={`/s/${slug}/plans/${runId}`}
      data-no-pan
      className={cn(
        'pointer-events-auto group inline-flex max-w-[420px] items-center gap-2',
        'rounded-full border border-border bg-background px-3 py-1.5',
        'transition-colors hover:bg-foreground/[0.02]',
      )}
    >
      <Sparkles
        size={12}
        strokeWidth={2}
        className="shrink-0 text-amber-600 dark:text-amber-400"
      />
      <span className="min-w-0 truncate text-xs font-medium text-foreground">
        Working on: <span className="font-normal">{goal}</span>
      </span>
      <span className={cn(CAPTION, 'shrink-0 tabular-nums text-muted-foreground/80')}>
        {completedSteps}/{totalSteps}
      </span>
      <ArrowRight
        size={11}
        className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
      />
    </Link>
  );
}
