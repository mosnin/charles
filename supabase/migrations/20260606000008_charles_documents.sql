-- ============================================================================
-- Charles Phase 1 — Workspace documents
-- ============================================================================
--
-- The founder writes nine documents that describe the company: the executive
-- summary, the business plan, the brand kit, the pitch deck, the business
-- model canvas, the growth blueprint, the product PRD, the sales plan, and
-- the marketing plan. Each is a markdown source. The catalogue is fixed —
-- enforced by a CHECK constraint on slug — so the UI can join against a
-- TypeScript catalog and always render nine cards even if a row hasn't been
-- created yet.
--
-- seed_workspace_documents(p_space_id text) inserts an empty row per slug,
-- idempotently. Called from /api/onboarding/complete after the workspace is
-- created so a fresh space lands with all nine document shells in place.
-- ============================================================================

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Document" (
  "id"        text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"   text        NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "slug"      text        NOT NULL
    CHECK ("slug" IN (
      'executive-summary',
      'business-plan',
      'brand-kit',
      'pitch-deck',
      'business-model-canvas',
      'growth-blueprint',
      'product-prd',
      'sales-plan',
      'marketing-plan'
    )),
  "title"     text        NOT NULL,
  "content"   text        NOT NULL DEFAULT '',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("spaceId", "slug")
);

CREATE INDEX IF NOT EXISTS "idx_Document_spaceId"
  ON "Document" ("spaceId");

-- ── Row-Level Security ────────────────────────────────────────────────────────
-- App uses SUPABASE_SERVICE_ROLE_KEY (bypasses RLS). Policy guards against
-- direct PostgREST / anon-role access — same pattern as the other Charles
-- tables in 20260606000001_charles_core_tables.sql.

ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "document: space owner only"
  ON "Document"
  FOR ALL
  USING (
    "spaceId" IN (
      SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()
    )
  );

-- ── Seed function ─────────────────────────────────────────────────────────────
-- Inserts the nine canonical document rows for a space. Uses WHERE NOT EXISTS
-- per row so the function is idempotent without depending on the UNIQUE
-- constraint behaviour during partial seeding.

CREATE OR REPLACE FUNCTION seed_workspace_documents(p_space_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN

  INSERT INTO "Document" ("spaceId", "slug", "title")
  SELECT p_space_id, 'executive-summary', 'Executive summary'
  WHERE NOT EXISTS (
    SELECT 1 FROM "Document" WHERE "spaceId" = p_space_id AND "slug" = 'executive-summary'
  );

  INSERT INTO "Document" ("spaceId", "slug", "title")
  SELECT p_space_id, 'business-plan', 'Business plan'
  WHERE NOT EXISTS (
    SELECT 1 FROM "Document" WHERE "spaceId" = p_space_id AND "slug" = 'business-plan'
  );

  INSERT INTO "Document" ("spaceId", "slug", "title")
  SELECT p_space_id, 'brand-kit', 'Brand kit'
  WHERE NOT EXISTS (
    SELECT 1 FROM "Document" WHERE "spaceId" = p_space_id AND "slug" = 'brand-kit'
  );

  INSERT INTO "Document" ("spaceId", "slug", "title")
  SELECT p_space_id, 'pitch-deck', 'Pitch deck'
  WHERE NOT EXISTS (
    SELECT 1 FROM "Document" WHERE "spaceId" = p_space_id AND "slug" = 'pitch-deck'
  );

  INSERT INTO "Document" ("spaceId", "slug", "title")
  SELECT p_space_id, 'business-model-canvas', 'Business model canvas'
  WHERE NOT EXISTS (
    SELECT 1 FROM "Document" WHERE "spaceId" = p_space_id AND "slug" = 'business-model-canvas'
  );

  INSERT INTO "Document" ("spaceId", "slug", "title")
  SELECT p_space_id, 'growth-blueprint', 'Growth blueprint'
  WHERE NOT EXISTS (
    SELECT 1 FROM "Document" WHERE "spaceId" = p_space_id AND "slug" = 'growth-blueprint'
  );

  INSERT INTO "Document" ("spaceId", "slug", "title")
  SELECT p_space_id, 'product-prd', 'Product PRD'
  WHERE NOT EXISTS (
    SELECT 1 FROM "Document" WHERE "spaceId" = p_space_id AND "slug" = 'product-prd'
  );

  INSERT INTO "Document" ("spaceId", "slug", "title")
  SELECT p_space_id, 'sales-plan', 'Sales plan'
  WHERE NOT EXISTS (
    SELECT 1 FROM "Document" WHERE "spaceId" = p_space_id AND "slug" = 'sales-plan'
  );

  INSERT INTO "Document" ("spaceId", "slug", "title")
  SELECT p_space_id, 'marketing-plan', 'Marketing plan'
  WHERE NOT EXISTS (
    SELECT 1 FROM "Document" WHERE "spaceId" = p_space_id AND "slug" = 'marketing-plan'
  );

END;
$$;

-- Charles Phase 1
