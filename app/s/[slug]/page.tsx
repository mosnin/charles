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
import { buildDailyBriefing, type DailyBriefingData } from '@/lib/briefing/build-daily-briefing';
import { loadActivePlan } from '@/lib/plans/plan-repo';
import { CanvasHome } from '@/components/canvas/canvas-home';
import type { MessageBlock } from '@/lib/ai-tools/blocks';

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

  // Pull mission, autonomy levels, the GitHub slot, dept counts, the most-
  // recent conversation (for the dock's hydrated transcript), the daily
  // briefing, and the active plan — all in parallel. Any single failure is
  // absorbed; the page still renders.
  const [
    missionResult,
    autonomyResult,
    githubResult,
    deptCountsResult,
    latestConvResult,
    briefingResult,
    activePlanResult,
  ] = await Promise.allSettled([
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
    supabase
      .from('Conversation')
      .select('id')
      .eq('spaceId', space.id)
      .not('title', 'like', '[BROKERAGE_CHAT]%')
      .order('updatedAt', { ascending: false })
      .limit(1)
      .maybeSingle(),
    buildDailyBriefing(space.id),
    loadActivePlan(space.id),
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

  const initialConversationId: string | null =
    latestConvResult.status === 'fulfilled' && latestConvResult.value.data
      ? ((latestConvResult.value.data as { id: string }).id ?? null)
      : null;

  let initialMessages: { role: 'user' | 'assistant'; content: string; blocks?: MessageBlock[] | null }[] = [];
  if (initialConversationId) {
    try {
      const { data } = await supabase
        .from('Message')
        .select('role, content, blocks')
        .eq('conversationId', initialConversationId)
        .order('createdAt', { ascending: true })
        .limit(50);
      initialMessages = ((data ?? []) as { role: string; content: string; blocks: MessageBlock[] | null }[])
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
          blocks: m.blocks,
        }));
    } catch {
      // Empty transcript on failure — the dock will show its empty state.
    }
  }

  const briefing: DailyBriefingData | null =
    briefingResult.status === 'fulfilled' ? briefingResult.value : null;

  const activePlan =
    activePlanResult.status === 'fulfilled' ? activePlanResult.value : null;

  const workspaceName = mission?.title?.trim().length
    ? mission!.title
    : space.name;
  const missionTitle = workspaceName;

  return (
    <div className="h-full w-full">
      <CanvasHome
        slug={slug}
        spaceId={space.id}
        workspaceName={workspaceName}
        missionTitle={missionTitle}
        autonomyBySlug={autonomyBySlug}
        githubRepo={githubRepo}
        deptCounts={deptCounts}
        initialConversationId={initialConversationId}
        initialMessages={initialMessages}
        briefing={briefing}
        activePlan={activePlan}
      />
    </div>
  );
}
