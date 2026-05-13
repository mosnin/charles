-- ============================================================================
-- Charles Phase 1 — Expand-contract: Team and TeamMembership
-- ============================================================================
--
-- Adds Team and TeamMembership alongside the existing Brokerage and
-- BrokerageMembership tables. This is an expand-contract migration: Brokerage
-- tables are NOT dropped here. New code writes to Team/TeamMembership.
-- A future migration will drop Brokerage tables once all code paths migrate.
--
-- Idempotent: IF NOT EXISTS guards throughout. Safe to re-run.
-- ============================================================================

-- ── Team ──────────────────────────────────────────────────────────────────────
-- One team per space (the founder's startup team).

CREATE TABLE IF NOT EXISTS "Team" (
  "id"        text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"   text        NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "name"      text        NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("spaceId")
);

CREATE INDEX IF NOT EXISTS "Team_spaceId_idx"
  ON "Team" ("spaceId");

-- ── TeamMembership ────────────────────────────────────────────────────────────
-- One row per (team, user) pair.

CREATE TABLE IF NOT EXISTS "TeamMembership" (
  "id"       text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "teamId"   text        NOT NULL REFERENCES "Team"(id) ON DELETE CASCADE,
  "userId"   text        NOT NULL,
  "role"     text        NOT NULL DEFAULT 'member'
    CHECK ("role" IN ('owner', 'admin', 'member')),
  "joinedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("teamId", "userId")
);

CREATE INDEX IF NOT EXISTS "TeamMembership_teamId_idx"
  ON "TeamMembership" ("teamId");

CREATE INDEX IF NOT EXISTS "TeamMembership_userId_idx"
  ON "TeamMembership" ("userId");

-- ── Row-Level Security ────────────────────────────────────────────────────────
-- App uses SUPABASE_SERVICE_ROLE_KEY (bypasses RLS). Policies guard against
-- direct PostgREST / anon-role access. Pattern matches existing codebase
-- (see 20260314000000_rls_policies.sql and 20260603000001_swarm_tables.sql).

ALTER TABLE "Team"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeamMembership" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team: space owner only"
  ON "Team"
  FOR ALL
  USING (
    "spaceId" IN (
      SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()
    )
  );

-- TeamMembership has no direct spaceId column; resolve via Team.
CREATE POLICY "team_membership: via team space owner"
  ON "TeamMembership"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "Team" t
      WHERE t.id = "TeamMembership"."teamId"
        AND t."spaceId" IN (
          SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()
        )
    )
  );

-- Charles Phase 1
