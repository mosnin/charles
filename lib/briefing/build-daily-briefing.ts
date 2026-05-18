/**
 * Daily founder briefing — data builder.
 *
 * Pulls the last 24h of `loadAuditFeed` events, the current pending-draft and
 * paused-run backlogs, overdue AgentTask rows, and the workspace's current
 * stage. Produces a single `DailyBriefingData` payload. No email sending,
 * no rendering. Pure-ish: reads from Supabase, returns a value.
 */

import { loadAuditFeed, type AuditEvent } from '@/lib/observability/audit-feed';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { listUpcomingTriggersForSpace } from '@/lib/triggers/scheduled-trigger-repo';

/** A single "needs you today" action item — a line plus where it goes. */
export interface BriefingAction {
  label: string;
  /** Workspace-relative href to the surface that resolves the action. */
  href: string;
}

/** One row in the "Coming up" section — what Charles has on his calendar. */
export interface BriefingUpcoming {
  triggerId: string;
  runAt: string;
  reason: string;
  source: 'agent' | 'heartbeat' | 'founder' | 'system';
}

export interface DailyBriefingData {
  founderFirstName: string | null;
  workspaceName: string;
  /** 3-5 short lines summarising what happened in the last 24h. */
  yesterdayHighlights: string[];
  /** Up to 3 one-line action items, each linking to its surface. */
  needsYouToday: BriefingAction[];
  /** Next up to 5 scheduled wake-ups Charles has queued. */
  comingUp: BriefingUpcoming[];
  pendingApprovalsCount: number;
  openTasksCount: number;
  currentStage: string;
  /** True when nothing happened yesterday and nothing needs attention today. */
  isRestDay: boolean;
}

const HIGHLIGHT_CAP = 5;
const ACTION_CAP = 3;
const UPCOMING_CAP = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Audit event types that count as "interesting" for the yesterday section. */
const INTERESTING_TYPES = new Set([
  'agent_run_completed',
  'draft_accepted',
  'integration_connected',
  'stage_advanced',
  'gate_completed',
]);

interface SpaceRow {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
}

/** First name from a full name string, or null. */
function firstNameOf(name: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const first = trimmed.split(/\s+/)[0];
  return first || null;
}

/**
 * Group audit events by type+department and roll up counts so the
 * yesterday section reads like a list of accomplishments instead of a
 * raw log dump.
 */
function summarizeHighlights(events: AuditEvent[]): string[] {
  const interesting = events.filter((e) => INTERESTING_TYPES.has(e.type));
  if (interesting.length === 0) return [];

  // Count by type/department for compact summaries.
  const completedByDept = new Map<string, number>();
  const draftsAccepted: number = interesting.filter((e) => e.type === 'draft_accepted').length;
  const integrationsConnected: string[] = [];
  const stagesAdvanced: string[] = [];
  const gatesCompleted: string[] = [];

  for (const e of interesting) {
    if (e.type === 'agent_run_completed') {
      const dept = e.department ?? 'an agent';
      completedByDept.set(dept, (completedByDept.get(dept) ?? 0) + 1);
    } else if (e.type === 'integration_connected') {
      integrationsConnected.push(e.summary);
    } else if (e.type === 'stage_advanced') {
      stagesAdvanced.push(e.summary);
    } else if (e.type === 'gate_completed') {
      gatesCompleted.push(e.summary);
    }
  }

  const lines: string[] = [];

  if (draftsAccepted > 0) {
    lines.push(
      draftsAccepted === 1
        ? 'You approved 1 draft.'
        : `You approved ${draftsAccepted} drafts.`,
    );
  }

  for (const [dept, count] of completedByDept) {
    const noun = count === 1 ? 'run' : 'runs';
    lines.push(`${dept} completed ${count} ${noun}.`);
  }

  for (const s of stagesAdvanced) lines.push(s);
  for (const s of gatesCompleted) lines.push(s);
  for (const s of integrationsConnected) lines.push(s);

  return lines.slice(0, HIGHLIGHT_CAP);
}

/** Build the action list from the live backlogs. Each action links to the
 *  surface that resolves it — approvals for drafts + paused runs, the task
 *  list for stalled tasks. */
function buildActions(
  slug: string,
  pendingApprovals: number,
  pausedRuns: number,
  overdueTasks: number,
): BriefingAction[] {
  const actions: BriefingAction[] = [];
  const approvalsHref = `/s/${slug}/chat/approvals`;
  const tasksHref = `/s/${slug}/tasks`;

  if (pendingApprovals > 0) {
    actions.push({
      label:
        pendingApprovals === 1
          ? 'Approve 1 draft waiting for you.'
          : `Approve ${pendingApprovals} drafts waiting for you.`,
      href: approvalsHref,
    });
  }

  if (pausedRuns > 0) {
    actions.push({
      label:
        pausedRuns === 1
          ? 'Decide on 1 paused run.'
          : `Decide on ${pausedRuns} paused runs.`,
      href: approvalsHref,
    });
  }

  if (overdueTasks > 0) {
    actions.push({
      label:
        overdueTasks === 1
          ? 'Unblock 1 stalled task.'
          : `Unblock ${overdueTasks} stalled tasks.`,
      href: tasksHref,
    });
  }

  return actions.slice(0, ACTION_CAP);
}

/** Pending AgentDraft count for a space. */
async function countPendingDrafts(spaceId: string): Promise<number> {
  const { count, error } = await supabase
    .from('AgentDraft')
    .select('id', { count: 'exact', head: true })
    .eq('spaceId', spaceId)
    .eq('status', 'pending');
  if (error) {
    logger.warn('[briefing] countPendingDrafts failed', { spaceId, err: error.message });
    return 0;
  }
  return count ?? 0;
}

/** Pending AgentPausedRun count for a space. */
async function countPausedRuns(spaceId: string): Promise<number> {
  const { count, error } = await supabase
    .from('AgentPausedRun')
    .select('id', { count: 'exact', head: true })
    .eq('spaceId', spaceId)
    .eq('status', 'pending');
  if (error) {
    logger.warn('[briefing] countPausedRuns failed', { spaceId, err: error.message });
    return 0;
  }
  return count ?? 0;
}

/**
 * Stalled AgentTask count: status running or paused for over 24h with no
 * progress. Cheap, conservative — better to under-report than nag.
 */
async function countStalledTasks(spaceId: string, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - DAY_MS).toISOString();
  const { count, error } = await supabase
    .from('AgentTask')
    .select('id', { count: 'exact', head: true })
    .eq('spaceId', spaceId)
    .in('status', ['running', 'paused'])
    .lt('updatedAt', cutoff);
  if (error) {
    logger.warn('[briefing] countStalledTasks failed', { spaceId, err: error.message });
    return 0;
  }
  return count ?? 0;
}

/** Current stage from WorkspaceStage; defaults to 'idea' if none. */
async function getCurrentStage(spaceId: string): Promise<string> {
  const { data, error } = await supabase
    .from('WorkspaceStage')
    .select('stage')
    .eq('spaceId', spaceId)
    .is('exitedAt', null)
    .order('enteredAt', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    logger.warn('[briefing] getCurrentStage failed', { spaceId, err: error.message });
    return 'idea';
  }
  return (data?.stage as string | undefined) ?? 'idea';
}

/** Load Space + owner User in two cheap queries. */
async function loadSpaceAndOwner(
  spaceId: string,
): Promise<{ space: SpaceRow; owner: UserRow } | null> {
  const { data: space, error: spaceErr } = await supabase
    .from('Space')
    .select('id, name, slug, ownerId')
    .eq('id', spaceId)
    .maybeSingle();
  if (spaceErr || !space) {
    logger.warn('[briefing] space lookup failed', { spaceId, err: spaceErr?.message });
    return null;
  }
  const s = space as SpaceRow;
  const { data: owner, error: ownerErr } = await supabase
    .from('User')
    .select('id, email, name')
    .eq('id', s.ownerId)
    .maybeSingle();
  if (ownerErr || !owner) {
    logger.warn('[briefing] owner lookup failed', { spaceId, err: ownerErr?.message });
    return null;
  }
  return { space: s, owner: owner as UserRow };
}

/**
 * Build a daily briefing for one space. Returns null if the space or owner
 * cannot be loaded — callers should treat null as "skip silently".
 */
export async function buildDailyBriefing(
  spaceId: string,
  now: Date = new Date(),
): Promise<DailyBriefingData | null> {
  const ctx = await loadSpaceAndOwner(spaceId);
  if (!ctx) return null;

  const sinceIso = new Date(now.getTime() - DAY_MS).toISOString();

  // Audit feed for last 24h. `beforeIso` is exclusive-upper; we want lower
  // bound, so we pull a generous slice and filter locally.
  const auditAll = await loadAuditFeed(spaceId, { limit: 200 });
  const audit24h = auditAll.filter((e) => e.occurredAt >= sinceIso);

  const yesterdayHighlights = summarizeHighlights(audit24h);

  const [
    pendingApprovalsCount,
    pausedRunsCount,
    openTasksCount,
    currentStage,
    upcomingRows,
  ] = await Promise.all([
    countPendingDrafts(spaceId),
    countPausedRuns(spaceId),
    countStalledTasks(spaceId, now),
    getCurrentStage(spaceId),
    listUpcomingTriggersForSpace(spaceId, UPCOMING_CAP),
  ]);

  const needsYouToday = buildActions(
    ctx.space.slug,
    pendingApprovalsCount,
    pausedRunsCount,
    openTasksCount,
  );

  const comingUp: BriefingUpcoming[] = upcomingRows.map((r) => ({
    triggerId: r.id,
    runAt: r.runAt,
    reason: r.reason,
    source: r.source,
  }));

  // Rest-day excludes the calendar — having scheduled work doesn't count
  // as "needs you", but it does count as "Charles is busy", so the
  // briefing still has substance.
  const isRestDay =
    yesterdayHighlights.length === 0 &&
    needsYouToday.length === 0 &&
    comingUp.length === 0;

  return {
    founderFirstName: firstNameOf(ctx.owner.name),
    workspaceName: ctx.space.name,
    yesterdayHighlights,
    needsYouToday,
    comingUp,
    pendingApprovalsCount,
    openTasksCount,
    currentStage,
    isRestDay,
  };
}

/** Internal helper, exported for tests: produce highlights from events. */
export const _internals = {
  summarizeHighlights,
  buildActions,
  firstNameOf,
};
