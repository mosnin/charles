-- ============================================================================
-- Charles Phase 5 — CostEvent (append-only cost ledger)
-- ============================================================================
--
-- One row per LLM call (or tool invocation that has a model cost). The row
-- carries the bytes, the dollars, the dept, the model, and the time. We
-- never edit a row — history survives, even after the SwarmRun it came
-- from is deleted. That's why runId is a plain text column, not a FK.
--
-- The TS helper at lib/observability/cost-events.ts writes here. The
-- /s/[slug]/settings/usage page reads it via rollup_cost_by_day().
-- Idempotent: IF NOT EXISTS throughout.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "CostEvent" (
  "id"            text          PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"       text          NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "department"    text          CHECK (
                                  "department" IS NULL OR "department" IN (
                                    'engineering', 'sales', 'marketing', 'design',
                                    'support', 'ops_finance', 'manager', 'in_process'
                                  )
                                ),
  "model"         text          NOT NULL,
  "inputTokens"   integer       NOT NULL DEFAULT 0,
  "outputTokens"  integer       NOT NULL DEFAULT 0,
  "costUsd"       numeric(12,6) NOT NULL DEFAULT 0,
  "runId"         text,
  "toolName"      text,
  "createdAt"     timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "CostEvent_space_createdAt_idx"
  ON "CostEvent" ("spaceId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "CostEvent_space_dept_createdAt_idx"
  ON "CostEvent" ("spaceId", "department", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "CostEvent_space_model_createdAt_idx"
  ON "CostEvent" ("spaceId", "model", "createdAt" DESC);

-- ── Row-Level Security ────────────────────────────────────────────────────────
-- App uses SUPABASE_SERVICE_ROLE_KEY (bypasses RLS). Policies guard the
-- direct PostgREST / anon-role path. Pattern matches other Charles tables.

ALTER TABLE "CostEvent" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cost_event: space owner can read"
  ON "CostEvent"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "Space" s
      WHERE s.id = "CostEvent"."spaceId"
        AND s."ownerId" = current_user_internal_id()
    )
  );

-- ── Rollup function ───────────────────────────────────────────────────────────
-- Daily totals grouped by (day, department, model). The dashboard does its
-- own per-department / per-model / per-day sums on this dataset — keeping
-- the SQL one-shaped lets us shed three round-trips.

CREATE OR REPLACE FUNCTION rollup_cost_by_day(
  p_space_id text,
  p_days     int DEFAULT 30
)
RETURNS TABLE (
  day           date,
  department    text,
  model         text,
  total_input   bigint,
  total_output  bigint,
  total_cost    numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    (date_trunc('day', "createdAt") AT TIME ZONE 'UTC')::date AS day,
    COALESCE("department", 'in_process')                       AS department,
    "model"                                                    AS model,
    SUM("inputTokens")::bigint                                 AS total_input,
    SUM("outputTokens")::bigint                                AS total_output,
    SUM("costUsd")::numeric                                    AS total_cost
  FROM "CostEvent"
  WHERE "spaceId" = p_space_id
    AND "createdAt" >= now() - (p_days || ' days')::interval
  GROUP BY 1, 2, 3
  ORDER BY day DESC, total_cost DESC;
$$;

-- Charles Phase 5
