/**
 * Presence: who's looking at this space right now, where their cursor is.
 *
 * Heartbeat upserts the (spaceId, userId) row; listActive returns anyone
 * who's pinged in the last 30s; clear runs on tab close. None of this
 * persists to Supabase — when the user closes the tab their presence
 * row goes stale and gets filtered out by listActive's freshness window.
 */
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

const FRESHNESS_MS = 30_000;

export const heartbeat = mutation({
  args: {
    spaceId: v.string(),
    surface: v.string(),
    cursorX: v.optional(v.number()),
    cursorY: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('Not authenticated');

    const userId = identity.subject;
    const userName = identity.name ?? identity.givenName ?? 'Founder';
    const userImage = identity.pictureUrl ?? undefined;
    const now = Date.now();

    const existing = await ctx.db
      .query('presence')
      .withIndex('by_space', (q: any) => q.eq('spaceId', args.spaceId))
      .filter((q: any) => q.eq(q.field('userId'), userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        surface: args.surface,
        cursorX: args.cursorX,
        cursorY: args.cursorY,
        userName,
        userImage,
        lastActiveAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert('presence', {
      spaceId: args.spaceId,
      userId,
      userName,
      userImage,
      surface: args.surface,
      cursorX: args.cursorX,
      cursorY: args.cursorY,
      lastActiveAt: now,
    });
  },
});

export const listActive = query({
  args: { spaceId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('Not authenticated');

    const cutoff = Date.now() - FRESHNESS_MS;
    const rows = await ctx.db
      .query('presence')
      .withIndex('by_space_active', (q: any) =>
        q.eq('spaceId', args.spaceId).gt('lastActiveAt', cutoff),
      )
      .collect();
    return rows;
  },
});

export const clear = mutation({
  args: { spaceId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('Not authenticated');

    const userId = identity.subject;
    const row = await ctx.db
      .query('presence')
      .withIndex('by_space', (q: any) => q.eq('spaceId', args.spaceId))
      .filter((q: any) => q.eq(q.field('userId'), userId))
      .first();
    if (row) await ctx.db.delete(row._id);
  },
});
