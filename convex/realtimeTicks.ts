/**
 * Realtime ticks — tiny "refresh me" signals for surfaces that aggregate
 * Supabase state.
 *
 * When a paused-for-approval task lands, or when any audit-feed-relevant
 * write happens, the producer emits a tick. Connected clients subscribe
 * via the by-space-kind index to the most-recent tick and re-fetch their
 * canonical data from Supabase. The tick carries no payload — it's just
 * "something changed, look again." Trades a few extra refetches for
 * keeping the aggregation logic in one place.
 *
 * Rows TTL after five minutes; cleanup hits them hourly.
 */
import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';

const TTL_MS = 5 * 60_000;

const kind = v.union(v.literal('approval'), v.literal('audit'));

export const emit = mutation({
  args: {
    spaceId: v.string(),
    kind,
    summary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('Not authenticated');

    const now = Date.now();
    return await ctx.db.insert('realtimeTicks', {
      spaceId: args.spaceId,
      kind: args.kind,
      summary: args.summary,
      createdAt: now,
      expiresAt: now + TTL_MS,
    });
  },
});

/**
 * Latest non-expired tick for one (spaceId, kind). Returns null when
 * nothing has happened recently — the subscribing client treats that as
 * "no change since last load." Most clients only care about createdAt;
 * we return the whole row so debugging via .summary is easy.
 */
export const latestForSpace = query({
  args: { spaceId: v.string(), kind },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('Not authenticated');

    const cutoff = Date.now() - TTL_MS;
    const rows = await ctx.db
      .query('realtimeTicks')
      .withIndex('by_space_kind', (q: any) =>
        q.eq('spaceId', args.spaceId).eq('kind', args.kind),
      )
      .collect();
    const live = rows.filter((row: any) => row.createdAt > cutoff);
    if (live.length === 0) return null;
    live.sort((a: any, b: any) => b.createdAt - a.createdAt);
    return live[0];
  },
});

const CLEANUP_BATCH = 500;

export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query('realtimeTicks')
      .filter((q: any) => q.lt(q.field('expiresAt'), now))
      .take(CLEANUP_BATCH);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    return { deleted: rows.length };
  },
});
