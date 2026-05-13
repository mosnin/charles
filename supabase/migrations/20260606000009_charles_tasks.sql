-- ============================================================================
-- Charles Phase 1 — Tasks
-- ============================================================================
--
-- A shared to-do surface. Both the founder and the manager (or any department
-- agent, later) can spawn rows, assign them, and complete them. One table,
-- one truth, owner-scoped.
--
-- assigneeKind splits the row into who is on the hook:
--   founder    — the founder owns this; shows under "You" on the page
--   agent      — a department agent owns it; assigneeDept names which one
--   unassigned — nobody owns it yet
--
-- createdBy follows the same logic for provenance: 'founder' or 'agent'.
-- createdByDept can be one of the six dept slugs OR 'manager' (Charles himself).
-- We deliberately allow 'manager' because the manager agent calls
-- create_task during a chat turn — it isn't a department, but it created
-- the row, and we want that traceable.
--
-- RLS mirrors the StageGate / Document pattern: app uses the service role
-- key (bypasses RLS); the policy is a belt-and-suspenders guard against any
-- direct anon-role access.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "Task" (
  "id"             text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"        text        NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "title"          text        NOT NULL,
  "description"    text        NOT NULL DEFAULT '',
  "status"         text        NOT NULL DEFAULT 'open'
    CHECK ("status" IN ('open', 'in_progress', 'done', 'cancelled')),
  "priority"       text        NOT NULL DEFAULT 'normal'
    CHECK ("priority" IN ('low', 'normal', 'high')),
  "assigneeKind"   text        NOT NULL DEFAULT 'founder'
    CHECK ("assigneeKind" IN ('founder', 'agent', 'unassigned')),
  "assigneeDept"   text
    CHECK (
      "assigneeDept" IS NULL OR
      "assigneeDept" IN ('engineering', 'sales', 'marketing', 'design', 'support', 'ops_finance')
    ),
  "createdBy"      text        NOT NULL DEFAULT 'founder'
    CHECK ("createdBy" IN ('founder', 'agent')),
  "createdByDept"  text
    CHECK (
      "createdByDept" IS NULL OR
      "createdByDept" IN ('engineering', 'sales', 'marketing', 'design', 'support', 'ops_finance', 'manager')
    ),
  "dueAt"          timestamptz,
  "completedAt"    timestamptz,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now()
);

-- Main list view: open + in_progress first, newest first within each.
CREATE INDEX IF NOT EXISTS "idx_Task_spaceId_status_createdAt"
  ON "Task" ("spaceId", "status", "createdAt" DESC);

-- Filter index: who is this assigned to.
CREATE INDEX IF NOT EXISTS "idx_Task_spaceId_assignee"
  ON "Task" ("spaceId", "assigneeKind", "assigneeDept");

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task: space owner only"
  ON "Task"
  FOR ALL
  USING (
    "spaceId" IN (
      SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()
    )
  );

-- Charles Phase 1
