/**
 * /s/[slug] — Charles workspace home.
 *
 * The launchpad. Mission at the top, a single prompt input that hands off
 * to /chat, two whisper-rows underneath. No stepper. No gate list. No
 * recent activity. Those have their own homes.
 */

import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { ArrowRight } from 'lucide-react';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { H1, BODY_MUTED, TITLE_FONT } from '@/lib/typography';
import { HomePrompt } from './home-prompt';

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

  const [missionResult, taskResult, draftResult, pausedResult] = await Promise.allSettled([
    supabase
      .from('Mission')
      .select('title, oneLinePitch')
      .eq('spaceId', space.id)
      .maybeSingle(),
    supabase
      .from('AgentTask')
      .select('id', { count: 'exact', head: true })
      .eq('spaceId', space.id)
      .eq('status', 'open'),
    supabase
      .from('AgentDraft')
      .select('id', { count: 'exact', head: true })
      .eq('spaceId', space.id)
      .eq('status', 'pending'),
    supabase
      .from('AgentPausedRun')
      .select('id', { count: 'exact', head: true })
      .eq('spaceId', space.id)
      .eq('status', 'pending'),
  ]);

  const mission: Mission | null =
    missionResult.status === 'fulfilled' && missionResult.value.data
      ? (missionResult.value.data as Mission)
      : null;

  const openTasks =
    taskResult.status === 'fulfilled' ? (taskResult.value.count ?? 0) : 0;
  const pendingApprovals =
    pausedResult.status === 'fulfilled' ? (pausedResult.value.count ?? 0) : 0;
  const draftsInReview =
    draftResult.status === 'fulfilled' ? (draftResult.value.count ?? 0) : 0;

  const missionReady = mission?.title && mission.title.length > 0;

  return (
    <div className="mx-auto w-full max-w-[720px] px-6 pt-[14vh] pb-24">
      {missionReady ? (
        <>
          <header className="space-y-2">
            <p className={cn(BODY_MUTED, 'text-[12px]')}>Mission</p>
            <h1 className={H1} style={TITLE_FONT}>
              {mission!.title}
            </h1>
            {mission!.oneLinePitch && (
              <p className={cn(BODY_MUTED, 'max-w-[60ch] text-base')}>
                {mission!.oneLinePitch}
              </p>
            )}
          </header>

          <div className="mt-10">
            <HomePrompt slug={slug} />
          </div>

          <Whispers
            slug={slug}
            openTasks={openTasks}
            pendingApprovals={pendingApprovals}
            draftsInReview={draftsInReview}
          />
        </>
      ) : (
        <SetupCard />
      )}
    </div>
  );
}

function Whispers({
  slug,
  openTasks,
  pendingApprovals,
  draftsInReview,
}: {
  slug: string;
  openTasks: number;
  pendingApprovals: number;
  draftsInReview: number;
}) {
  const parts: string[] = [];
  if (openTasks > 0) parts.push(`${openTasks} ${openTasks === 1 ? 'task' : 'tasks'} open`);
  if (pendingApprovals > 0)
    parts.push(
      `${pendingApprovals} pending ${pendingApprovals === 1 ? 'approval' : 'approvals'}`,
    );
  if (draftsInReview > 0)
    parts.push(`${draftsInReview} ${draftsInReview === 1 ? 'draft' : 'drafts'} in review`);

  return (
    <div className="mt-4 space-y-1.5">
      {parts.length > 0 && (
        <Link
          href={`/s/${slug}/inbox`}
          className="block text-[12px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {parts.join(' · ')}.
        </Link>
      )}
      <p className="text-[12px] text-muted-foreground/70">
        Press <kbd className="font-mono text-[11px] text-muted-foreground">⌘K</kbd> to open anything.
      </p>
    </div>
  );
}

function SetupCard() {
  return (
    <div className="mt-[6vh] rounded-xl border border-dashed border-border/70 bg-foreground/[0.02] p-8 flex items-center justify-between gap-6">
      <div className="space-y-1.5">
        <p className="text-base font-medium text-foreground">Complete your setup.</p>
        <p className={cn(BODY_MUTED, 'max-w-[44ch]')}>
          Tell Charles about your company so it knows what to build.
        </p>
      </div>
      <Link
        href="/onboarding"
        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-foreground text-background text-sm font-medium flex-shrink-0 hover:opacity-90 transition-opacity"
      >
        Set up <ArrowRight size={13} />
      </Link>
    </div>
  );
}
