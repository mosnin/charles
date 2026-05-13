-- ============================================================================
-- Charles Phase 1 — Per-task / per-gate conversations
-- ============================================================================
--
-- One conversation per Task row OR per StageGate row. The founder lands on
-- /tasks/[id] or /stages/gates/[id] and sees a split view: content on the
-- left, this conversation on the right.
--
-- The CHECK ensures every row pins itself to exactly one of (taskId, gateId).
-- Partial UNIQUE indexes guarantee at most one conversation per task and one
-- per gate, while still allowing many gate-conversations alongside many
-- task-conversations inside the same space.
--
-- Owner-only RLS, same pattern as Task and Document. The app runs through the
-- service role so this is belt-and-suspenders against the anon path.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "TaskConversation" (
  "id"        text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"   text        NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "taskId"    text        REFERENCES "Task"(id)      ON DELETE CASCADE,
  "gateId"    text        REFERENCES "StageGate"(id) ON DELETE CASCADE,
  "subject"   text        NOT NULL DEFAULT '',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CHECK (
    ("taskId" IS NOT NULL AND "gateId" IS NULL) OR
    ("taskId" IS NULL     AND "gateId" IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS "idx_TaskConversation_space_task"
  ON "TaskConversation" ("spaceId", "taskId");

CREATE INDEX IF NOT EXISTS "idx_TaskConversation_space_gate"
  ON "TaskConversation" ("spaceId", "gateId");

-- One conversation per task / per gate, scoped to the workspace.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_TaskConversation_space_task"
  ON "TaskConversation" ("spaceId", "taskId")
  WHERE "taskId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_TaskConversation_space_gate"
  ON "TaskConversation" ("spaceId", "gateId")
  WHERE "gateId" IS NOT NULL;

ALTER TABLE "TaskConversation" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_conversation: space owner only"
  ON "TaskConversation"
  FOR ALL
  USING (
    "spaceId" IN (
      SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()
    )
  );

-- ── TaskMessage ──────────────────────────────────────────────────────────────
--
-- Append-only chat log inside a conversation. metadata carries the inline
-- chrome the UI needs to render (subagent chips, tool calls, etc.) without
-- bloating content.

CREATE TABLE IF NOT EXISTS "TaskMessage" (
  "id"             text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "conversationId" text        NOT NULL REFERENCES "TaskConversation"(id) ON DELETE CASCADE,
  "role"           text        NOT NULL
    CHECK ("role" IN ('user', 'assistant', 'system')),
  "content"        text        NOT NULL,
  "metadata"       jsonb,
  "createdAt"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_TaskMessage_conversation_createdAt"
  ON "TaskMessage" ("conversationId", "createdAt");

ALTER TABLE "TaskMessage" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_message: space owner only"
  ON "TaskMessage"
  FOR ALL
  USING (
    "conversationId" IN (
      SELECT id FROM "TaskConversation"
      WHERE "spaceId" IN (
        SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()
      )
    )
  );

-- Charles Phase 1
