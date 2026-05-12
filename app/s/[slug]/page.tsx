/**
 * /s/[slug] — Charles workspace home.
 *
 * Shows:
 *   1. Mission block: company, one-line pitch, current stage.
 *   2. Stage progress stepper + StageGate checklist for the current stage.
 *   3. Recent SwarmRun activity feed (last 5).
 *   4. "Ask Charles" quick-action.
 *
 * If mission is not set (onboarding incomplete), shows a "Complete your
 * setup" card instead. Auth and space ownership are verified in the layout.
 */

import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { ArrowRight, CheckCircle2, Circle } from 'lucide-react';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { H1, H2, BODY_MUTED, TITLE_FONT, PAGE_RHYTHM } from '@/lib/typography';

// ── Types ─────────────────────────────────────────────────────────────────────

type Stage = 'idea' | 'initial' | 'identity' | 'building' | 'selling' | 'scaling';

interface Mission {
  title: string;
  oneLinePitch: string | null;
  stage: Stage;
}

interface StageGate {
  id: string;
  title: string;
  isComplete: boolean;
  order: number;
}

interface SwarmRun {
  id: string;
  goal: string;
  status: string;
  createdAt: string;
}

// ── Stage labels ──────────────────────────────────────────────────────────────

const STAGE_ORDER: Stage[] = ['idea', 'initial', 'identity', 'building', 'selling', 'scaling'];

const STAGE_LABELS: Record<Stage, string> = {
  idea:     'Idea',
  initial:  'Initial',
  identity: 'Identity',
  building: 'Building',
  selling:  'Selling',
  scaling:  'Scaling',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function statusLabel(status: string): string {
  if (status === 'completed') return 'Done';
  if (status === 'running')   return 'Running';
  if (status === 'failed')    return 'Failed';
  if (status === 'planning')  return 'Planning';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function SpacePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  // Fetch mission, stage gates, and recent swarm runs in parallel.
  const [missionResult, gatesResult, runsResult] = await Promise.allSettled([
    supabase
      .from('Mission')
      .select('title, oneLinePitch, stage')
      .eq('spaceId', space.id)
      .maybeSingle(),
    supabase
      .from('StageGate')
      .select('id, title, isComplete, order')
      .eq('spaceId', space.id)
      .order('order', { ascending: true }),
    supabase
      .from('SwarmRun')
      .select('id, goal, status, createdAt')
      .eq('spaceId', space.id)
      .order('createdAt', { ascending: false })
      .limit(5),
  ]);

  const mission: Mission | null =
    missionResult.status === 'fulfilled' && missionResult.value.data
      ? (missionResult.value.data as Mission)
      : null;

  const allGates: StageGate[] =
    gatesResult.status === 'fulfilled' && gatesResult.value.data
      ? (gatesResult.value.data as StageGate[])
      : [];

  const recentRuns: SwarmRun[] =
    runsResult.status === 'fulfilled' && runsResult.value.data
      ? (runsResult.value.data as SwarmRun[])
      : [];

  const currentStage: Stage = mission?.stage ?? 'idea';
  const stageGates = allGates.filter((g) => g.stage === currentStage);
  const stageIndex = STAGE_ORDER.indexOf(currentStage);
  const missionReady = mission?.title && mission.title.length > 0;

  return (
    <div className={PAGE_RHYTHM}>
      {/* ── 1. Mission block ─────────────────────────────────────────── */}
      {missionReady ? (
        <header className="space-y-1.5">
          <p className={BODY_MUTED}>Mission</p>
          <h1 className={H1} style={TITLE_FONT}>
            {mission!.title}
          </h1>
          {mission!.oneLinePitch && (
            <p className={cn(BODY_MUTED, 'max-w-xl text-base')}>
              {mission!.oneLinePitch}
            </p>
          )}
        </header>
      ) : (
        /* Setup prompt when onboarding wasn't completed */
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-6 flex items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Complete your setup</p>
            <p className={cn(BODY_MUTED, 'text-xs')}>
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
      )}

      {/* ── 2. Stage progress ────────────────────────────────────────── */}
      <section className="space-y-6">
        <h2 className={H2}>Stage</h2>

        {/* Horizontal stepper */}
        <div className="flex items-center gap-0">
          {STAGE_ORDER.map((stage, i) => {
            const done   = i < stageIndex;
            const active = i === stageIndex;
            return (
              <div key={stage} className="flex items-center flex-1 min-w-0">
                <div className="flex flex-col items-center gap-1 flex-shrink-0">
                  <div
                    className={cn(
                      'h-2.5 w-2.5 rounded-full transition-colors',
                      done   ? 'bg-foreground'
                      : active ? 'bg-foreground ring-2 ring-foreground/20 ring-offset-2 ring-offset-background'
                      : 'bg-border',
                    )}
                  />
                  <span
                    className={cn(
                      'text-[10px] font-medium tabular-nums whitespace-nowrap',
                      active  ? 'text-foreground'
                      : done   ? 'text-foreground/60'
                      : 'text-muted-foreground/50',
                    )}
                  >
                    {STAGE_LABELS[stage]}
                  </span>
                </div>
                {i < STAGE_ORDER.length - 1 && (
                  <div
                    className={cn(
                      'h-px flex-1 mx-1 transition-colors',
                      done ? 'bg-foreground/30' : 'bg-border/50',
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* StageGate checklist */}
        {stageGates.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Exit criteria for {STAGE_LABELS[currentStage]}
            </p>
            <ul className="space-y-2">
              {stageGates.map((gate) => (
                <li key={gate.id} className="flex items-start gap-2.5 text-sm">
                  {gate.isComplete ? (
                    <CheckCircle2 size={15} className="mt-0.5 flex-shrink-0 text-foreground" />
                  ) : (
                    <Circle size={15} className="mt-0.5 flex-shrink-0 text-muted-foreground/40" />
                  )}
                  <span
                    className={cn(
                      gate.isComplete
                        ? 'line-through text-muted-foreground'
                        : 'text-foreground',
                    )}
                  >
                    {gate.title}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ── 3. Quick action ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className={H2}>Ask Charles</h2>
        <Link
          href={`/s/${slug}/chippi`}
          className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-background px-4 py-3.5 text-sm text-muted-foreground hover:bg-foreground/[0.03] transition-colors"
        >
          <span>Ask Charles to do something…</span>
          <ArrowRight size={15} className="flex-shrink-0 text-muted-foreground/50" />
        </Link>
      </section>

      {/* ── 4. Recent activity ──────────────────────────────────────── */}
      {recentRuns.length > 0 && (
        <section className="space-y-4">
          <h2 className={H2}>Recent activity</h2>
          <ul className="divide-y divide-border/60">
            {recentRuns.map((run) => {
              const truncatedGoal =
                run.goal.length > 90
                  ? run.goal.slice(0, 90) + '…'
                  : run.goal;
              return (
                <li key={run.id} className="py-3 flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <p className="text-sm text-foreground leading-snug">{truncatedGoal}</p>
                    <p className="text-xs text-muted-foreground">
                      {statusLabel(run.status)} · {relativeTime(run.createdAt)}
                    </p>
                  </div>
                  <Link
                    href={`/s/${slug}/swarm/${run.id}`}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                  >
                    View
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
