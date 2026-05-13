-- ============================================================================
-- Charles Phase 1 — Custom Agent subagents + trigger config
-- ============================================================================
--
-- The Custom Agent Workflow Builder (the 5th cofounder.co reference screen)
-- lets a founder pick a trigger, name a task agent, and add subagents that
-- each carry their own role, instructions, and tool selection.
--
-- We extend the existing CustomAgent table (created in
-- 20260603000001_swarm_tables.sql, extended in 20260606000001_charles_core_tables.sql)
-- with two new columns:
--
--   triggerType        — what kicks the agent off ('manual','schedule','webhook','event')
--   customInstructions — long-form steering text shown on the left pane of the builder
--
-- A new child table, AgentSubAgent, holds the per-subagent rows. The parent
-- CustomAgent is the "main agent" node in the graph; subagents are the row
-- of nodes hanging off it. ON DELETE CASCADE drops them with the parent.
--
-- RLS reuses the CustomAgent space-ownership pattern via EXISTS so we don't
-- have to denormalize spaceId onto every subagent row.
-- ============================================================================

-- ── Extend CustomAgent ──────────────────────────────────────────────────────

ALTER TABLE "CustomAgent"
  ADD COLUMN IF NOT EXISTS "triggerType"        text DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "customInstructions" text DEFAULT '';

-- CHECK can only be added once. Wrap in a DO block so re-runs are no-ops.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CustomAgent_triggerType_check'
  ) THEN
    ALTER TABLE "CustomAgent"
      ADD CONSTRAINT "CustomAgent_triggerType_check"
      CHECK ("triggerType" IN ('manual','schedule','webhook','event'));
  END IF;
END $$;

-- ── AgentSubAgent ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "AgentSubAgent" (
  "id"             text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "customAgentId"  text        NOT NULL REFERENCES "CustomAgent"(id) ON DELETE CASCADE,
  "name"           text        NOT NULL,
  "role"           text        NOT NULL DEFAULT 'execution',
  "instructions"   text        NOT NULL DEFAULT '',
  "tools"          text[]      NOT NULL DEFAULT '{}',
  "order"          int         NOT NULL DEFAULT 0,
  "createdAt"      timestamptz NOT NULL DEFAULT now()
);

-- Primary access pattern: list subagents for an agent in order.
CREATE INDEX IF NOT EXISTS "idx_AgentSubAgent_customAgentId_order"
  ON "AgentSubAgent" ("customAgentId", "order");

-- ── Row-Level Security ──────────────────────────────────────────────────────
-- App uses the service-role key (bypasses RLS); policy is belt-and-suspenders
-- against direct anon-role access. Resolves ownership by joining through the
-- parent CustomAgent to its Space.

ALTER TABLE "AgentSubAgent" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'AgentSubAgent'
      AND policyname = 'agent_subagent: via custom agent space owner'
  ) THEN
    CREATE POLICY "agent_subagent: via custom agent space owner"
      ON "AgentSubAgent"
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM "CustomAgent" a
          WHERE a.id = "AgentSubAgent"."customAgentId"
            AND a."spaceId" IN (
              SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()
            )
        )
      );
  END IF;
END $$;
