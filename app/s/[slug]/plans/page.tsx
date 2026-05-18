/**
 * /s/[slug]/plans — the plan-run index.
 *
 * Lists the runs Charles has on the books. Each row is one goal he's
 * been handed; clicking opens the detail page. Server-rendered; the
 * list is cached briefly between requests via Next's default RSC
 * behaviour. Detail pages do their own polling for live updates.
 */

import Link from 'next/link';
import { ListTodo, Check, X, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  H1,
  TITLE_FONT,
  BODY,
  BODY_MUTED,
  CAPTION,
  PAGE_RHYTHM,
  READING_MAX,
} from '@/lib/typography';
import { EmptyState } from '@/components/ui/empty-state';
import { getSpaceFromSlug } from '@/lib/space';
import { listRecentPlans } from '@/lib/plans/plan-repo';
import type { PlanRun } from '@/lib/plans/types';

export default async function PlansIndexPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const space = await getSpaceFromSlug(slug);
  const runs: PlanRun[] = space ? await listRecentPlans(space.id, 30) : [];

  return (
    <div className={cn(PAGE_RHYTHM, READING_MAX)}>
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Plans.</p>
        <h1 className={H1} style={TITLE_FONT}>
          Recent plans
        </h1>
        <p className={BODY_MUTED}>
          Goals you handed to Charles, broken down into steps and watched as they run.
        </p>
      </header>

      {runs.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title="No plans yet"
          description="Plans you've handed off to Charles will show up here."
        />
      ) : (
        <ul className="space-y-2">
          {runs.map((r) => (
            <li key={r.id}>
              <PlanIndexRow slug={slug} run={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PlanIndexRow({ slug, run }: { slug: string; run: PlanRun }) {
  return (
    <Link
      href={`/s/${slug}/plans/${run.id}`}
      className={cn(
        'block rounded-xl border border-border bg-background px-4 py-3',
        'transition-colors hover:bg-foreground/[0.02]',
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className={cn(BODY, 'font-medium text-foreground truncate')}>{run.goal}</p>
        <PlanRunChip run={run} />
      </div>
      <p className={cn(CAPTION, 'mt-1 line-clamp-1')}>{run.planSummary}</p>
    </Link>
  );
}

function PlanRunChip({ run }: { run: PlanRun }) {
  const isDone = run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled';
  const Icon =
    !isDone ? Clock : run.overallSatisfied === true ? Check : X;
  const label = !isDone
    ? `${run.completedSteps}/${run.totalSteps}`
    : run.overallSatisfied === true
      ? 'verified'
      : 'unverified';
  const className = !isDone
    ? 'text-muted-foreground bg-muted'
    : run.overallSatisfied === true
      ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/15'
      : 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15';
  return (
    <span
      className={cn(
        'shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
        className,
      )}
    >
      <Icon size={10} strokeWidth={2.5} />
      {label}
    </span>
  );
}
