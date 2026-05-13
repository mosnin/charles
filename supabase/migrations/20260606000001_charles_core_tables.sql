-- ============================================================================
-- Charles Phase 1 — Core tables
-- ============================================================================
--
-- Creates the foundational tables for the Charles AI cofounder platform:
--
--   Mission          — one-per-space company mission record
--   CoreMemory       — named memory slots injected verbatim into agent prompts
--   WorkspaceStage   — history of stage transitions
--   StageGate        — exit-criteria checklist rows per stage
--   StageArtifact    — artifacts produced at each stage
--   Department       — one row per department per space, links to a CustomAgent
--
-- Also extends:
--   CustomAgent      — adds kind, department, autonomyLevel, toolkits columns
--   ExecutionStep    — adds scratchpad (working memory per step)
--
-- Idempotent: IF NOT EXISTS / ADD COLUMN IF NOT EXISTS guards throughout.
-- Safe to re-run.
-- ============================================================================

-- ── Mission ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Mission" (
  "id"             text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"        text        NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "title"          text        NOT NULL DEFAULT '',
  "description"    text,
  "oneLinePitch"   text,
  "targetCustomer" text,
  "stage"          text        NOT NULL DEFAULT 'idea'
    CHECK ("stage" IN ('idea', 'initial', 'identity', 'building', 'selling', 'scaling')),
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("spaceId")
);

CREATE INDEX IF NOT EXISTS "idx_Mission_spaceId"
  ON "Mission" ("spaceId");

-- ── CoreMemory ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "CoreMemory" (
  "id"        text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"   text        NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "slot"      text        NOT NULL,
  "value"     text,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("spaceId", "slot")
);

CREATE INDEX IF NOT EXISTS "idx_CoreMemory_spaceId"
  ON "CoreMemory" ("spaceId");

-- ── WorkspaceStage ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "WorkspaceStage" (
  "id"        text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"   text        NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "stage"     text        NOT NULL,
  "enteredAt" timestamptz NOT NULL DEFAULT now(),
  "exitedAt"  timestamptz,
  "exitedBy"  text        CHECK ("exitedBy" IN ('agent', 'founder', 'gate'))
);

CREATE INDEX IF NOT EXISTS "idx_WorkspaceStage_spaceId"
  ON "WorkspaceStage" ("spaceId");

-- ── StageGate ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "StageGate" (
  "id"          text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"     text        NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "stage"       text        NOT NULL,
  "title"       text        NOT NULL,
  "isComplete"  boolean     NOT NULL DEFAULT false,
  "completedAt" timestamptz,
  "order"       integer     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "StageGate_spaceId_idx"
  ON "StageGate" ("spaceId");

-- ── StageArtifact ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "StageArtifact" (
  "id"        text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"   text        NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "stage"     text        NOT NULL,
  "kind"      text        NOT NULL
    CHECK ("kind" IN ('document', 'url', 'repo', 'design', 'other')),
  "title"     text        NOT NULL,
  "value"     text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "StageArtifact_spaceId_idx"
  ON "StageArtifact" ("spaceId");

-- ── Department ────────────────────────────────────────────────────────────────
-- customAgentId FK added after CustomAgent extension below.

CREATE TABLE IF NOT EXISTS "Department" (
  "id"             text    PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"        text    NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "slug"           text    NOT NULL
    CHECK ("slug" IN ('engineering', 'sales', 'marketing', 'design', 'support', 'ops_finance')),
  "name"           text    NOT NULL,
  "autonomyLevel"  text    NOT NULL DEFAULT 'ask'
    CHECK ("autonomyLevel" IN ('observe', 'ask', 'auto-low', 'autonomous')),
  "customAgentId"  text,
  "isActive"       boolean NOT NULL DEFAULT true,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("spaceId", "slug")
);

CREATE INDEX IF NOT EXISTS "idx_Department_spaceId"
  ON "Department" ("spaceId");

-- ── Extend CustomAgent ────────────────────────────────────────────────────────
-- CustomAgent was created in 20260603000001_swarm_tables.sql.
-- We add four columns; CHECK constraints are only applied when the column is
-- new (ADD COLUMN IF NOT EXISTS skips silently if the column already exists,
-- so this is safe to re-run).

ALTER TABLE "CustomAgent"
  ADD COLUMN IF NOT EXISTS "kind"          text    NOT NULL DEFAULT 'custom'
    CHECK ("kind" IN ('department', 'custom')),
  ADD COLUMN IF NOT EXISTS "department"    text,
  ADD COLUMN IF NOT EXISTS "autonomyLevel" text    NOT NULL DEFAULT 'ask'
    CHECK ("autonomyLevel" IN ('observe', 'ask', 'auto-low', 'autonomous')),
  ADD COLUMN IF NOT EXISTS "toolkits"      text[]  DEFAULT '{}';

-- ── Department → CustomAgent FK ───────────────────────────────────────────────
-- Added after both tables are fully defined.

ALTER TABLE "Department"
  ADD CONSTRAINT "Department_customAgentId_fkey"
  FOREIGN KEY ("customAgentId") REFERENCES "CustomAgent"(id) ON DELETE SET NULL
  NOT VALID;   -- NOT VALID avoids a full table scan on an empty table; validated on demand

-- ── Extend ExecutionStep ──────────────────────────────────────────────────────
-- ExecutionStep was created in 20260601000000_agent_task_tables.sql.

ALTER TABLE "ExecutionStep"
  ADD COLUMN IF NOT EXISTS "scratchpad" jsonb DEFAULT '{}';

-- ── Row-Level Security ────────────────────────────────────────────────────────
-- App uses SUPABASE_SERVICE_ROLE_KEY (bypasses RLS). Policies guard against
-- direct PostgREST / anon-role access. Pattern matches existing codebase
-- (see 20260314000000_rls_policies.sql and 20260603000001_swarm_tables.sql).

ALTER TABLE "Mission"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CoreMemory"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkspaceStage"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StageGate"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StageArtifact"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Department"       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mission: space owner only"
  ON "Mission"
  FOR ALL
  USING (
    "spaceId" IN (
      SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()
    )
  );

CREATE POLICY "core_memory: space owner only"
  ON "CoreMemory"
  FOR ALL
  USING (
    "spaceId" IN (
      SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()
    )
  );

CREATE POLICY "workspace_stage: space owner only"
  ON "WorkspaceStage"
  FOR ALL
  USING (
    "spaceId" IN (
      SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()
    )
  );

CREATE POLICY "stage_gate: space owner only"
  ON "StageGate"
  FOR ALL
  USING (
    "spaceId" IN (
      SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()
    )
  );

CREATE POLICY "stage_artifact: space owner only"
  ON "StageArtifact"
  FOR ALL
  USING (
    "spaceId" IN (
      SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()
    )
  );

CREATE POLICY "department: space owner only"
  ON "Department"
  FOR ALL
  USING (
    "spaceId" IN (
      SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()
    )
  );

-- Charles Phase 1
