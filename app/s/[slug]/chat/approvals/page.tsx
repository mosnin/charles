'use server';

/**
 * /s/[slug]/chat/approvals — the Approval Command Center.
 *
 * Where the founder makes the decisions Charles can't make alone. The
 * entire trust model of "an AI cofounder that operates and asks
 * permission" lives or dies in this surface. Each pending action gets a
 * real card: risk chip up top, the tool in plain English, the goal that
 * surfaced it, and an honest approve/reject. Reject expands to capture
 * an optional reason — that signal is what keeps Charles from proposing
 * the same thing again tomorrow.
 *
 * One column, ordered newest-first. No filters, no kanban, no bulk
 * actions yet — those are friction that should be earned by use, not
 * shipped speculatively.
 */

import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { ArrowLeft, Clock } from 'lucide-react';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  BODY,
  CAPTION,
  PAGE_RHYTHM,
  READING_MAX,
} from '@/lib/typography';
import { getToolDisplay, type ApprovalRisk } from '@/lib/approvals/tool-display';
import { ApprovalActions } from './approval-actions';
import { RealtimeApprovalsRefresher } from './realtime-refresher';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ApprovalTask {
  id: string;
  spaceId: string;
  title: string;
  goalDescription: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function pendingToolName(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  const action = metadata['pendingAction'];
  return typeof action === 'string' && action.trim().length > 0 ? action.trim() : null;
}

function allRiskyTools(metadata: Record<string, unknown> | null): string[] {
  if (!metadata) return [];
  const list = metadata['allRiskyTools'];
  if (!Array.isArray(list)) return [];
  return list.filter((x): x is string => typeof x === 'string');
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max).trimEnd() + '…' : s;
}

function statusSentence(pending: number, highCount: number): string {
  if (pending === 0) return 'Nothing waiting. Charles will ask before any risky action.';
  if (pending === 1) {
    return highCount === 1
      ? '1 action is waiting · high risk.'
      : '1 action is waiting · low risk.';
  }
  if (highCount === 0) {
    return `${pending} actions are waiting · all low risk.`;
  }
  if (highCount === pending) {
    return `${pending} actions are waiting · all high risk.`;
  }
  return `${pending} actions are waiting · ${highCount} high risk.`;
}

// ── Risk chip ─────────────────────────────────────────────────────────────────

function RiskChip({ risk }: { risk: ApprovalRisk }) {
  if (risk === 'high') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
          'text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-500/15',
        )}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-red-500 dark:bg-red-400" />
        High risk
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        'text-muted-foreground bg-muted',
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
      Low risk
    </span>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ApprovalsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  // Owner gate.
  const { data: spaceOwner } = await supabase
    .from('User')
    .select('id')
    .eq('clerkId', userId)
    .eq('id', space.ownerId)
    .maybeSingle();
  if (!spaceOwner) notFound();

  const { data: tasks, error } = await supabase
    .from('AgentTask')
    .select('*')
    .eq('spaceId', space.id)
    .eq('status', 'paused')
    .not('metadata->approvalRequired', 'is', null)
    .order('createdAt', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[charles/approvals] query error:', error);
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center space-y-4 p-8">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load your pending approvals. This is usually temporary.
          </p>
          <a
            href={`/s/${slug}/chat/approvals`}
            className="inline-block px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Try again
          </a>
        </div>
      </div>
    );
  }

  const approvalList = (tasks ?? []) as ApprovalTask[];

  // Compute risk counts once for the header sentence.
  const displays = approvalList.map((t) => {
    const tool = pendingToolName(t.metadata);
    return tool ? getToolDisplay(tool) : { label: 'Action requires approval', risk: 'high' as ApprovalRisk };
  });
  const highCount = displays.filter((d) => d.risk === 'high').length;

  return (
    <div className={cn(PAGE_RHYTHM, READING_MAX)}>
      {/* Live signal — re-renders the server component when Charles pauses
          a new run or another tab resolves an approval. */}
      <RealtimeApprovalsRefresher spaceId={space.id} />

      {/* Header — three-line pattern, matches /tasks */}
      <header className="space-y-1.5">
        <Link
          href={`/s/${slug}`}
          className={cn(CAPTION, 'inline-flex items-center gap-1 hover:text-foreground transition-colors')}
        >
          <ArrowLeft size={12} /> Workspace
        </Link>
        <h1 className={H1} style={TITLE_FONT}>
          Approvals
        </h1>
        <p className={BODY_MUTED}>{statusSentence(approvalList.length, highCount)}</p>
      </header>

      {/* List or empty state */}
      {approvalList.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
          <p className={BODY}>No pending approvals.</p>
          <p className={cn(CAPTION, 'mt-1')}>
            Charles will ask before any external write — sending a message, opening a PR, spending
            money.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {approvalList.map((task, i) => {
            const tool = pendingToolName(task.metadata);
            const display = displays[i];
            const queued = allRiskyTools(task.metadata);
            const extraQueued = queued.length > 1 ? queued.length - 1 : 0;
            const goal = task.goalDescription ?? task.title;
            const goalText = truncate(goal, 220);
            const waiting = relativeTime(task.updatedAt ?? task.createdAt);

            return (
              <li
                key={task.id}
                className="rounded-xl border border-border bg-background px-5 py-4 space-y-3"
              >
                {/* Top row — risk chip + waiting time */}
                <div className="flex items-center justify-between gap-3">
                  <RiskChip risk={display.risk} />
                  <span className={cn(CAPTION, 'inline-flex items-center gap-1 tabular-nums')}>
                    <Clock size={11} className="flex-shrink-0" />
                    Waiting {waiting}
                  </span>
                </div>

                {/* What — tool label, the headline of the card */}
                <p className={cn(BODY, 'font-medium leading-snug')}>{display.label}</p>

                {/* Why — the goal that surfaced this approval */}
                {goalText && goalText !== display.label && (
                  <p className={cn(BODY_MUTED, 'leading-snug')}>{goalText}</p>
                )}

                {/* Queue hint — when the model batched multiple risky calls */}
                {extraQueued > 0 && (
                  <p className={cn(CAPTION)}>
                    {extraQueued} more {extraQueued === 1 ? 'action' : 'actions'} queued in this run.
                    Approving advances them in order; rejecting cancels the batch.
                  </p>
                )}

                {/* Hidden but useful for debugging: tool name in a tooltip-ish caption */}
                {tool && process.env.NODE_ENV !== 'production' && (
                  <p className={cn(CAPTION, 'font-mono opacity-50')}>{tool}</p>
                )}

                {/* Decision row */}
                <ApprovalActions taskId={task.id} slug={slug} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
