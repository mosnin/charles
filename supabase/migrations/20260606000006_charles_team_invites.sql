-- ============================================================================
-- Charles Phase 5 — TeamInvite
-- ============================================================================
--
-- Adds the TeamInvite table for multi-seat: founder invites a teammate by
-- email, we mint a token, email goes out, teammate clicks, we insert a
-- TeamMembership row and mark the invite accepted.
--
-- Append-only. Idempotent (IF NOT EXISTS guards throughout). The existing
-- TeamMembership.role column already exists from 20260606000003 — the
-- ADD COLUMN IF NOT EXISTS below is belt-and-suspenders for environments
-- where the prior migration ran before the role column was finalized.
-- ============================================================================

-- ── TeamMembership.role — belt-and-suspenders ─────────────────────────────────
-- The expand-contract migration (20260606000003) already declares this column.
-- This is a no-op there; it exists only to harden against environments where
-- an older shape of TeamMembership slipped in before role was added.

ALTER TABLE "TeamMembership"
  ADD COLUMN IF NOT EXISTS "role" text NOT NULL DEFAULT 'member';

-- The CHECK constraint may already exist on the column; we don't try to
-- re-add it here (Postgres has no IF NOT EXISTS for constraints prior to
-- v17). The original migration declared it; leave it alone.

-- ── TeamInvite ────────────────────────────────────────────────────────────────
-- One row per pending or historical invite. Token is the URL-safe secret
-- the teammate clicks. acceptedAt flips when they sign in and accept.

CREATE TABLE IF NOT EXISTS "TeamInvite" (
  "id"          text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "teamId"      text        NOT NULL REFERENCES "Team"(id) ON DELETE CASCADE,
  "email"       text        NOT NULL,
  "role"        text        NOT NULL CHECK ("role" IN ('admin', 'member')),
  "token"       text        NOT NULL UNIQUE,
  "invitedById" text        NOT NULL,
  "expiresAt"   timestamptz NOT NULL,
  "acceptedAt"  timestamptz,
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "TeamInvite_token_idx"
  ON "TeamInvite" ("token");

CREATE INDEX IF NOT EXISTS "TeamInvite_teamId_idx"
  ON "TeamInvite" ("teamId");

-- One pending invite per (team, email). Once acceptedAt is set, the row
-- drops out of this partial index so a new invite can be issued if the
-- person leaves and is re-invited later.
CREATE UNIQUE INDEX IF NOT EXISTS "TeamInvite_team_email_pending_uq"
  ON "TeamInvite" ("teamId", "email")
  WHERE "acceptedAt" IS NULL;

-- ── Row-Level Security ────────────────────────────────────────────────────────
-- App uses SUPABASE_SERVICE_ROLE_KEY (bypasses RLS). Policies guard against
-- direct PostgREST / anon-role access. Pattern matches 20260606000003.

ALTER TABLE "TeamInvite" ENABLE ROW LEVEL SECURITY;

-- Read: any member of the team may see pending invites for the team.
CREATE POLICY "team_invite: members of team can read"
  ON "TeamInvite"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM "TeamMembership" tm
      WHERE tm."teamId" = "TeamInvite"."teamId"
        AND tm."userId" = current_user_internal_id()
    )
  );

-- Write (insert/update/delete): only owner/admin of the team.
CREATE POLICY "team_invite: admin or owner can write"
  ON "TeamInvite"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM "TeamMembership" tm
      WHERE tm."teamId" = "TeamInvite"."teamId"
        AND tm."userId" = current_user_internal_id()
        AND tm."role" IN ('owner', 'admin')
    )
  );

-- Charles Phase 5
