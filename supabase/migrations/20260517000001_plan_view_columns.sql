-- Plan View persistence — extends SwarmMember rows with the two
-- plan-specific fields the UI needs to render a step card:
--
--   * stepIndex     — links the SwarmMember row back to its position in
--                     SwarmRun.plan.steps[]. expectedOutcome and
--                     dependsOn live in the plan jsonb and are joined
--                     in the read layer; stepIndex is the key.
--   * verifierVerdict — what the LLM judge said about this step's
--                     actual output. {satisfied, reason,
--                     suggested_follow_up}. Null until verify runs;
--                     null forever for non-plan members (wave != 3).
--
-- SwarmRun already has a jsonb `plan` column for the structured Plan,
-- so no schema change there. SwarmRun gets two thin additions for the
-- overall verifier verdict surfaced at the top of the detail page:

ALTER TABLE "SwarmMember"
  ADD COLUMN IF NOT EXISTS "stepIndex" int,
  ADD COLUMN IF NOT EXISTS "verifierVerdict" jsonb;

ALTER TABLE "SwarmRun"
  ADD COLUMN IF NOT EXISTS "overallSatisfied" boolean,
  ADD COLUMN IF NOT EXISTS "verifierSummary" text;

-- Index for the Plan View's read path: load a run's members ordered
-- by stepIndex. Filters out non-plan members (stepIndex IS NULL).
CREATE INDEX IF NOT EXISTS SwarmMember_swarmRun_stepIndex_idx
  ON "SwarmMember"("swarmRunId", "stepIndex")
  WHERE "stepIndex" IS NOT NULL;
