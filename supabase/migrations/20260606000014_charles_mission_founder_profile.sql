-- ============================================================================
-- Charles — Mission founder-profile columns
-- ============================================================================
--
-- The new 10-screen onboarding flow captures three founder signals we did
-- not previously store: where they are with the idea, what role they play,
-- and how technical they are. These shape Charles' first-week plan and the
-- workspace template auto-pick.
--
-- Naming note: "stage" is already taken on Mission for the company stage
-- gate (idea/initial/identity/building/selling/scaling) with a CHECK
-- constraint. To avoid colliding with that existing semantics we land the
-- idea-stage signal as "ideaStage" and the founder role as "founderRole".
--
-- Safe on existing rows: all three columns are nullable, no CHECK
-- constraints (validation lives in the API), no backfill required.
-- ============================================================================

ALTER TABLE "Mission"
  ADD COLUMN IF NOT EXISTS "ideaStage" text;

ALTER TABLE "Mission"
  ADD COLUMN IF NOT EXISTS "founderRole" text;

ALTER TABLE "Mission"
  ADD COLUMN IF NOT EXISTS "technicalExperience" text;
