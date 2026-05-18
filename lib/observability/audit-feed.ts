/**
 * Unified audit feed — read-only view across the tables that already record
 * consequential things Charles does. No new storage; everything here is a
 * projection of existing rows into one `AuditEvent` shape.
 *
 * Sources today:
 *   - SwarmMember  → agent_run_started / _completed / _failed
 *   - AgentDraft   → draft_created / _accepted / _declined
 *   - AgentPausedRun → paused_run_approved / _declined
 *   - IntegrationConnection → integration_connected / _disconnected
 *   - WorkspaceStage → stage_advanced
 *   - StageGate     → gate_completed
 *
 * Each table is queried in parallel via Promise.allSettled. If a query
 * fails (table not yet migrated in this env, schema drift, RLS quirk) we
 * log a warning and continue with whatever did succeed. Empty array is
 * always a valid result — UI handles "Nothing yet."
 *
 * No new columns, no new tables. If you find yourself wanting to JOIN here
 * to make the summary nicer, write the summary off what you already have.
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export type AuditEventType =
  | 'agent_run_started'
  | 'agent_run_completed'
  | 'agent_run_failed'
  | 'draft_created'
  | 'draft_accepted'
  | 'draft_declined'
  | 'paused_run_approved'
  | 'paused_run_declined'
  | 'integration_connected'
  | 'integration_disconnected'
  | 'stage_advanced'
  | 'gate_completed';

export interface AuditEvent {
  /** Unique across sources. Format: `<sourceTag>:<rowId>:<phase?>`. */
  id: string;
  type: AuditEventType;
  /** ISO timestamp of when the event happened. */
  occurredAt: string;
  actor: 'agent' | 'founder' | 'system';
  department?: string;
  /** Founder-readable, one sentence, no jargon. */
  summary: string;
  ref?: {
    kind: 'run' | 'draft' | 'paused' | 'integration' | 'stage' | 'gate';
    id: string;
  };
}

export interface LoadAuditOpts {
  /** Default 50. Capped at 200. */
  limit?: number;
  /** Pagination cursor — only events strictly older than this ISO. */
  beforeIso?: string;
  /** Single-type filter (server-side). */
  type?: AuditEventType;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/**
 * Per-source pull size. We pull `limit` from each source then merge-sort
 * and slice — if one source dominates we still surface the others.
 */
const PER_SOURCE_PULL = MAX_LIMIT;

/* ─── Row shapes (what we read) ────────────────────────────────────────── */

interface SwarmMemberRow {
  id: string;
  name: string;
  role: string | null;
  task: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface AgentDraftRow {
  id: string;
  channel: 'sms' | 'email' | 'note';
  subject: string | null;
  status: 'pending' | 'approved' | 'dismissed' | 'sent';
  createdAt: string;
  updatedAt: string;
}

interface AgentPausedRunRow {
  id: string;
  status: 'pending' | 'resumed' | 'cancelled' | 'expired';
  createdAt: string;
  updatedAt: string;
}

interface IntegrationConnectionRow {
  id: string;
  toolkit: string;
  status: 'active' | 'expired' | 'revoked' | 'failed';
  label: string | null;
  createdAt: string;
  updatedAt: string;
}

interface WorkspaceStageRow {
  id: string;
  stage: string;
  enteredAt: string;
  exitedBy: 'agent' | 'founder' | 'gate' | null;
}

interface StageGateRow {
  id: string;
  stage: string;
  title: string;
  isComplete: boolean;
  completedAt: string | null;
}

/* ─── Helpers ──────────────────────────────────────────────────────────── */

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n).trimEnd() + '…';
}

function olderThan(ts: string | null | undefined, beforeIso: string | undefined): boolean {
  if (!beforeIso) return true;
  if (!ts) return false;
  return ts < beforeIso;
}

/* ─── Per-source loaders ───────────────────────────────────────────────── */

async function loadSwarmMembers(spaceId: string, beforeIso?: string): Promise<AuditEvent[]> {
  // SwarmMember rows don't carry spaceId directly — they hang off SwarmRun.
  // Query via inner join syntax PostgREST supports: filter on the parent
  // via embedded resource.
  const { data, error } = await supabase
    .from('SwarmMember')
    .select(
      'id, name, role, task, status, startedAt, completedAt, createdAt, swarmRun:SwarmRun!inner(spaceId)',
    )
    .eq('swarmRun.spaceId', spaceId)
    .order('createdAt', { ascending: false })
    .limit(PER_SOURCE_PULL);
  if (error) throw error;
  const rows = (data ?? []) as Array<SwarmMemberRow & { swarmRun?: unknown }>;
  const events: AuditEvent[] = [];
  for (const r of rows) {
    const dept = r.role ?? undefined;
    const taskShort = truncate(r.task ?? '', 80);
    if (r.startedAt && olderThan(r.startedAt, beforeIso)) {
      events.push({
        id: `swarm:${r.id}:started`,
        type: 'agent_run_started',
        occurredAt: r.startedAt,
        actor: 'agent',
        department: dept,
        summary: `${r.name} started: ${taskShort}`,
        ref: { kind: 'run', id: r.id },
      });
    }
    if (r.completedAt && olderThan(r.completedAt, beforeIso)) {
      if (r.status === 'completed') {
        events.push({
          id: `swarm:${r.id}:completed`,
          type: 'agent_run_completed',
          occurredAt: r.completedAt,
          actor: 'agent',
          department: dept,
          summary: `${r.name} completed: ${taskShort}`,
          ref: { kind: 'run', id: r.id },
        });
      } else if (r.status === 'failed') {
        events.push({
          id: `swarm:${r.id}:failed`,
          type: 'agent_run_failed',
          occurredAt: r.completedAt,
          actor: 'agent',
          department: dept,
          summary: `${r.name} failed: ${taskShort}`,
          ref: { kind: 'run', id: r.id },
        });
      }
    }
  }
  return events;
}

async function loadAgentDrafts(spaceId: string, beforeIso?: string): Promise<AuditEvent[]> {
  const { data, error } = await supabase
    .from('AgentDraft')
    .select('id, channel, subject, status, createdAt, updatedAt')
    .eq('spaceId', spaceId)
    .order('updatedAt', { ascending: false })
    .limit(PER_SOURCE_PULL);
  if (error) throw error;
  const rows = (data ?? []) as AgentDraftRow[];
  const events: AuditEvent[] = [];
  for (const r of rows) {
    const subj = r.subject ? truncate(r.subject, 60) : `${r.channel} draft`;
    if (olderThan(r.createdAt, beforeIso)) {
      events.push({
        id: `draft:${r.id}:created`,
        type: 'draft_created',
        occurredAt: r.createdAt,
        actor: 'agent',
        summary: `I drafted a ${r.channel}: ${subj}.`,
        ref: { kind: 'draft', id: r.id },
      });
    }
    // 'approved' and 'sent' both reflect founder acceptance of the draft.
    if (
      (r.status === 'approved' || r.status === 'sent') &&
      r.updatedAt !== r.createdAt &&
      olderThan(r.updatedAt, beforeIso)
    ) {
      events.push({
        id: `draft:${r.id}:accepted`,
        type: 'draft_accepted',
        occurredAt: r.updatedAt,
        actor: 'founder',
        summary: `You approved the ${r.channel}: ${subj}.`,
        ref: { kind: 'draft', id: r.id },
      });
    } else if (
      r.status === 'dismissed' &&
      r.updatedAt !== r.createdAt &&
      olderThan(r.updatedAt, beforeIso)
    ) {
      events.push({
        id: `draft:${r.id}:declined`,
        type: 'draft_declined',
        occurredAt: r.updatedAt,
        actor: 'founder',
        summary: `You declined the ${r.channel}: ${subj}.`,
        ref: { kind: 'draft', id: r.id },
      });
    }
  }
  return events;
}

async function loadPausedRuns(spaceId: string, beforeIso?: string): Promise<AuditEvent[]> {
  const { data, error } = await supabase
    .from('AgentPausedRun')
    .select('id, status, createdAt, updatedAt')
    .eq('spaceId', spaceId)
    .order('updatedAt', { ascending: false })
    .limit(PER_SOURCE_PULL);
  if (error) throw error;
  const rows = (data ?? []) as AgentPausedRunRow[];
  const events: AuditEvent[] = [];
  for (const r of rows) {
    if (r.updatedAt === r.createdAt) continue;
    if (!olderThan(r.updatedAt, beforeIso)) continue;
    if (r.status === 'resumed') {
      events.push({
        id: `paused:${r.id}:approved`,
        type: 'paused_run_approved',
        occurredAt: r.updatedAt,
        actor: 'founder',
        summary: 'You approved a paused run.',
        ref: { kind: 'paused', id: r.id },
      });
    } else if (r.status === 'cancelled') {
      events.push({
        id: `paused:${r.id}:declined`,
        type: 'paused_run_declined',
        occurredAt: r.updatedAt,
        actor: 'founder',
        summary: 'You declined a paused run.',
        ref: { kind: 'paused', id: r.id },
      });
    }
  }
  return events;
}

async function loadIntegrationConnections(
  spaceId: string,
  beforeIso?: string,
): Promise<AuditEvent[]> {
  const { data, error } = await supabase
    .from('IntegrationConnection')
    .select('id, toolkit, status, label, createdAt, updatedAt')
    .eq('spaceId', spaceId)
    .order('updatedAt', { ascending: false })
    .limit(PER_SOURCE_PULL);
  if (error) throw error;
  const rows = (data ?? []) as IntegrationConnectionRow[];
  const events: AuditEvent[] = [];
  for (const r of rows) {
    const name = r.label ? `${r.toolkit} (${r.label})` : r.toolkit;
    // Connect — row creation, status='active' at creation time.
    if (olderThan(r.createdAt, beforeIso)) {
      events.push({
        id: `integration:${r.id}:connected`,
        type: 'integration_connected',
        occurredAt: r.createdAt,
        actor: 'founder',
        summary: `You connected ${name}.`,
        ref: { kind: 'integration', id: r.id },
      });
    }
    // Disconnect — current status revoked, updated after created.
    if (
      r.status === 'revoked' &&
      r.updatedAt !== r.createdAt &&
      olderThan(r.updatedAt, beforeIso)
    ) {
      events.push({
        id: `integration:${r.id}:disconnected`,
        type: 'integration_disconnected',
        occurredAt: r.updatedAt,
        actor: 'founder',
        summary: `You disconnected ${name}.`,
        ref: { kind: 'integration', id: r.id },
      });
    }
  }
  return events;
}

async function loadWorkspaceStages(spaceId: string, beforeIso?: string): Promise<AuditEvent[]> {
  const { data, error } = await supabase
    .from('WorkspaceStage')
    .select('id, stage, enteredAt, exitedBy')
    .eq('spaceId', spaceId)
    .order('enteredAt', { ascending: false })
    .limit(PER_SOURCE_PULL);
  if (error) throw error;
  const rows = (data ?? []) as WorkspaceStageRow[];
  const events: AuditEvent[] = [];
  for (const r of rows) {
    if (!olderThan(r.enteredAt, beforeIso)) continue;
    const actor: AuditEvent['actor'] = r.exitedBy === 'founder' ? 'founder' : 'agent';
    events.push({
      id: `stage:${r.id}:advanced`,
      type: 'stage_advanced',
      occurredAt: r.enteredAt,
      actor,
      summary: `Workspace advanced to ${r.stage}.`,
      ref: { kind: 'stage', id: r.id },
    });
  }
  return events;
}

async function loadStageGates(spaceId: string, beforeIso?: string): Promise<AuditEvent[]> {
  const { data, error } = await supabase
    .from('StageGate')
    .select('id, stage, title, isComplete, completedAt')
    .eq('spaceId', spaceId)
    .eq('isComplete', true)
    .order('completedAt', { ascending: false })
    .limit(PER_SOURCE_PULL);
  if (error) throw error;
  const rows = (data ?? []) as StageGateRow[];
  const events: AuditEvent[] = [];
  for (const r of rows) {
    if (!r.completedAt) continue;
    if (!olderThan(r.completedAt, beforeIso)) continue;
    events.push({
      id: `gate:${r.id}:completed`,
      type: 'gate_completed',
      occurredAt: r.completedAt,
      actor: 'agent',
      summary: `Gate completed: ${r.title}.`,
      ref: { kind: 'gate', id: r.id },
    });
  }
  return events;
}

/* ─── Public API ───────────────────────────────────────────────────────── */

export async function loadAuditFeed(
  spaceId: string,
  opts: LoadAuditOpts = {},
): Promise<AuditEvent[]> {
  const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

  const results = await Promise.allSettled([
    loadSwarmMembers(spaceId, opts.beforeIso),
    loadAgentDrafts(spaceId, opts.beforeIso),
    loadPausedRuns(spaceId, opts.beforeIso),
    loadIntegrationConnections(spaceId, opts.beforeIso),
    loadWorkspaceStages(spaceId, opts.beforeIso),
    loadStageGates(spaceId, opts.beforeIso),
  ]);

  const labels = ['SwarmMember', 'AgentDraft', 'AgentPausedRun', 'IntegrationConnection', 'WorkspaceStage', 'StageGate'];
  const merged: AuditEvent[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      merged.push(...r.value);
    } else {
      logger.warn('[audit-feed] source failed', {
        source: labels[i],
        err: String(r.reason),
      });
    }
  }

  // Apply type filter before sort/slice — cheap and shrinks the heap.
  const filtered = opts.type ? merged.filter((e) => e.type === opts.type) : merged;

  filtered.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));

  return filtered.slice(0, limit);
}
