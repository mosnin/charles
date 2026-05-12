/**
 * /s/[slug]/inbox — unified approval inbox.
 *
 * Two data sources:
 *   AgentPausedRun  — paused SDK chat runs awaiting founder approval
 *   AgentDraft      — agent-authored drafts (email/sms/note) awaiting review
 *
 * Server component. Approve/decline actions are handled client-side via the
 * InboxActions component, which calls the existing resume API.
 */

import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { Clock } from 'lucide-react';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { H1, TITLE_FONT, BODY_MUTED, PAGE_RHYTHM } from '@/lib/typography';
import { InboxRunActions } from './inbox-actions';
import { DraftActions } from './draft-actions';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PausedRun {
  id: string;
  conversationId: string | null;
  approvals: Array<{
    callId: string;
    toolName: string;
    summary: string;
    arguments?: unknown;
  }>;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface AgentDraft {
  id: string;
  channel: string;
  subject: string | null;
  content: string;
  reasoning: string | null;
  status: string;
  priority: number;
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function channelLabel(channel: string) {
  if (channel === 'email') return 'Email draft';
  if (channel === 'sms') return 'SMS draft';
  if (channel === 'note') return 'Internal note';
  return 'Draft';
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function InboxPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  // Verify ownership
  const { data: spaceOwner } = await supabase
    .from('User')
    .select('id')
    .eq('clerkId', userId)
    .eq('id', space.ownerId)
    .maybeSingle();
  if (!spaceOwner) notFound();

  // Fetch pending paused runs and drafts in parallel
  const [pausedResult, draftResult] = await Promise.allSettled([
    supabase
      .from('AgentPausedRun')
      .select('id, conversationId, approvals, status, createdAt, updatedAt')
      .eq('spaceId', space.id)
      .eq('status', 'pending')
      .order('createdAt', { ascending: false })
      .limit(50),
    supabase
      .from('AgentDraft')
      .select('id, channel, subject, content, reasoning, status, priority, createdAt')
      .eq('spaceId', space.id)
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .order('createdAt', { ascending: false })
      .limit(50),
  ]);

  const pausedRuns: PausedRun[] =
    pausedResult.status === 'fulfilled' && !pausedResult.value.error
      ? ((pausedResult.value.data ?? []) as PausedRun[])
      : [];

  const drafts: AgentDraft[] =
    draftResult.status === 'fulfilled' && !draftResult.value.error
      ? ((draftResult.value.data ?? []) as AgentDraft[])
      : [];

  const totalPending = pausedRuns.length + drafts.length;

  const statusLine =
    totalPending === 0
      ? 'Nothing waiting for your approval.'
      : totalPending === 1
        ? '1 item needs your decision.'
        : `${totalPending} items need your decision.`;

  return (
    <div className={PAGE_RHYTHM}>
      {/* Header */}
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Inbox</p>
        <h1 className={H1} style={TITLE_FONT}>
          Pending approvals
        </h1>
        <p className={BODY_MUTED}>{statusLine}</p>
      </header>

      {totalPending === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-12">
          {/* Paused runs */}
          {pausedRuns.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Waiting for approval — {pausedRuns.length}
              </h2>
              <ul className="divide-y divide-border/60">
                {pausedRuns.map((run) => {
                  const approval = run.approvals[0];
                  const toolLabel = approval?.toolName
                    ? formatToolName(approval.toolName)
                    : 'Tool call';
                  const summary = approval?.summary ?? 'Action requires your approval';
                  const waitingTime = relativeTime(run.updatedAt ?? run.createdAt);

                  return (
                    <li key={run.id} className="py-5 space-y-3">
                      <div className="flex items-start gap-3">
                        <span
                          className={cn(
                            'mt-0.5 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium flex-shrink-0',
                            'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15',
                          )}
                        >
                          {toolLabel}
                        </span>
                        <div className="flex-1 min-w-0 space-y-1">
                          <p className="text-sm text-foreground leading-snug">{summary}</p>
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums">
                            <Clock size={11} className="flex-shrink-0" />
                            <span>Waiting {waitingTime}</span>
                          </div>
                        </div>
                      </div>

                      {/* Approve / Decline buttons */}
                      <InboxRunActions
                        pausedRunId={run.id}
                        callId={approval?.callId}
                        slug={slug}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Drafts */}
          {drafts.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Drafts to review — {drafts.length}
              </h2>
              <ul className="divide-y divide-border/60">
                {drafts.map((draft) => {
                  const label = channelLabel(draft.channel);
                  const preview =
                    draft.content.length > 160
                      ? draft.content.slice(0, 160) + '…'
                      : draft.content;
                  const waitingTime = relativeTime(draft.createdAt);

                  return (
                    <li key={draft.id} className="py-5 space-y-3">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium flex-shrink-0 text-sky-700 bg-sky-50 dark:text-sky-400 dark:bg-sky-500/15">
                          {label}
                        </span>
                        <div className="flex-1 min-w-0 space-y-1">
                          {draft.subject && (
                            <p className="text-sm font-medium text-foreground leading-snug">
                              {draft.subject}
                            </p>
                          )}
                          <p className="text-sm text-muted-foreground leading-snug">{preview}</p>
                          {draft.reasoning && (
                            <p className="text-xs text-muted-foreground/70 italic">
                              {draft.reasoning}
                            </p>
                          )}
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums">
                            <Clock size={11} className="flex-shrink-0" />
                            <span>Created {waitingTime}</span>
                          </div>
                        </div>
                      </div>

                      <DraftActions draftId={draft.id} slug={slug} />
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-14 text-center">
      <p className="text-sm text-foreground">Nothing waiting for your approval.</p>
      <p className="text-xs text-muted-foreground mt-1.5">
        Charles will ask before taking any action that needs your sign-off.
      </p>
    </div>
  );
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatToolName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}
