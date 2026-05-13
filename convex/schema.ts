/**
 * Convex schema for Charles' live-state layer.
 *
 * Three tables only. Each one models something ephemeral that needs to
 * fan out to every connected client in real time but does NOT need to
 * survive a session: presence (who's here right now), liveMessages
 * (chat in flight before it's audit-backfilled to Supabase), and
 * canvasActivity (transient "Engineering is building a prospect list"
 * status pings). Durable state stays in Supabase — see docs/CONVEX.md.
 */
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  presence: defineTable({
    spaceId: v.string(),
    userId: v.string(),
    userName: v.string(),
    userImage: v.optional(v.string()),
    surface: v.string(),
    cursorX: v.optional(v.number()),
    cursorY: v.optional(v.number()),
    lastActiveAt: v.number(),
  })
    .index('by_space', ['spaceId'])
    .index('by_space_active', ['spaceId', 'lastActiveAt']),

  liveMessages: defineTable({
    spaceId: v.string(),
    conversationId: v.string(),
    role: v.union(v.literal('user'), v.literal('assistant'), v.literal('system')),
    content: v.string(),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
    persistedToSupabase: v.boolean(),
  })
    .index('by_conversation', ['conversationId'])
    .index('by_space', ['spaceId']),

  canvasActivity: defineTable({
    spaceId: v.string(),
    department: v.union(
      v.literal('engineering'),
      v.literal('sales'),
      v.literal('marketing'),
      v.literal('design'),
      v.literal('support'),
      v.literal('ops_finance'),
    ),
    kind: v.union(
      v.literal('running'),
      v.literal('queued'),
      v.literal('done'),
      v.literal('failed'),
    ),
    summary: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index('by_space', ['spaceId'])
    .index('by_space_dept', ['spaceId', 'department']),
});
