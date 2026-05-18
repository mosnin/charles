/**
 * Server-only liveMessages helpers, called from Next.js routes via
 * ConvexHttpClient with the CONVEX_SERVICE_SECRET shared key. These
 * bypass the user-auth check on liveMessages.send because the caller
 * is our trusted Next.js server (which has already authed the user via
 * Clerk) and also let us set persistedToSupabase=true since the durable
 * Supabase write has already succeeded.
 */
import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';

const PRUNE_BATCH = 500;
const PRUNE_AGE_MS = 24 * 60 * 60 * 1000;

function assertServiceSecret(provided: string | undefined): void {
  const expected = process.env.CONVEX_SERVICE_SECRET;
  if (!expected) {
    throw new Error('CONVEX_SERVICE_SECRET not configured');
  }
  if (provided !== expected) {
    throw new Error('Invalid service secret');
  }
}

export const mirrorMessage = mutation({
  args: {
    serviceSecret: v.string(),
    conversationId: v.string(),
    spaceId: v.string(),
    role: v.union(v.literal('user'), v.literal('assistant'), v.literal('system')),
    content: v.string(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<string> => {
    assertServiceSecret(args.serviceSecret);
    const id = await ctx.db.insert('liveMessages', {
      spaceId: args.spaceId,
      conversationId: args.conversationId,
      role: args.role,
      content: args.content,
      metadata: args.metadata,
      createdAt: Date.now(),
      persistedToSupabase: true,
    });
    // String form is fine for the wire — Next.js routes pass it back to
    // Supabase via `UPDATE ... SET convexMessageId = ?` and the audit
    // backfill query also keys on the same string.
    return id as unknown as string;
  },
});

export const listUnpersisted = query({
  args: { serviceSecret: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    assertServiceSecret(args.serviceSecret);
    const cap = args.limit ?? 200;
    const rows = await ctx.db.query('liveMessages').collect();
    return rows
      .filter((r: any) => r.persistedToSupabase === false)
      .sort((a: any, b: any) => a.createdAt - b.createdAt)
      .slice(0, cap);
  },
});

export const flagPersisted = mutation({
  args: { serviceSecret: v.string(), messageId: v.id('liveMessages') },
  handler: async (ctx, args) => {
    assertServiceSecret(args.serviceSecret);
    await ctx.db.patch(args.messageId, { persistedToSupabase: true });
  },
});

export const prunePersisted = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - PRUNE_AGE_MS;
    const rows = await ctx.db
      .query('liveMessages')
      .filter((q: any) =>
        q.and(
          q.eq(q.field('persistedToSupabase'), true),
          q.lt(q.field('createdAt'), cutoff),
        ),
      )
      .take(PRUNE_BATCH);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    return { deleted: rows.length };
  },
});
