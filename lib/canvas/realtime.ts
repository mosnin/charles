/**
 * Canvas Realtime subscriptions — thin wrappers around Supabase channels
 * that the canvas surfaces use to refresh dept dots and the audit feed
 * without polling-only latency.
 *
 * Subscriptions are best-effort: if the browser client can't initialize
 * (missing env vars, network blocked) the helpers return a no-op
 * unsubscribe and the caller falls back to its existing polling tick.
 * Never block the UI on a working Realtime path.
 */

import { getSupabaseBrowser } from '@/lib/supabase-browser';

type Unsubscribe = () => void;

/**
 * Subscribe to dept-affecting changes for one space: SwarmMember +
 * AgentDraft + AgentPausedRun row inserts/updates/deletes. Invokes
 * `onChange` once per change; the caller is responsible for debouncing
 * if it wants to coalesce bursts. Returns an unsubscribe function.
 */
export function subscribeToDeptActivity(
  spaceId: string,
  onChange: () => void,
): Unsubscribe {
  const client = getSupabaseBrowser();
  if (!client) return () => {};

  const channel = client.channel(`canvas:dept:${spaceId}`);
  // SwarmMember rows don't carry spaceId — they hang off SwarmRun. We
  // can't filter them server-side here without joining, so we accept
  // the cross-workspace noise and the consumer re-fetches scoped data.
  channel.on(
    'postgres_changes' as never,
    { event: '*', schema: 'public', table: 'SwarmMember' },
    () => onChange(),
  );
  channel.on(
    'postgres_changes' as never,
    { event: '*', schema: 'public', table: 'AgentDraft', filter: `spaceId=eq.${spaceId}` },
    () => onChange(),
  );
  channel.on(
    'postgres_changes' as never,
    { event: '*', schema: 'public', table: 'AgentPausedRun', filter: `spaceId=eq.${spaceId}` },
    () => onChange(),
  );

  let subscribed = true;
  channel.subscribe();

  return () => {
    if (!subscribed) return;
    subscribed = false;
    try {
      client.removeChannel(channel);
    } catch {
      // Best-effort.
    }
  };
}

/**
 * Subscribe to audit-feed-affecting changes for one space — same source
 * tables as `loadAuditFeed`. Calls `onChange` when any row touches.
 */
export function subscribeToAuditFeed(
  spaceId: string,
  onChange: () => void,
): Unsubscribe {
  const client = getSupabaseBrowser();
  if (!client) return () => {};

  const channel = client.channel(`canvas:audit:${spaceId}`);
  channel.on(
    'postgres_changes' as never,
    { event: '*', schema: 'public', table: 'SwarmMember' },
    () => onChange(),
  );
  channel.on(
    'postgres_changes' as never,
    { event: '*', schema: 'public', table: 'AgentDraft', filter: `spaceId=eq.${spaceId}` },
    () => onChange(),
  );
  channel.on(
    'postgres_changes' as never,
    { event: '*', schema: 'public', table: 'AgentPausedRun', filter: `spaceId=eq.${spaceId}` },
    () => onChange(),
  );
  channel.on(
    'postgres_changes' as never,
    { event: '*', schema: 'public', table: 'TaskMessage' },
    () => onChange(),
  );

  let subscribed = true;
  channel.subscribe();

  return () => {
    if (!subscribed) return;
    subscribed = false;
    try {
      client.removeChannel(channel);
    } catch {
      // Best-effort.
    }
  };
}
