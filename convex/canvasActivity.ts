/**
 * Transient department-activity pings ("Engineering: building prospect list").
 *
 * These are not durable run records — those live in Supabase. This table
 * exists so every connected surface can show "something is happening
 * right now" without a poll loop. Rows TTL after five minutes; `forSpace`
 * filters expired rows on read and `cleanup` removes them on demand.
 */
import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';

const TTL_MS = 5 * 60_000;

const department = v.union(
  v.literal('engineering'),
  v.literal('sales'),
  v.literal('marketing'),
  v.literal('design'),
  v.literal('support'),
  v.literal('ops_finance'),
);

const kind = v.union(
  v.literal('running'),
  v.literal('queued'),
  v.literal('done'),
  v.literal('failed'),
);

export const emit = mutation({
  args: {
    spaceId: v.string(),
    department,
    kind,
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('Not authenticated');

    const now = Date.now();
    return await ctx.db.insert('canvasActivity', {
      spaceId: args.spaceId,
      department: args.department,
      kind: args.kind,
      summary: args.summary,
      createdAt: now,
      expiresAt: now + TTL_MS,
    });
  },
});

export const forSpace = query({
  args: { spaceId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('Not authenticated');

    const cutoff = Date.now() - TTL_MS;
    const rows = await ctx.db
      .query('canvasActivity')
      .withIndex('by_space', (q: any) => q.eq('spaceId', args.spaceId))
      .collect();
    return rows
      .filter((row: any) => row.createdAt > cutoff)
      .sort((a: any, b: any) => b.createdAt - a.createdAt);
  },
});

export const cleanup = internalMutation({
  args: { spaceId: v.string() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - TTL_MS;
    const rows = await ctx.db
      .query('canvasActivity')
      .withIndex('by_space', (q: any) => q.eq('spaceId', args.spaceId))
      .collect();
    for (const row of rows) {
      if (row.createdAt <= cutoff) {
        await ctx.db.delete(row._id);
      }
    }
  },
});
