-- ============================================================================
-- Charles Phase 1 — Library files
-- ============================================================================
--
-- The chat dock's fifth tab is "Library" — where the founder drops reference
-- material (docs, screenshots, brand assets) that agents will eventually pull
-- in as context. For now: storage + retrieval. One private bucket called
-- "library" (signed URLs only, 60s TTL). 25MB per file, 1GB per space.
--
-- The bucket itself is created by the app on first upload (same pattern as
-- the existing `branding` bucket in /api/upload). If your environment locks
-- down storage admin (managed Supabase with restricted service roles), see
-- docs/STORAGE.md for the manual bucket-create instructions.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "LibraryFile" (
  "id"          text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"     text        NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "uploaderId"  text        NOT NULL,
  "name"        text        NOT NULL,
  "mimeType"    text        NOT NULL,
  "sizeBytes"   int         NOT NULL,
  "storagePath" text        NOT NULL,
  "kind"        text        NOT NULL
    CHECK ("kind" IN ('document', 'image', 'audio', 'video', 'other'))
    DEFAULT 'other',
  "description" text        NOT NULL DEFAULT '',
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_LibraryFile_spaceId_createdAt"
  ON "LibraryFile" ("spaceId", "createdAt" DESC);

-- ── Row-Level Security ────────────────────────────────────────────────────────
-- App uses SUPABASE_SERVICE_ROLE_KEY (bypasses RLS). Policy guards against
-- direct PostgREST / anon-role access — owner-only via Space.ownerId, same
-- pattern as the other Charles tables.

ALTER TABLE "LibraryFile" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "library_file: space owner only"
  ON "LibraryFile"
  FOR ALL
  USING (
    "spaceId" IN (
      SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()
    )
  );
