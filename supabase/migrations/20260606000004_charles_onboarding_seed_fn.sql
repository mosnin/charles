-- ============================================================================
-- Charles Phase 1 — Onboarding seed function
-- ============================================================================
--
-- Defines seed_charles_workspace(space_id TEXT) — a SECURITY DEFINER function
-- callable from the onboarding API (service role) to bootstrap all default
-- rows for a new Charles workspace in a single RPC call.
--
-- What it inserts (all ON CONFLICT DO NOTHING — fully idempotent):
--   1. Mission        — empty row, stage='idea'
--   2. WorkspaceStage — initial 'idea' entry (guarded by IF NOT EXISTS check)
--   3. CoreMemory     — 10 named slots with NULL values (except current_stage)
--   4. Department     — 6 departments with default autonomy levels
--   5. StageGate      — 3 exit-criteria rows for the 'idea' stage
--
-- Safe to call multiple times on the same space_id.
-- ============================================================================

CREATE OR REPLACE FUNCTION seed_charles_workspace(space_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN

  -- ── 1. Mission ──────────────────────────────────────────────────────────────
  INSERT INTO "Mission" ("spaceId", "title", "stage")
  VALUES (space_id, '', 'idea')
  ON CONFLICT ("spaceId") DO NOTHING;

  -- ── 2. WorkspaceStage ───────────────────────────────────────────────────────
  -- No unique constraint on this table; use an existence check so the function
  -- is idempotent without requiring a constraint.
  IF NOT EXISTS (
    SELECT 1 FROM "WorkspaceStage" WHERE "spaceId" = space_id
  ) THEN
    INSERT INTO "WorkspaceStage" ("spaceId", "stage")
    VALUES (space_id, 'idea');
  END IF;

  -- ── 3. CoreMemory slots ─────────────────────────────────────────────────────
  INSERT INTO "CoreMemory" ("spaceId", "slot", "value")
  VALUES
    (space_id, 'company_name',        NULL),
    (space_id, 'tagline',             NULL),
    (space_id, 'product_description', NULL),
    (space_id, 'one_line_pitch',      NULL),
    (space_id, 'target_customer',     NULL),
    (space_id, 'current_stage',       'idea'),
    (space_id, 'github_repo',         NULL),
    (space_id, 'primary_domain',      NULL),
    (space_id, 'key_constraints',     NULL),
    (space_id, 'founder_name',        NULL)
  ON CONFLICT ("spaceId", "slot") DO NOTHING;

  -- ── 4. Departments ──────────────────────────────────────────────────────────
  INSERT INTO "Department" ("spaceId", "slug", "name", "autonomyLevel")
  VALUES
    (space_id, 'engineering', 'Engineering', 'ask'),
    (space_id, 'sales',       'Sales',       'ask'),
    (space_id, 'marketing',   'Marketing',   'ask'),
    (space_id, 'design',      'Design',      'auto-low'),
    (space_id, 'support',     'Support',     'auto-low'),
    (space_id, 'ops_finance', 'Ops/Finance', 'ask')
  ON CONFLICT ("spaceId", "slug") DO NOTHING;

  -- ── 5. StageGates for 'idea' stage ─────────────────────────────────────────
  -- StageGate has no unique constraint; guard with an existence check so the
  -- function is idempotent.
  IF NOT EXISTS (
    SELECT 1 FROM "StageGate" WHERE "spaceId" = space_id AND "stage" = 'idea'
  ) THEN
    INSERT INTO "StageGate" ("spaceId", "stage", "title", "order")
    VALUES
      (space_id, 'idea', 'Define your company in one sentence', 0),
      (space_id, 'idea', 'Identify your target customer',       1),
      (space_id, 'idea', 'Connect GitHub',                      2);
  END IF;

END;
$$;

-- Charles Phase 1
