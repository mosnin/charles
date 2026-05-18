/**
 * In-flight chat messages.
 *
 * Charles writes here first so every connected surface sees the message
 * instantly. A background worker reads `persistedToSupabase=false` rows,
 * writes them into `TaskConversation` in Supabase, then flips the flag.
 * Once flipped, the row can be GC'd; it has already become durable.
 */
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

export const send = mutation({
  args: {
    conversationId: v.string(),
    spaceId: v.string(),
    role: v.union(v.literal('user'), v.literal('assistant'), v.literal('system')),
    content: v.string(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('Not authenticated');

    return await ctx.db.insert('liveMessages', {
      spaceId: args.spaceId,
      conversationId: args.conversationId,
      role: args.role,
      content: args.content,
      metadata: args.metadata,
      createdAt: Date.now(),
      persistedToSupabase: false,
    });
  },
});

export const forConversation = query({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('Not authenticated');

    const rows = await ctx.db
      .query('liveMessages')
      .withIndex('by_conversation', (q: any) =>
        q.eq('conversationId', args.conversationId),
      )
      .collect();
    return rows.sort((a: any, b: any) => a.createdAt - b.createdAt);
  },
});

export const markPersisted = mutation({
  args: { messageId: v.id('liveMessages') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('Not authenticated');

    await ctx.db.patch(args.messageId, { persistedToSupabase: true });
  },
});
