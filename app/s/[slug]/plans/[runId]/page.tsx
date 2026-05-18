/**
 * /s/[slug]/plans/[runId] — the per-run detail page.
 *
 * Server component wrapper. Loads the plan via the repo, 404s on
 * unknown run id, hands the result to the polling client island.
 */

import { notFound } from 'next/navigation';
import { cn } from '@/lib/utils';
import { PAGE_RHYTHM, READING_MAX } from '@/lib/typography';
import { PlanDetailPoll } from '@/components/plans/plan-detail-poll';
import { loadPlanForRun } from '@/lib/plans/plan-repo';
import { getSpaceFromSlug } from '@/lib/space';

export default async function PlanRunPage({
  params,
}: {
  params: Promise<{ slug: string; runId: string }>;
}) {
  const { slug, runId } = await params;

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const run = await loadPlanForRun(space.id, runId);
  if (!run) notFound();

  return (
    <div className={cn(PAGE_RHYTHM, READING_MAX)}>
      <PlanDetailPoll initialRun={run} slug={slug} />
    </div>
  );
}
