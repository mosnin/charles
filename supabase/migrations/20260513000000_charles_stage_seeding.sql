-- ============================================================================
-- Charles Phase 3 — Stage gate seeding (server-side fallback)
-- ============================================================================
--
-- Lazy seeding lives in the manager agent (agent/manager/charles.py), but we
-- also want a server-side path the API can call so gate seeding isn't
-- JS-only. seed_stage_gates(p_space_id, p_stage) inserts the canonical gate
-- rows for a single stage, idempotently.
--
-- Gate titles MUST match lib/stages/catalog.ts and agent/stages/__init__.py.
-- Drift means the lazy-seed path and the SQL fallback create different rows.
-- ============================================================================

CREATE OR REPLACE FUNCTION seed_stage_gates(p_space_id text, p_stage text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN

  -- Idempotency guard — no-op if any gates already exist for this (space, stage).
  IF EXISTS (
    SELECT 1 FROM "StageGate"
    WHERE "spaceId" = p_space_id AND "stage" = p_stage
  ) THEN
    RETURN;
  END IF;

  CASE p_stage

    WHEN 'idea' THEN
      INSERT INTO "StageGate" ("spaceId", "stage", "title", "order")
      VALUES
        (p_space_id, 'idea', 'Define your company in one sentence', 0),
        (p_space_id, 'idea', 'Identify your target customer',       1),
        (p_space_id, 'idea', 'Connect GitHub',                      2);

    WHEN 'initial' THEN
      INSERT INTO "StageGate" ("spaceId", "stage", "title", "order")
      VALUES
        (p_space_id, 'initial', 'Claim a domain or repo',           0),
        (p_space_id, 'initial', 'Capture the brand voice',          1),
        (p_space_id, 'initial', 'Ship a first product surface',     2);

    WHEN 'identity' THEN
      INSERT INTO "StageGate" ("spaceId", "stage", "title", "order")
      VALUES
        (p_space_id, 'identity', 'Approve the logo and wordmark',   0),
        (p_space_id, 'identity', 'Publish the landing page',        1),
        (p_space_id, 'identity', 'Review the core copy',            2),
        (p_space_id, 'identity', 'Claim the social handles',        3);

    WHEN 'building' THEN
      INSERT INTO "StageGate" ("spaceId", "stage", "title", "order")
      VALUES
        (p_space_id, 'building', 'Define the feature roadmap',      0),
        (p_space_id, 'building', 'Deploy to production',            1),
        (p_space_id, 'building', 'Run a real founder onboarding',   2);

    WHEN 'selling' THEN
      INSERT INTO "StageGate" ("spaceId", "stage", "title", "order")
      VALUES
        (p_space_id, 'selling', 'Turn Stripe live',                 0),
        (p_space_id, 'selling', 'Publish the pricing page',         1),
        (p_space_id, 'selling', 'Test the sales pitch',             2),
        (p_space_id, 'selling', 'Land the first paying customer',   3);

    WHEN 'scaling' THEN
      INSERT INTO "StageGate" ("spaceId", "stage", "title", "order")
      VALUES
        (p_space_id, 'scaling', 'Run a support flow',               0),
        (p_space_id, 'scaling', 'Wire the ops dashboard',           1),
        (p_space_id, 'scaling', 'Track runway weekly',              2);

    ELSE
      -- Unknown stage — no-op rather than raise, so callers stay simple.
      RETURN;

  END CASE;

END;
$$;

-- Charles Phase 3
