-- ============================================================================
-- Charles Phase 1 — Expand-contract: Person and PipelineObject
-- ============================================================================
--
-- Adds Person and PipelineObject alongside the existing Contact and Deal tables.
-- This is an expand-contract migration: old tables are NOT dropped here.
-- New application code writes to Person/PipelineObject; Contact/Deal remain
-- readable by any code that still references them. A future migration will
-- drop Contact/Deal once all code paths have been migrated.
--
-- Idempotent: IF NOT EXISTS guards throughout. Safe to re-run.
-- ============================================================================

-- ── Person ────────────────────────────────────────────────────────────────────
-- General-purpose contact entity replacing the realtor-specific Contact table.

CREATE TABLE IF NOT EXISTS "Person" (
  "id"        text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"   text        NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "firstName" text,
  "lastName"  text,
  "email"     text,
  "phone"     text,
  "kind"      text        NOT NULL DEFAULT 'lead'
    CHECK ("kind" IN ('lead', 'customer', 'investor', 'hire', 'partner')),
  "metadata"  jsonb       DEFAULT '{}',
  "notes"     text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_Person_spaceId"
  ON "Person" ("spaceId");

CREATE INDEX IF NOT EXISTS "idx_Person_kind"
  ON "Person" ("kind");

-- ── PipelineObject ────────────────────────────────────────────────────────────
-- General-purpose pipeline entity replacing the realtor-specific Deal table.

CREATE TABLE IF NOT EXISTS "PipelineObject" (
  "id"           text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"      text        NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "title"        text        NOT NULL,
  "stage"        text        NOT NULL DEFAULT 'new',
  "pipelineKind" text        NOT NULL DEFAULT 'sales'
    CHECK ("pipelineKind" IN ('sales', 'fundraising', 'hiring', 'partnership', 'custom')),
  "value"        numeric,
  "personId"     text        REFERENCES "Person"(id) ON DELETE SET NULL,
  "metadata"     jsonb       DEFAULT '{}',
  "createdAt"    timestamptz NOT NULL DEFAULT now(),
  "updatedAt"    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_PipelineObject_spaceId"
  ON "PipelineObject" ("spaceId");

CREATE INDEX IF NOT EXISTS "PipelineObject_personId_idx"
  ON "PipelineObject" ("personId")
  WHERE "personId" IS NOT NULL;

-- ── Row-Level Security ────────────────────────────────────────────────────────
-- App uses SUPABASE_SERVICE_ROLE_KEY (bypasses RLS). Policies guard against
-- direct PostgREST / anon-role access. Pattern matches existing codebase
-- (see 20260314000000_rls_policies.sql).

ALTER TABLE "Person"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PipelineObject" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "person: space owner only"
  ON "Person"
  FOR ALL
  USING (
    "spaceId" IN (
      SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()
    )
  );

CREATE POLICY "pipeline_object: space owner only"
  ON "PipelineObject"
  FOR ALL
  USING (
    "spaceId" IN (
      SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()
    )
  );

-- Charles Phase 1
