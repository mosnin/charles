/**
 * ScheduledTrigger repo — the agent's calendar.
 *
 * Persistence layer for the row defined in
 * supabase/migrations/20260517000000_scheduled_triggers.sql. Wraps the
 * Supabase client so callers (the agent's Python tool via the bridge,
 * the fanout cron, the briefing builder, the founder UI) reach for a
 * named function instead of writing inline SQL.
 *
 * Status lifecycle: pending → fired (cron picked it up) / cancelled
 * (founder dismissed) / expired (cron missed the window — rare, only
 * if cron was down for many hours).
 */

import { supabase } from '@/lib/supabase';

export type TriggerStatus = 'pending' | 'fired' | 'cancelled' | 'expired';
export type TriggerSource = 'agent' | 'heartbeat' | 'founder' | 'system';

export interface ScheduledTrigger {
  id: string;
  spaceId: string;
  runAt: string;
  reason: string;
  payload: Record<string, unknown>;
  createdByTaskId: string | null;
  source: TriggerSource;
  status: TriggerStatus;
  firedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

export interface CreateScheduledTriggerInput {
  spaceId: string;
  runAt: string | Date;
  reason: string;
  payload?: Record<string, unknown>;
  createdByTaskId?: string | null;
  source?: TriggerSource;
}

/**
 * Create a pending scheduled trigger. Validates that runAt is in the
 * future — refusing past-dated triggers prevents the fanout cron from
 * firing something the agent already missed by accident (a clock-skew
 * artifact or a buggy caller).
 */
export async function createScheduledTrigger(
  input: CreateScheduledTriggerInput,
): Promise<{ ok: true; trigger: ScheduledTrigger } | { ok: false; error: string }> {
  const runAtIso =
    typeof input.runAt === 'string' ? input.runAt : input.runAt.toISOString();
  const runAtMs = new Date(runAtIso).getTime();
  if (!Number.isFinite(runAtMs)) {
    return { ok: false, error: `runAt is not a valid timestamp: ${input.runAt}` };
  }
  if (runAtMs <= Date.now()) {
    return { ok: false, error: 'runAt must be in the future' };
  }
  if (!input.reason.trim()) {
    return { ok: false, error: 'reason is required' };
  }

  const { data, error } = await supabase
    .from('ScheduledTrigger')
    .insert({
      spaceId: input.spaceId,
      runAt: runAtIso,
      reason: input.reason.trim(),
      payload: input.payload ?? {},
      createdByTaskId: input.createdByTaskId ?? null,
      source: input.source ?? 'agent',
    })
    .select()
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'insert returned no row' };
  }
  return { ok: true, trigger: data as ScheduledTrigger };
}

/**
 * Triggers the fanout cron should fire NOW. Capped to bound a single
 * cron invocation's work — a backlog spike doesn't blow the timeout.
 * Returns oldest-first so old wakes fire before fresh ones.
 */
export async function listReadyTriggers(
  now: Date,
  limit = 50,
): Promise<ScheduledTrigger[]> {
  const { data, error } = await supabase
    .from('ScheduledTrigger')
    .select('*')
    .eq('status', 'pending')
    .lte('runAt', now.toISOString())
    .order('runAt', { ascending: true })
    .limit(limit);

  if (error) throw new Error(`listReadyTriggers: ${error.message}`);
  return (data ?? []) as ScheduledTrigger[];
}

/**
 * Upcoming triggers for a single space — what powers the briefing's
 * "Coming up" section and any founder-facing calendar surface.
 */
export async function listUpcomingTriggersForSpace(
  spaceId: string,
  limit = 5,
): Promise<ScheduledTrigger[]> {
  const { data, error } = await supabase
    .from('ScheduledTrigger')
    .select('*')
    .eq('spaceId', spaceId)
    .eq('status', 'pending')
    .order('runAt', { ascending: true })
    .limit(limit);

  if (error) throw new Error(`listUpcomingTriggersForSpace: ${error.message}`);
  return (data ?? []) as ScheduledTrigger[];
}

export async function markTriggerFired(id: string): Promise<void> {
  const { error } = await supabase
    .from('ScheduledTrigger')
    .update({ status: 'fired', firedAt: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending');
  if (error) throw new Error(`markTriggerFired(${id}): ${error.message}`);
}

export async function cancelScheduledTrigger(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('ScheduledTrigger')
    .update({ status: 'cancelled', cancelledAt: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending');
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
