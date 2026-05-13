-- ============================================================================
-- Charles — TaskMessage.convexMessageId
-- ============================================================================
--
-- Adds a deterministic dedupe key for the Convex -> Supabase audit-backfill
-- bridge. The previous heuristic (conversationId + role + content + 5s
-- window) collapses two identical founder messages sent in quick
-- succession. Replace it with a UNIQUE column carrying the Convex row's
-- _id: the server dual-write rolls the id back onto the Supabase row,
-- and the cron backfill becomes a plain "if convexMessageId not in
-- Supabase, insert" check.
--
-- Safe on existing rows: the column is nullable, every existing
-- TaskMessage gets NULL, and UNIQUE allows multiple NULLs in Postgres.
-- ============================================================================

ALTER TABLE "TaskMessage"
  ADD COLUMN IF NOT EXISTS "convexMessageId" text;

CREATE UNIQUE INDEX IF NOT EXISTS "TaskMessage_convexMessageId_key"
  ON "TaskMessage" ("convexMessageId");
