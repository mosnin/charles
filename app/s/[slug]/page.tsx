/**
 * /s/[slug] — Charles workspace home.
 *
 * The canvas. Mission at the centre, six departments orbiting, the chat
 * dock on the right. One screen. One idea. Everything else is one keystroke
 * away (⌘K) or one tab away (the dock).
 */

import { redirect, notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { getAllDepartmentAutonomy } from '@/lib/departments/autonomy';
import { loadDeptCounts } from '@/lib/canvas/dept-counts';
import { loadAuditFeed } from '@/lib/observability/audit-feed';
import { CanvasHome } from '@/components/canvas/canvas-home';

interface Mission {
  title: string;
  oneLinePitch: string | null;
}

export default async function SpacePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  // Pull mission, autonomy levels, the GitHub slot, dept counts, and the
  // audit feed for the chat dock — all in parallel. Any single failure is
  // absorbed; the page still renders.
  const [missionResult, autonomyResult, githubResult, deptCountsResult, auditFeedResult] =
    await Promise.allSettled([
      supabase
        .from('Mission')
        .select('title, oneLinePitch')
        .eq('spaceId', space.id)
        .maybeSingle(),
      getAllDepartmentAutonomy(space.id),
      supabase
        .from('CoreMemory')
        .select('value')
        .eq('spaceId', space.id)
        .eq('slot', 'github_repo')
        .maybeSingle(),
      loadDeptCounts(space.id),
      loadAuditFeed(space.id, { limit: 8 }),
    ]);

  const mission: Mission | null =
    missionResult.status === 'fulfilled' && missionResult.value.data
      ? (missionResult.value.data as Mission)
      : null;

  const autonomyBySlug =
    autonomyResult.status === 'fulfilled'
      ? autonomyResult.value
      : ({
          engineering: 'ask',
          design: 'ask',
          marketing: 'ask',
          sales: 'ask',
          support: 'ask',
          ops_finance: 'ask',
        } as const);

  const githubRepo =
    githubResult.status === 'fulfilled' && githubResult.value.data
      ? ((githubResult.value.data as { value: string | null }).value ?? null)
      : null;

  const deptCounts =
    deptCountsResult.status === 'fulfilled'
      ? deptCountsResult.value
      : ({
          engineering: { running: 0, queued: 0, idle: 1 },
          design: { running: 0, queued: 0, idle: 1 },
          marketing: { running: 0, queued: 0, idle: 1 },
          sales: { running: 0, queued: 0, idle: 1 },
          support: { running: 0, queued: 0, idle: 1 },
          ops_finance: { running: 0, queued: 0, idle: 1 },
        } as const);

  const initialAuditFeed =
    auditFeedResult.status === 'fulfilled' ? auditFeedResult.value : [];

  const workspaceName = mission?.title?.trim().length
    ? mission!.title
    : space.name;
  const missionTitle = workspaceName;

  return (
    <div className="h-full w-full">
      <CanvasHome
        slug={slug}
        workspaceName={workspaceName}
        missionTitle={missionTitle}
        autonomyBySlug={autonomyBySlug}
        githubRepo={githubRepo}
        deptCounts={deptCounts}
        initialAuditFeed={initialAuditFeed}
      />
    </div>
  );
}
