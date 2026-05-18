-- ============================================================================
-- Charles baseline — single canonical fresh-install migration
-- ============================================================================
--
-- Replaces 102 fragmented migrations + three competing baselines
-- (schema.sql, setup.sql, combined_migration_v2.sql) with one ordered,
-- idempotent file. Running `npx supabase db push` against a fresh Supabase
-- project should produce a complete Charles schema in one shot.
--
-- Idempotent: every CREATE uses IF NOT EXISTS; every policy is wrapped in a
-- DO block that swallows duplicate_object so re-runs are no-ops.
--
-- Realtor tables (Tour, Brokerage, Contact, Deal, Property, Lead, etc.) are
-- deliberately absent. Their code consumers were torn out in the Chippi →
-- Charles cleanup phases 1-3. Any straggler TS files that still reference
-- them will fail at runtime — to be cleaned up in a follow-on phase.
--
-- Future migrations stack on top with timestamped filenames; do not edit
-- this file once it has been applied to any environment.
-- ============================================================================

-- ── Extensions ───────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- Core platform: User, Space, SpaceSetting, AuditLog
-- ============================================================================

CREATE TABLE IF NOT EXISTS "User" (
  id                      text PRIMARY KEY,
  "clerkId"               text UNIQUE NOT NULL,
  email                   text NOT NULL,
  name                    text,
  avatar                  text,
  bio                     text,
  "createdAt"             timestamptz NOT NULL DEFAULT now(),
  "onboardingCurrentStep" integer NOT NULL DEFAULT 0,
  "onboardingStartedAt"   timestamptz,
  "onboardingCompletedAt" timestamptz,
  onboard                 boolean NOT NULL DEFAULT false,
  "platformRole"          text NOT NULL DEFAULT 'user'
                            CHECK ("platformRole" IN ('user', 'admin', 'banned')),
  status                  text
);

CREATE INDEX IF NOT EXISTS idx_user_clerk_id ON "User"("clerkId");

CREATE TABLE IF NOT EXISTS "Space" (
  id                          text PRIMARY KEY,
  slug                        text UNIQUE NOT NULL,
  name                        text NOT NULL,
  emoji                       text NOT NULL DEFAULT '🚀',
  "createdAt"                 timestamptz NOT NULL DEFAULT now(),
  "ownerId"                   text UNIQUE NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "stripeCustomerId"          text,
  "stripeSubscriptionId"      text,
  "stripeSubscriptionStatus"  text NOT NULL DEFAULT 'inactive'
                                CHECK ("stripeSubscriptionStatus" IN (
                                  'active','trialing','past_due','canceled','unpaid','inactive'
                                )),
  "stripePeriodEnd"           timestamptz,
  "trialUsedAt"               timestamptz
);

CREATE INDEX IF NOT EXISTS idx_space_owner_id ON "Space"("ownerId");
CREATE INDEX IF NOT EXISTS idx_space_slug     ON "Space"(slug);

CREATE TABLE IF NOT EXISTS "SpaceSetting" (
  id                  text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"           text UNIQUE NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  notifications       boolean NOT NULL DEFAULT true,
  "smsNotifications"  boolean NOT NULL DEFAULT false,
  timezone            text NOT NULL DEFAULT 'America/New_York',
  "phoneNumber"       text,
  "myConnections"     text,
  "aiPersonalization" text,
  "billingSettings"   text,
  "anthropicApiKey"   text,
  "businessName"      text,
  bio                 text,
  "socialLinks"       jsonb DEFAULT '{}',
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_space_setting_sid ON "SpaceSetting"("spaceId");

CREATE TABLE IF NOT EXISTS "AuditLog" (
  id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "actorId"    text,
  "clerkId"    text,
  "ipAddress"  text,
  action       text NOT NULL,
  resource     text NOT NULL,
  "resourceId" text,
  "spaceId"    text,
  metadata     jsonb,
  "createdAt"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_actor_idx    ON "AuditLog"("actorId");
CREATE INDEX IF NOT EXISTS audit_log_resource_idx ON "AuditLog"("resource","resourceId");
CREATE INDEX IF NOT EXISTS audit_log_space_idx    ON "AuditLog"("spaceId");
CREATE INDEX IF NOT EXISTS audit_log_created_idx  ON "AuditLog"("createdAt" DESC);

-- ============================================================================
-- RLS helper: resolve Clerk-authenticated User.id
-- ============================================================================

CREATE OR REPLACE FUNCTION current_user_internal_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT id FROM "User" WHERE "clerkId" = auth.uid()::text LIMIT 1
$$;

-- ============================================================================
-- Mission, CoreMemory, WorkspaceStage, StageGate, StageArtifact, Department
-- ============================================================================

CREATE TABLE IF NOT EXISTS "Mission" (
  id                    text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"             text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  title                 text NOT NULL DEFAULT '',
  description           text,
  "oneLinePitch"        text,
  "targetCustomer"      text,
  stage                 text NOT NULL DEFAULT 'idea'
                          CHECK (stage IN ('idea','initial','identity','building','selling','scaling')),
  "ideaStage"           text,
  "founderRole"         text,
  "technicalExperience" text,
  "createdAt"           timestamptz NOT NULL DEFAULT now(),
  "updatedAt"           timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("spaceId")
);

CREATE INDEX IF NOT EXISTS idx_Mission_spaceId ON "Mission"("spaceId");

CREATE TABLE IF NOT EXISTS "CoreMemory" (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"   text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  slot        text NOT NULL,
  value       text,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("spaceId", slot)
);

CREATE INDEX IF NOT EXISTS idx_CoreMemory_spaceId ON "CoreMemory"("spaceId");

CREATE TABLE IF NOT EXISTS "WorkspaceStage" (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"   text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  stage       text NOT NULL,
  "enteredAt" timestamptz NOT NULL DEFAULT now(),
  "exitedAt"  timestamptz,
  "exitedBy"  text CHECK ("exitedBy" IN ('agent','founder','gate'))
);

CREATE INDEX IF NOT EXISTS idx_WorkspaceStage_spaceId ON "WorkspaceStage"("spaceId");

CREATE TABLE IF NOT EXISTS "StageGate" (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"     text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  stage         text NOT NULL,
  title         text NOT NULL,
  "isComplete"  boolean NOT NULL DEFAULT false,
  "completedAt" timestamptz,
  "order"       integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS StageGate_spaceId_idx ON "StageGate"("spaceId");

CREATE TABLE IF NOT EXISTS "StageArtifact" (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"   text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  stage       text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('document','url','repo','design','other')),
  title       text NOT NULL,
  value       text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS StageArtifact_spaceId_idx ON "StageArtifact"("spaceId");

CREATE TABLE IF NOT EXISTS "Department" (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"       text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  slug            text NOT NULL
                    CHECK (slug IN ('engineering','sales','marketing','design','support','ops_finance')),
  name            text NOT NULL,
  "autonomyLevel" text NOT NULL DEFAULT 'ask'
                    CHECK ("autonomyLevel" IN ('observe','ask','auto-low','autonomous')),
  "customAgentId" text,
  "isActive"      boolean NOT NULL DEFAULT true,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("spaceId", slug)
);

CREATE INDEX IF NOT EXISTS idx_Department_spaceId ON "Department"("spaceId");

-- ============================================================================
-- Person, PipelineObject (general-purpose replacements for Contact / Deal)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "Person" (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"   text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "firstName" text,
  "lastName"  text,
  email       text,
  phone       text,
  kind        text NOT NULL DEFAULT 'lead'
                CHECK (kind IN ('lead','customer','investor','hire','partner')),
  metadata    jsonb DEFAULT '{}',
  notes       text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_Person_spaceId ON "Person"("spaceId");
CREATE INDEX IF NOT EXISTS idx_Person_kind    ON "Person"(kind);

CREATE TABLE IF NOT EXISTS "PipelineObject" (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"      text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  title          text NOT NULL,
  stage          text NOT NULL DEFAULT 'new',
  "pipelineKind" text NOT NULL DEFAULT 'sales'
                   CHECK ("pipelineKind" IN ('sales','fundraising','hiring','partnership','custom')),
  value          numeric,
  "personId"     text REFERENCES "Person"(id) ON DELETE SET NULL,
  metadata       jsonb DEFAULT '{}',
  "createdAt"    timestamptz NOT NULL DEFAULT now(),
  "updatedAt"    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_PipelineObject_spaceId       ON "PipelineObject"("spaceId");
CREATE INDEX IF NOT EXISTS PipelineObject_personId_idx      ON "PipelineObject"("personId") WHERE "personId" IS NOT NULL;

-- ============================================================================
-- Team, TeamMembership, TeamInvite
-- ============================================================================

CREATE TABLE IF NOT EXISTS "Team" (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"   text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  name        text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("spaceId")
);

CREATE INDEX IF NOT EXISTS Team_spaceId_idx ON "Team"("spaceId");

CREATE TABLE IF NOT EXISTS "TeamMembership" (
  id         text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "teamId"   text NOT NULL REFERENCES "Team"(id) ON DELETE CASCADE,
  "userId"   text NOT NULL,
  role       text NOT NULL DEFAULT 'member'
               CHECK (role IN ('owner','admin','member')),
  "joinedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("teamId","userId")
);

CREATE INDEX IF NOT EXISTS TeamMembership_teamId_idx ON "TeamMembership"("teamId");
CREATE INDEX IF NOT EXISTS TeamMembership_userId_idx ON "TeamMembership"("userId");

CREATE TABLE IF NOT EXISTS "TeamInvite" (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "teamId"      text NOT NULL REFERENCES "Team"(id) ON DELETE CASCADE,
  email         text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin','member')),
  token         text NOT NULL UNIQUE,
  "invitedById" text NOT NULL,
  "expiresAt"   timestamptz NOT NULL,
  "acceptedAt"  timestamptz,
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS TeamInvite_token_idx  ON "TeamInvite"(token);
CREATE INDEX IF NOT EXISTS TeamInvite_teamId_idx ON "TeamInvite"("teamId");
CREATE UNIQUE INDEX IF NOT EXISTS TeamInvite_team_email_pending_uq
  ON "TeamInvite"("teamId", email)
  WHERE "acceptedAt" IS NULL;

-- ============================================================================
-- Document, LibraryFile, Note, CalendarEvent, CalendarNote
-- ============================================================================

CREATE TABLE IF NOT EXISTS "Document" (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"   text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  slug        text NOT NULL
                CHECK (slug IN (
                  'executive-summary','business-plan','brand-kit','pitch-deck',
                  'business-model-canvas','growth-blueprint','product-prd',
                  'sales-plan','marketing-plan'
                )),
  title       text NOT NULL,
  content     text NOT NULL DEFAULT '',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("spaceId", slug)
);

CREATE INDEX IF NOT EXISTS idx_Document_spaceId ON "Document"("spaceId");

CREATE TABLE IF NOT EXISTS "LibraryFile" (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"     text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "uploaderId"  text NOT NULL,
  name          text NOT NULL,
  "mimeType"    text NOT NULL,
  "sizeBytes"   int  NOT NULL,
  "storagePath" text NOT NULL,
  kind          text NOT NULL DEFAULT 'other'
                  CHECK (kind IN ('document','image','audio','video','other')),
  description   text NOT NULL DEFAULT '',
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_LibraryFile_spaceId_createdAt
  ON "LibraryFile"("spaceId","createdAt" DESC);

CREATE TABLE IF NOT EXISTS "Note" (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"   text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  title       text NOT NULL DEFAULT 'Untitled',
  content     text NOT NULL DEFAULT '',
  icon        text,
  "sortOrder" integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_note_space ON "Note"("spaceId","sortOrder");

CREATE TABLE IF NOT EXISTS "CalendarEvent" (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"   text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  date        date NOT NULL,
  time        text,
  color       text DEFAULT 'gray',
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_event_space ON "CalendarEvent"("spaceId", date);

CREATE TABLE IF NOT EXISTS "CalendarNote" (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"   text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  date        date NOT NULL,
  note        text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_note_space_date ON "CalendarNote"("spaceId", date);

-- ============================================================================
-- Conversation, Message, Attachment
-- ============================================================================

CREATE TABLE IF NOT EXISTS "Conversation" (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"   text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  title       text NOT NULL DEFAULT 'New conversation',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_space_updated
  ON "Conversation"("spaceId","updatedAt" DESC);

CREATE TABLE IF NOT EXISTS "Message" (
  id               text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"        text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "conversationId" text REFERENCES "Conversation"(id) ON DELETE CASCADE,
  role             text NOT NULL,
  content          text NOT NULL,
  "createdAt"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_conversation_created
  ON "Message"("conversationId","createdAt" ASC);
CREATE INDEX IF NOT EXISTS idx_message_space_id ON "Message"("spaceId");

CREATE TABLE IF NOT EXISTS "Attachment" (
  id                 text PRIMARY KEY,
  "spaceId"          text NOT NULL,
  "userId"           text,
  "conversationId"   text,
  filename           text NOT NULL,
  "mimeType"         text NOT NULL,
  "sizeBytes"        int  NOT NULL,
  "storagePath"      text NOT NULL,
  "publicUrl"        text NOT NULL,
  "extractedText"    text,
  "extractionStatus" text NOT NULL DEFAULT 'pending'
                       CHECK ("extractionStatus" IN ('pending','skipped','done','failed')),
  "createdAt"        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS Attachment_spaceId_createdAt_idx
  ON "Attachment"("spaceId","createdAt" DESC);
CREATE INDEX IF NOT EXISTS Attachment_conversationId_idx
  ON "Attachment"("conversationId") WHERE "conversationId" IS NOT NULL;

-- ============================================================================
-- Agent runtime: AgentSettings, AgentActivityLog, AgentDraft, AgentMemory
-- ============================================================================

CREATE TABLE IF NOT EXISTS "AgentSettings" (
  id                  text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"           text NOT NULL UNIQUE REFERENCES "Space"(id) ON DELETE CASCADE,
  enabled             boolean NOT NULL DEFAULT false,
  "dailyTokenBudget"  int     NOT NULL DEFAULT 50000,
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "AgentActivityLog" (
  id                 text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"          text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "runId"            text NOT NULL,
  "agentType"        text NOT NULL,
  "actionType"       text NOT NULL,
  reasoning          text,
  outcome            text NOT NULL
                       CHECK (outcome IN ('completed','queued_for_approval','suggested','failed')),
  reversible         boolean NOT NULL DEFAULT true,
  "reversedAt"       timestamptz,
  metadata           jsonb,
  "createdAt"        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS AgentActivityLog_spaceId_createdAt_idx
  ON "AgentActivityLog"("spaceId","createdAt" DESC);
CREATE INDEX IF NOT EXISTS AgentActivityLog_runId_idx
  ON "AgentActivityLog"("runId");

CREATE TABLE IF NOT EXISTS "AgentDraft" (
  id                   text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"            text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  channel              text NOT NULL CHECK (channel IN ('sms','email','note')),
  subject              text,
  content              text NOT NULL,
  reasoning            text,
  priority             int  NOT NULL DEFAULT 0,
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','approved','dismissed','sent')),
  "expiresAt"          timestamptz,
  "idempotencyKey"     text UNIQUE,
  confidence           int CHECK (confidence >= 0 AND confidence <= 100),
  outcome              text CHECK (outcome IN ('responded','no_response','bounced','unsubscribed','meeting_booked')),
  "outcomeDetectedAt"  timestamptz,
  "feedback_action"    text CHECK ("feedback_action" IN ('approved','edited_and_approved','rejected','held')),
  "edit_distance"      int  CHECK ("edit_distance" >= 0),
  "decision_ms"        int  CHECK ("decision_ms" >= 0),
  "outcome_signal"     text,
  "outcome_checked_at" timestamptz,
  "createdAt"          timestamptz NOT NULL DEFAULT now(),
  "updatedAt"          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS AgentDraft_spaceId_status_idx
  ON "AgentDraft"("spaceId", status, "createdAt" DESC);
CREATE INDEX IF NOT EXISTS AgentDraft_spaceId_feedback_action_idx
  ON "AgentDraft"("spaceId","feedback_action","createdAt" DESC)
  WHERE "feedback_action" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "AgentMemory" (
  id                     text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"              text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "entityType"           text CHECK ("entityType" IN ('contact','deal','space')),
  "entityId"             text,
  "memoryType"           text NOT NULL
                           CHECK ("memoryType" IN ('fact','preference','observation','reminder')),
  content                text NOT NULL,
  embedding              vector(1536),
  importance             float NOT NULL DEFAULT 0.5,
  "expiresAt"            timestamptz,
  "taskId"               text,
  "sourceRunId"          text,
  "sourceToolName"       text,
  "sourceConversationId" text,
  "createdAt"            timestamptz NOT NULL DEFAULT now(),
  "updatedAt"            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS AgentMemory_spaceId_entityId_idx
  ON "AgentMemory"("spaceId","entityId");
CREATE INDEX IF NOT EXISTS AgentMemory_embedding_idx
  ON "AgentMemory" USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS AgentMemory_taskId_idx
  ON "AgentMemory"("taskId") WHERE "taskId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS AgentMemory_spaceId_taskId_idx
  ON "AgentMemory"("spaceId","taskId") WHERE "taskId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS AgentMemory_sourceRunId_idx
  ON "AgentMemory"("sourceRunId") WHERE "sourceRunId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS AgentMemory_sourceToolName_idx
  ON "AgentMemory"("sourceToolName") WHERE "sourceToolName" IS NOT NULL;

-- ============================================================================
-- AgentGoal, AgentQuestion, AgentPausedRun
-- ============================================================================

CREATE TABLE IF NOT EXISTS "AgentGoal" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "spaceId"    text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "goalType"   varchar(50) NOT NULL
                 CHECK ("goalType" IN ('follow_up_sequence','tour_booking','offer_progress','deal_close','reengagement','custom')),
  description  text NOT NULL,
  instructions text,
  status       varchar(20) NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','completed','cancelled','paused')),
  priority     int NOT NULL DEFAULT 0,
  metadata     jsonb NOT NULL DEFAULT '{}',
  "completedAt" timestamptz,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS AgentGoal_spaceId_status_idx ON "AgentGoal"("spaceId", status);

CREATE TABLE IF NOT EXISTS "AgentQuestion" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "spaceId"   text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "runId"     varchar(100) NOT NULL,
  "agentType" varchar(50)  NOT NULL,
  question    text NOT NULL,
  context     text,
  status      varchar(20) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','answered','expired')),
  answer      text,
  "answeredAt" timestamptz,
  priority    int NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS AgentQuestion_spaceId_status_idx ON "AgentQuestion"("spaceId", status);

CREATE TABLE IF NOT EXISTS "AgentPausedRun" (
  id               text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"        text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "userId"         text NOT NULL,
  "conversationId" text,
  "runState"       text NOT NULL,
  approvals        jsonb NOT NULL DEFAULT '[]'::jsonb,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','resumed','cancelled','expired')),
  "expiresAt"      timestamptz,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS AgentPausedRun_spaceId_status_idx
  ON "AgentPausedRun"("spaceId", status, "createdAt" DESC);
CREATE INDEX IF NOT EXISTS AgentPausedRun_userId_idx
  ON "AgentPausedRun"("userId");

-- ============================================================================
-- AgentTask, ExecutionStep, TaskCheckpoint, GoalDecomposition, TaskDependency
-- ============================================================================

CREATE TABLE IF NOT EXISTS "AgentTask" (
  id                 text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"          text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  title              text NOT NULL,
  description        text,
  status             text NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued','running','paused','completed','failed','cancelled')),
  "triggerSource"    text NOT NULL DEFAULT 'manual',
  "goalDescription"  text,
  "parentTaskId"     text REFERENCES "AgentTask"(id) ON DELETE SET NULL,
  "totalSteps"       int NOT NULL DEFAULT 0,
  "completedSteps"   int NOT NULL DEFAULT 0,
  "inputTokens"      int NOT NULL DEFAULT 0,
  "outputTokens"     int NOT NULL DEFAULT 0,
  "estimatedCostUsd" numeric(10,6) NOT NULL DEFAULT 0,
  metadata           jsonb DEFAULT '{}',
  "startedAt"        timestamptz,
  "completedAt"      timestamptz,
  "cancelledAt"      timestamptz,
  "createdAt"        timestamptz NOT NULL DEFAULT now(),
  "updatedAt"        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS AgentTask_spaceId_status_idx ON "AgentTask"("spaceId", status);
CREATE INDEX IF NOT EXISTS AgentTask_parentTaskId_idx
  ON "AgentTask"("parentTaskId") WHERE "parentTaskId" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "ExecutionStep" (
  id               text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "taskId"         text NOT NULL REFERENCES "AgentTask"(id) ON DELETE CASCADE,
  "spaceId"        text NOT NULL,
  "stepIndex"      int NOT NULL DEFAULT 0,
  "toolName"       text NOT NULL,
  "toolArgs"       jsonb DEFAULT '{}',
  "toolResult"     jsonb,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','running','completed','failed','skipped')),
  "inputTokens"    int NOT NULL DEFAULT 0,
  "outputTokens"   int NOT NULL DEFAULT 0,
  "costUsd"        numeric(10,6) NOT NULL DEFAULT 0,
  "idempotencyKey" text UNIQUE,
  "errorMessage"   text,
  "stepType"       text NOT NULL DEFAULT 'tool_call',
  "inputSummary"   text,
  "outputSummary"  text,
  scratchpad       jsonb DEFAULT '{}',
  "startedAt"      timestamptz,
  "completedAt"    timestamptz,
  "createdAt"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ExecutionStep_taskId_stepIndex_idx
  ON "ExecutionStep"("taskId","stepIndex");
CREATE INDEX IF NOT EXISTS ExecutionStep_idempotencyKey_idx
  ON "ExecutionStep"("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "TaskCheckpoint" (
  id               text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "taskId"         text NOT NULL REFERENCES "AgentTask"(id) ON DELETE CASCADE,
  "spaceId"        text NOT NULL,
  "checkpointData" jsonb NOT NULL,
  "stepIndex"      int NOT NULL DEFAULT 0,
  "createdAt"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS TaskCheckpoint_taskId_idx ON "TaskCheckpoint"("taskId");

CREATE TABLE IF NOT EXISTS "GoalDecomposition" (
  id                 text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"          text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "taskId"           text REFERENCES "AgentTask"(id) ON DELETE CASCADE,
  "goalText"         text NOT NULL,
  "decomposedSteps"  jsonb NOT NULL DEFAULT '[]',
  "llmModel"         text NOT NULL DEFAULT 'gpt-4.1-mini',
  "promptTokens"     int NOT NULL DEFAULT 0,
  "completionTokens" int NOT NULL DEFAULT 0,
  "createdAt"        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS GoalDecomposition_spaceId_taskId_idx
  ON "GoalDecomposition"("spaceId","taskId");

CREATE TABLE IF NOT EXISTS "TaskDependency" (
  id                text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "taskId"          text NOT NULL REFERENCES "AgentTask"(id) ON DELETE CASCADE,
  "dependsOnTaskId" text NOT NULL REFERENCES "AgentTask"(id) ON DELETE CASCADE,
  "dependencyType"  text NOT NULL DEFAULT 'sequential'
                      CHECK ("dependencyType" IN ('sequential','data','soft')),
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("taskId","dependsOnTaskId"),
  CHECK ("taskId" <> "dependsOnTaskId")
);

CREATE INDEX IF NOT EXISTS TaskDependency_taskId_idx          ON "TaskDependency"("taskId");
CREATE INDEX IF NOT EXISTS TaskDependency_dependsOnTaskId_idx ON "TaskDependency"("dependsOnTaskId");

-- ============================================================================
-- Artifact, ArtifactVersion
-- ============================================================================

CREATE TABLE IF NOT EXISTS "Artifact" (
  id                 text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"          text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "taskId"           text REFERENCES "AgentTask"(id) ON DELETE SET NULL,
  "stepId"           text REFERENCES "ExecutionStep"(id) ON DELETE SET NULL,
  "artifactType"     text NOT NULL CHECK ("artifactType" IN (
                       'draft_email','draft_sms','deal_update','contact_update',
                       'tour_booking','goal_plan','report','raw_output')),
  title              text NOT NULL,
  "contentType"      text NOT NULL DEFAULT 'text/plain',
  status             text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','approved','rejected','superseded')),
  "currentVersionId" text,
  "createdAt"        timestamptz NOT NULL DEFAULT now(),
  "updatedAt"        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "ArtifactVersion" (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "artifactId"    text NOT NULL REFERENCES "Artifact"(id) ON DELETE CASCADE,
  "spaceId"       text NOT NULL,
  "versionNumber" int  NOT NULL DEFAULT 1,
  content         text NOT NULL,
  "contentHash"   text NOT NULL,
  metadata        jsonb DEFAULT '{}',
  "createdByAgent" text NOT NULL DEFAULT 'charles',
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);

-- Cross-table FK after both exist. Wrap so re-runs don't double-add.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Artifact_currentVersionId_fkey'
  ) THEN
    ALTER TABLE "Artifact"
      ADD CONSTRAINT "Artifact_currentVersionId_fkey"
      FOREIGN KEY ("currentVersionId") REFERENCES "ArtifactVersion"(id)
      ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS Artifact_spaceId_taskId_idx     ON "Artifact"("spaceId","taskId");
CREATE INDEX IF NOT EXISTS Artifact_spaceId_status_idx     ON "Artifact"("spaceId", status);
CREATE INDEX IF NOT EXISTS ArtifactVersion_artifactId_idx  ON "ArtifactVersion"("artifactId");

-- ============================================================================
-- DeadLetterEvent, DisabledSpace
-- ============================================================================

CREATE TABLE IF NOT EXISTS "DeadLetterEvent" (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"       text NOT NULL,
  "eventType"     text NOT NULL,
  "eventPayload"  jsonb NOT NULL DEFAULT '{}',
  "errorMessage"  text NOT NULL,
  "errorStack"    text,
  "attemptCount"  int NOT NULL DEFAULT 1,
  "firstFailedAt" timestamptz NOT NULL DEFAULT now(),
  "lastFailedAt"  timestamptz NOT NULL DEFAULT now(),
  "resolvedAt"    timestamptz,
  "resolvedBy"    text,
  "resolutionNote" text,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','retrying','resolved','abandoned')),
  "taskId"        text,
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS DeadLetterEvent_spaceId_status_idx
  ON "DeadLetterEvent"("spaceId", status);
CREATE INDEX IF NOT EXISTS DeadLetterEvent_eventType_idx
  ON "DeadLetterEvent"("eventType");

CREATE TABLE IF NOT EXISTS "DisabledSpace" (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"     text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  reason        text NOT NULL,
  "disabledBy"  text NOT NULL DEFAULT 'system',
  "disabledAt"  timestamptz NOT NULL DEFAULT now(),
  "reenabledAt" timestamptz,
  "isActive"    boolean NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS DisabledSpace_spaceId_active_idx
  ON "DisabledSpace"("spaceId") WHERE "isActive" = true;
CREATE INDEX IF NOT EXISTS DisabledSpace_spaceId_isActive_idx
  ON "DisabledSpace"("spaceId","isActive");

-- ============================================================================
-- CustomAgent, AgentSubAgent, SwarmRun, SwarmMember, SwarmEvent
-- ============================================================================

CREATE TABLE IF NOT EXISTS "CustomAgent" (
  id                   text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"            text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  description          text,
  "systemPrompt"       text NOT NULL DEFAULT '',
  model                text NOT NULL DEFAULT 'gpt-4o-mini',
  capabilities         jsonb NOT NULL DEFAULT '[]',
  "isActive"           boolean NOT NULL DEFAULT true,
  kind                 text NOT NULL DEFAULT 'custom'
                         CHECK (kind IN ('department','custom')),
  department           text,
  "autonomyLevel"      text NOT NULL DEFAULT 'ask'
                         CHECK ("autonomyLevel" IN ('observe','ask','auto-low','autonomous')),
  toolkits             text[] DEFAULT '{}',
  "triggerType"        text DEFAULT 'manual'
                         CHECK ("triggerType" IN ('manual','schedule','webhook','event')),
  "customInstructions" text DEFAULT '',
  "createdAt"          timestamptz NOT NULL DEFAULT now(),
  "updatedAt"          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS CustomAgent_spaceId_idx ON "CustomAgent"("spaceId");

-- Department.customAgentId FK back into CustomAgent (after CustomAgent exists).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Department_customAgentId_fkey'
  ) THEN
    ALTER TABLE "Department"
      ADD CONSTRAINT "Department_customAgentId_fkey"
      FOREIGN KEY ("customAgentId") REFERENCES "CustomAgent"(id) ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "AgentSubAgent" (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "customAgentId" text NOT NULL REFERENCES "CustomAgent"(id) ON DELETE CASCADE,
  name            text NOT NULL,
  role            text NOT NULL DEFAULT 'execution',
  instructions    text NOT NULL DEFAULT '',
  tools           text[] NOT NULL DEFAULT '{}',
  "order"         int NOT NULL DEFAULT 0,
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_AgentSubAgent_customAgentId_order
  ON "AgentSubAgent"("customAgentId","order");

CREATE TABLE IF NOT EXISTS "SwarmRun" (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"       text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  goal            text NOT NULL,
  status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','planning','running','auditing','completed','failed','cancelled')),
  plan            jsonb,
  result          text,
  "errorMessage"  text,
  "totalCostCents" int NOT NULL DEFAULT 0,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "completedAt"   timestamptz
);

CREATE INDEX IF NOT EXISTS SwarmRun_spaceId_createdAt_idx
  ON "SwarmRun"("spaceId","createdAt" DESC);

CREATE TABLE IF NOT EXISTS "SwarmMember" (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "swarmRunId"    text NOT NULL REFERENCES "SwarmRun"(id) ON DELETE CASCADE,
  "customAgentId" text REFERENCES "CustomAgent"(id) ON DELETE SET NULL,
  name            text NOT NULL,
  role            text,
  "systemPrompt"  text NOT NULL DEFAULT '',
  task            text NOT NULL,
  status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','running','completed','failed')),
  output          text,
  wave            int NOT NULL DEFAULT 1,
  "costCents"     int NOT NULL DEFAULT 0,
  "startedAt"     timestamptz,
  "completedAt"   timestamptz,
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS SwarmMember_swarmRunId_idx ON "SwarmMember"("swarmRunId");

CREATE TABLE IF NOT EXISTS "SwarmEvent" (
  id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "swarmRunId" text NOT NULL REFERENCES "SwarmRun"(id) ON DELETE CASCADE,
  "memberId"   text REFERENCES "SwarmMember"(id) ON DELETE SET NULL,
  type         text NOT NULL,
  data         jsonb NOT NULL DEFAULT '{}',
  "createdAt"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS SwarmEvent_swarmRunId_createdAt_idx
  ON "SwarmEvent"("swarmRunId","createdAt" ASC);

-- ============================================================================
-- Task, TaskConversation, TaskMessage (founder-facing task surface)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "Task" (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"       text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  title           text NOT NULL,
  description     text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','in_progress','done','cancelled')),
  priority        text NOT NULL DEFAULT 'normal'
                    CHECK (priority IN ('low','normal','high')),
  "assigneeKind"  text NOT NULL DEFAULT 'founder'
                    CHECK ("assigneeKind" IN ('founder','agent','unassigned')),
  "assigneeDept"  text
                    CHECK ("assigneeDept" IS NULL OR "assigneeDept" IN (
                      'engineering','sales','marketing','design','support','ops_finance')),
  "createdBy"     text NOT NULL DEFAULT 'founder'
                    CHECK ("createdBy" IN ('founder','agent')),
  "createdByDept" text
                    CHECK ("createdByDept" IS NULL OR "createdByDept" IN (
                      'engineering','sales','marketing','design','support','ops_finance','manager')),
  "dueAt"         timestamptz,
  "completedAt"   timestamptz,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_Task_spaceId_status_createdAt
  ON "Task"("spaceId", status, "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_Task_spaceId_assignee
  ON "Task"("spaceId","assigneeKind","assigneeDept");

CREATE TABLE IF NOT EXISTS "TaskConversation" (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"   text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "taskId"    text REFERENCES "Task"(id)      ON DELETE CASCADE,
  "gateId"    text REFERENCES "StageGate"(id) ON DELETE CASCADE,
  subject     text NOT NULL DEFAULT '',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CHECK (
    ("taskId" IS NOT NULL AND "gateId" IS NULL) OR
    ("taskId" IS NULL     AND "gateId" IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_TaskConversation_space_task ON "TaskConversation"("spaceId","taskId");
CREATE INDEX IF NOT EXISTS idx_TaskConversation_space_gate ON "TaskConversation"("spaceId","gateId");
CREATE UNIQUE INDEX IF NOT EXISTS uq_TaskConversation_space_task
  ON "TaskConversation"("spaceId","taskId") WHERE "taskId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_TaskConversation_space_gate
  ON "TaskConversation"("spaceId","gateId") WHERE "gateId" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "TaskMessage" (
  id               text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "conversationId" text NOT NULL REFERENCES "TaskConversation"(id) ON DELETE CASCADE,
  role             text NOT NULL CHECK (role IN ('user','assistant','system')),
  content          text NOT NULL,
  metadata         jsonb,
  "convexMessageId" text,
  "createdAt"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_TaskMessage_conversation_createdAt
  ON "TaskMessage"("conversationId","createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS TaskMessage_convexMessageId_key
  ON "TaskMessage"("convexMessageId");

-- ============================================================================
-- IntegrationConnection, McpApiKey, McpAuthCode
-- ============================================================================

CREATE TABLE IF NOT EXISTS "IntegrationConnection" (
  id                     text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"              text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "userId"               text NOT NULL,
  toolkit                text NOT NULL,
  "composioConnectionId" text NOT NULL,
  status                 text NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active','expired','revoked','failed')),
  label                  text,
  "lastError"            text,
  "lastUsedAt"           timestamptz,
  "createdAt"            timestamptz NOT NULL DEFAULT now(),
  "updatedAt"            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS IntegrationConnection_active_unique
  ON "IntegrationConnection"("spaceId","userId",toolkit) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS IntegrationConnection_spaceId_idx
  ON "IntegrationConnection"("spaceId", status);
CREATE INDEX IF NOT EXISTS IntegrationConnection_userId_idx
  ON "IntegrationConnection"("userId");

CREATE TABLE IF NOT EXISTS "McpApiKey" (
  id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"    text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  name         text NOT NULL DEFAULT 'Default',
  "keyHash"    text NOT NULL,
  "keyPrefix"  text NOT NULL,
  "lastUsedAt" timestamptz,
  "createdAt"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mcp_api_key_space ON "McpApiKey"("spaceId");
CREATE INDEX IF NOT EXISTS idx_mcp_api_key_hash  ON "McpApiKey"("keyHash");

CREATE TABLE IF NOT EXISTS "McpAuthCode" (
  id                    text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  code                  text UNIQUE NOT NULL,
  "clientId"            text NOT NULL,
  "spaceId"             text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "codeChallenge"       text NOT NULL,
  "codeChallengeMethod" text NOT NULL DEFAULT 'S256',
  "redirectUri"         text NOT NULL,
  "expiresAt"           timestamptz NOT NULL,
  "createdAt"           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mcp_auth_code ON "McpAuthCode"(code);

-- ============================================================================
-- Announcement, AnnouncementDismissal, EmailBroadcast
-- ============================================================================

CREATE TABLE IF NOT EXISTS "Announcement" (
  id              text PRIMARY KEY,
  message         text NOT NULL,
  title           text,
  severity        text NOT NULL DEFAULT 'info'
                    CHECK (severity IN ('info','warning','critical')),
  "targetSegment" text NOT NULL DEFAULT 'all'
                    CHECK ("targetSegment" IN ('all','trial','active','past_due','admin')),
  "linkUrl"       text,
  "linkLabel"     text,
  dismissible     boolean NOT NULL DEFAULT true,
  active          boolean NOT NULL DEFAULT true,
  "startsAt"      timestamptz,
  "endsAt"        timestamptz,
  "createdBy"     text,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS Announcement_active_range_idx
  ON "Announcement"(active,"startsAt","endsAt");

CREATE TABLE IF NOT EXISTS "AnnouncementDismissal" (
  id               text PRIMARY KEY,
  "announcementId" text NOT NULL REFERENCES "Announcement"(id) ON DELETE CASCADE,
  "userId"         text NOT NULL,
  "dismissedAt"    timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("announcementId","userId")
);

CREATE INDEX IF NOT EXISTS AnnouncementDismissal_user_idx
  ON "AnnouncementDismissal"("userId");

CREATE TABLE IF NOT EXISTS "EmailBroadcast" (
  id               text PRIMARY KEY,
  subject          text NOT NULL,
  body             text NOT NULL,
  segment          text NOT NULL,
  "recipientCount" int NOT NULL DEFAULT 0,
  "sentCount"      int NOT NULL DEFAULT 0,
  "failedCount"    int NOT NULL DEFAULT 0,
  "sentBy"         text,
  "createdAt"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS EmailBroadcast_createdAt_idx
  ON "EmailBroadcast"("createdAt" DESC);

-- ============================================================================
-- TelemetryEvent, CostEvent, AIUserProfile, AppKnowledgeDoc, DocumentEmbedding
-- ============================================================================

CREATE TABLE IF NOT EXISTS "TelemetryEvent" (
  id          text PRIMARY KEY,
  "spaceId"   text,
  "userId"    text,
  event       text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS TelemetryEvent_event_createdAt_idx
  ON "TelemetryEvent"(event,"createdAt" DESC);
CREATE INDEX IF NOT EXISTS TelemetryEvent_spaceId_event_idx
  ON "TelemetryEvent"("spaceId", event);

CREATE TABLE IF NOT EXISTS "CostEvent" (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"     text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  department    text CHECK (
                  department IS NULL OR department IN (
                    'engineering','sales','marketing','design','support','ops_finance','manager','in_process'
                  )
                ),
  model         text NOT NULL,
  "inputTokens" int NOT NULL DEFAULT 0,
  "outputTokens" int NOT NULL DEFAULT 0,
  "costUsd"     numeric(12,6) NOT NULL DEFAULT 0,
  "runId"       text,
  "toolName"    text,
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS CostEvent_space_createdAt_idx
  ON "CostEvent"("spaceId","createdAt" DESC);
CREATE INDEX IF NOT EXISTS CostEvent_space_dept_createdAt_idx
  ON "CostEvent"("spaceId", department,"createdAt" DESC);
CREATE INDEX IF NOT EXISTS CostEvent_space_model_createdAt_idx
  ON "CostEvent"("spaceId", model,"createdAt" DESC);

CREATE TABLE IF NOT EXISTS "AIUserProfile" (
  id                         text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"                  text NOT NULL UNIQUE REFERENCES "Space"(id) ON DELETE CASCADE,
  "displayName"              text,
  "businessFocus"            text[] NOT NULL DEFAULT '{}',
  "yearsExperience"          int,
  "workingStyle"             text,
  "communicationTone"        text,
  "currentGoals"             text,
  "quirksAndPreferences"     text,
  "agentPersonalizationNote" text,
  "createdAt"                timestamptz NOT NULL DEFAULT now(),
  "updatedAt"                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS AIUserProfile_spaceId_idx ON "AIUserProfile"("spaceId");

CREATE TABLE IF NOT EXISTS "AppKnowledgeDoc" (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  category       text NOT NULL,
  title          text NOT NULL,
  content        text NOT NULL,
  "searchVector" tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,''))
  ) STORED,
  "createdAt"    timestamptz NOT NULL DEFAULT now(),
  "updatedAt"    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS AppKnowledgeDoc_searchVector_idx
  ON "AppKnowledgeDoc" USING gin("searchVector");
CREATE INDEX IF NOT EXISTS AppKnowledgeDoc_category_idx
  ON "AppKnowledgeDoc"(category);

CREATE TABLE IF NOT EXISTS "DocumentEmbedding" (
  id           text PRIMARY KEY,
  "spaceId"    text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "entityType" text NOT NULL,
  "entityId"   text NOT NULL,
  content      text NOT NULL,
  embedding    vector(1536)
);

CREATE INDEX IF NOT EXISTS idx_doc_embedding_space  ON "DocumentEmbedding"("spaceId");
CREATE INDEX IF NOT EXISTS idx_doc_embedding_entity ON "DocumentEmbedding"("entityId");
CREATE INDEX IF NOT EXISTS idx_doc_embedding_hnsw
  ON "DocumentEmbedding" USING hnsw (embedding vector_cosine_ops);

-- ============================================================================
-- Row-Level Security
-- ============================================================================
-- App uses SUPABASE_SERVICE_ROLE_KEY (bypasses RLS). Policies guard against
-- direct PostgREST / anon-role access. Each is wrapped in a DO block so
-- duplicate_object is swallowed on re-runs.

ALTER TABLE "User"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Space"                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SpaceSetting"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Mission"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CoreMemory"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkspaceStage"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StageGate"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StageArtifact"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Department"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Person"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PipelineObject"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Team"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeamMembership"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeamInvite"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Document"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LibraryFile"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Note"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CalendarEvent"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CalendarNote"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Conversation"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Message"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Attachment"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentSettings"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentActivityLog"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentDraft"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentMemory"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentGoal"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentQuestion"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentPausedRun"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentTask"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExecutionStep"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaskCheckpoint"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GoalDecomposition"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaskDependency"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Artifact"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ArtifactVersion"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeadLetterEvent"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DisabledSpace"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomAgent"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentSubAgent"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SwarmRun"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SwarmMember"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SwarmEvent"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Task"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaskConversation"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaskMessage"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntegrationConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "McpApiKey"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "McpAuthCode"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CostEvent"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AIUserProfile"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppKnowledgeDoc"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentEmbedding"     ENABLE ROW LEVEL SECURITY;

-- Helper macro inlined via DO blocks. Standard space-owner policy.

DO $$ BEGIN
  CREATE POLICY "user: own row only"
    ON "User" FOR ALL
    USING ("clerkId" = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "space: owner only"
    ON "Space" FOR ALL
    USING ("ownerId" = current_user_internal_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "space_setting: owner only"
    ON "SpaceSetting" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "mission: space owner only"
    ON "Mission" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "core_memory: space owner only"
    ON "CoreMemory" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "workspace_stage: space owner only"
    ON "WorkspaceStage" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "stage_gate: space owner only"
    ON "StageGate" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "stage_artifact: space owner only"
    ON "StageArtifact" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "department: space owner only"
    ON "Department" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "person: space owner only"
    ON "Person" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "pipeline_object: space owner only"
    ON "PipelineObject" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "team: space owner only"
    ON "Team" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "team_membership: via team space owner"
    ON "TeamMembership" FOR ALL
    USING (EXISTS (
      SELECT 1 FROM "Team" t
      WHERE t.id = "TeamMembership"."teamId"
        AND t."spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id())
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "team_invite: members of team can read"
    ON "TeamInvite" FOR SELECT
    USING (EXISTS (
      SELECT 1 FROM "TeamMembership" tm
      WHERE tm."teamId" = "TeamInvite"."teamId"
        AND tm."userId" = current_user_internal_id()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "team_invite: admin or owner can write"
    ON "TeamInvite" FOR ALL
    USING (EXISTS (
      SELECT 1 FROM "TeamMembership" tm
      WHERE tm."teamId" = "TeamInvite"."teamId"
        AND tm."userId" = current_user_internal_id()
        AND tm.role IN ('owner','admin')
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "document: space owner only"
    ON "Document" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "library_file: space owner only"
    ON "LibraryFile" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "note: space owner only"
    ON "Note" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "calendar_event: space owner only"
    ON "CalendarEvent" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "calendar_note: space owner only"
    ON "CalendarNote" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "conversation: space owner only"
    ON "Conversation" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "message: space owner only"
    ON "Message" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "attachment: space owner only"
    ON "Attachment" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "agent_settings: space owner only"
    ON "AgentSettings" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "agent_activity_log: space owner only"
    ON "AgentActivityLog" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "agent_draft: space owner only"
    ON "AgentDraft" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "agent_memory: space owner only"
    ON "AgentMemory" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "agent_goal: space owner only"
    ON "AgentGoal" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "agent_question: space owner only"
    ON "AgentQuestion" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "agent_paused_run: space owner only"
    ON "AgentPausedRun" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "agent_task: space owner only"
    ON "AgentTask" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "execution_step: space owner only"
    ON "ExecutionStep" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "task_checkpoint: space owner only"
    ON "TaskCheckpoint" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "goal_decomposition: space owner only"
    ON "GoalDecomposition" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "task_dependency: via task space owner"
    ON "TaskDependency" FOR ALL
    USING (EXISTS (
      SELECT 1 FROM "AgentTask" t
      WHERE t.id = "TaskDependency"."taskId"
        AND t."spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id())
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "artifact: space owner only"
    ON "Artifact" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "artifact_version: space owner only"
    ON "ArtifactVersion" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "dead_letter_event: space owner only"
    ON "DeadLetterEvent" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "disabled_space: space owner only"
    ON "DisabledSpace" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "custom_agent: space owner only"
    ON "CustomAgent" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "agent_subagent: via custom agent space owner"
    ON "AgentSubAgent" FOR ALL
    USING (EXISTS (
      SELECT 1 FROM "CustomAgent" a
      WHERE a.id = "AgentSubAgent"."customAgentId"
        AND a."spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id())
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "swarm_run: space owner only"
    ON "SwarmRun" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "swarm_member: via swarm run space owner"
    ON "SwarmMember" FOR ALL
    USING (EXISTS (
      SELECT 1 FROM "SwarmRun" r
      WHERE r.id = "SwarmMember"."swarmRunId"
        AND r."spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id())
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "swarm_event: via swarm run space owner"
    ON "SwarmEvent" FOR ALL
    USING (EXISTS (
      SELECT 1 FROM "SwarmRun" r
      WHERE r.id = "SwarmEvent"."swarmRunId"
        AND r."spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id())
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "task: space owner only"
    ON "Task" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "task_conversation: space owner only"
    ON "TaskConversation" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "task_message: space owner only"
    ON "TaskMessage" FOR ALL
    USING ("conversationId" IN (
      SELECT id FROM "TaskConversation"
      WHERE "spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id())
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "cost_event: space owner can read"
    ON "CostEvent" FOR SELECT
    USING (EXISTS (
      SELECT 1 FROM "Space" s
      WHERE s.id = "CostEvent"."spaceId"
        AND s."ownerId" = current_user_internal_id()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "ai_user_profile: space owner only"
    ON "AIUserProfile" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "AppKnowledgeDoc_read"
    ON "AppKnowledgeDoc" FOR SELECT
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "embedding: space owner only"
    ON "DocumentEmbedding" FOR ALL
    USING ("spaceId" IN (SELECT id FROM "Space" WHERE "ownerId" = current_user_internal_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AuditLog, McpApiKey, McpAuthCode, IntegrationConnection, Announcement,
-- AnnouncementDismissal, EmailBroadcast, TelemetryEvent, AgentPausedRun
-- intentionally have no permissive policies — service-role-only access.

-- ============================================================================
-- Triggers
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW."updatedAt" = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "AgentGoal_updatedAt" ON "AgentGoal";
CREATE TRIGGER "AgentGoal_updatedAt"
  BEFORE UPDATE ON "AgentGoal"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION ensure_agent_settings_for_space()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO "AgentSettings" ("spaceId") VALUES (NEW.id)
  ON CONFLICT ("spaceId") DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS space_autoseed_agent_settings ON "Space";
CREATE TRIGGER space_autoseed_agent_settings
  AFTER INSERT ON "Space"
  FOR EACH ROW EXECUTE FUNCTION ensure_agent_settings_for_space();

-- ============================================================================
-- RPCs called from app code
-- ============================================================================

-- match_documents: pgvector similarity search over DocumentEmbedding.
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(1536),
  match_space_id  text,
  match_count     int DEFAULT 5
)
RETURNS TABLE (
  id          text,
  entity_type text,
  entity_id   text,
  content     text,
  similarity  float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    de.id,
    de."entityType" AS entity_type,
    de."entityId"   AS entity_id,
    de.content,
    1 - (de.embedding <=> query_embedding) AS similarity
  FROM "DocumentEmbedding" de
  WHERE de."spaceId" = match_space_id
    AND de.embedding IS NOT NULL
  ORDER BY de.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- match_agent_memory: pgvector similarity search over AgentMemory.
CREATE OR REPLACE FUNCTION match_agent_memory(
  query_embedding   vector(1536),
  match_space_id    text,
  match_count       int DEFAULT 6,
  filter_memory_type text DEFAULT NULL,
  filter_entity_type text DEFAULT NULL,
  filter_entity_id   text DEFAULT NULL,
  min_similarity     float DEFAULT 0.0
) RETURNS TABLE (
  id           text,
  content      text,
  "memoryType" text,
  "entityType" text,
  "entityId"   text,
  importance   float,
  similarity   float,
  "createdAt"  timestamptz
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id, m.content, m."memoryType", m."entityType", m."entityId", m.importance,
    (1 - (m.embedding <=> query_embedding))::float AS similarity,
    m."createdAt"
  FROM "AgentMemory" m
  WHERE m."spaceId" = match_space_id
    AND m.embedding IS NOT NULL
    AND (filter_memory_type IS NULL OR m."memoryType" = filter_memory_type)
    AND (filter_entity_type IS NULL OR m."entityType" = filter_entity_type)
    AND (filter_entity_id   IS NULL OR m."entityId"   = filter_entity_id)
    AND (1 - (m.embedding <=> query_embedding)) >= min_similarity
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- increment_agent_task_cost: atomic running total update for AgentTask.
CREATE OR REPLACE FUNCTION increment_agent_task_cost(
  p_task_id      text,
  p_input_tokens int,
  p_output_tokens int,
  p_cost_usd     numeric
) RETURNS void
LANGUAGE sql
AS $$
  UPDATE "AgentTask"
     SET "inputTokens"      = "inputTokens"  + p_input_tokens,
         "outputTokens"     = "outputTokens" + p_output_tokens,
         "estimatedCostUsd" = ROUND(("estimatedCostUsd" + p_cost_usd)::numeric, 6),
         "updatedAt"        = now()
   WHERE id = p_task_id;
$$;

-- cleanup_agent_data: daily retention sweep, capped per table per invocation.
CREATE OR REPLACE FUNCTION cleanup_agent_data()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_steps     int;
  deleted_tasks     int;
  deleted_memories  int;
  deleted_versions  int;
  deleted_artifacts int;
BEGIN
  DELETE FROM "ExecutionStep"
   WHERE id IN (
     SELECT id FROM "ExecutionStep"
     WHERE COALESCE("startedAt","createdAt") < NOW() - INTERVAL '30 days'
     LIMIT 1000
   );
  GET DIAGNOSTICS deleted_steps = ROW_COUNT;

  DELETE FROM "AgentTask"
   WHERE id IN (
     SELECT id FROM "AgentTask"
     WHERE status IN ('completed','failed','cancelled')
       AND "createdAt" < NOW() - INTERVAL '90 days'
     LIMIT 1000
   );
  GET DIAGNOSTICS deleted_tasks = ROW_COUNT;

  DELETE FROM "AgentMemory"
   WHERE id IN (
     SELECT id FROM "AgentMemory"
     WHERE "expiresAt" IS NOT NULL AND "expiresAt" < NOW()
     LIMIT 1000
   );
  GET DIAGNOSTICS deleted_memories = ROW_COUNT;

  DELETE FROM "ArtifactVersion"
   WHERE id IN (
     SELECT av.id
       FROM "ArtifactVersion" av
       JOIN "Artifact"  a  ON av."artifactId" = a.id
       JOIN "AgentTask" at ON a."taskId"      = at.id
      WHERE at."createdAt" < NOW() - INTERVAL '90 days'
      LIMIT 1000
   );
  GET DIAGNOSTICS deleted_versions = ROW_COUNT;

  DELETE FROM "Artifact"
   WHERE id IN (
     SELECT a.id
       FROM "Artifact"  a
       JOIN "AgentTask" at ON a."taskId" = at.id
      WHERE at."createdAt" < NOW() - INTERVAL '90 days'
      LIMIT 1000
   );
  GET DIAGNOSTICS deleted_artifacts = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted_steps',             deleted_steps,
    'deleted_tasks',             deleted_tasks,
    'deleted_memories',          deleted_memories,
    'deleted_artifact_versions', deleted_versions,
    'deleted_artifacts',         deleted_artifacts,
    'ran_at',                    NOW()
  );
END;
$$;

-- rollup_cost_by_day: per-day totals grouped by department + model.
CREATE OR REPLACE FUNCTION rollup_cost_by_day(
  p_space_id text,
  p_days     int DEFAULT 30
)
RETURNS TABLE (
  day          date,
  department   text,
  model        text,
  total_input  bigint,
  total_output bigint,
  total_cost   numeric
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    (date_trunc('day', "createdAt") AT TIME ZONE 'UTC')::date,
    COALESCE(department,'in_process'),
    model,
    SUM("inputTokens")::bigint,
    SUM("outputTokens")::bigint,
    SUM("costUsd")::numeric
  FROM "CostEvent"
  WHERE "spaceId" = p_space_id
    AND "createdAt" >= now() - (p_days || ' days')::interval
  GROUP BY 1,2,3
  ORDER BY 1 DESC, 6 DESC;
$$;

-- search_knowledge_docs: full-text search over AppKnowledgeDoc.
CREATE OR REPLACE FUNCTION search_knowledge_docs(
  query_text     text,
  filter_category text DEFAULT NULL,
  result_limit   int  DEFAULT 5
)
RETURNS TABLE (
  id       text,
  category text,
  title    text,
  content  text,
  rank     float4
)
LANGUAGE sql STABLE AS $$
  SELECT d.id, d.category, d.title, d.content,
         ts_rank_cd(d."searchVector", websearch_to_tsquery('english', query_text)) AS rank
  FROM "AppKnowledgeDoc" d
  WHERE d."searchVector" @@ websearch_to_tsquery('english', query_text)
    AND (filter_category IS NULL OR filter_category = '' OR d.category = filter_category)
  ORDER BY rank DESC
  LIMIT result_limit;
$$;

-- seed_charles_workspace: bootstrap rows for a new Charles space (idempotent).
CREATE OR REPLACE FUNCTION seed_charles_workspace(space_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO "Mission" ("spaceId", title, stage)
    VALUES (space_id, '', 'idea')
    ON CONFLICT ("spaceId") DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM "WorkspaceStage" WHERE "spaceId" = space_id) THEN
    INSERT INTO "WorkspaceStage" ("spaceId", stage) VALUES (space_id, 'idea');
  END IF;

  INSERT INTO "CoreMemory" ("spaceId", slot, value) VALUES
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
  ON CONFLICT ("spaceId", slot) DO NOTHING;

  INSERT INTO "Department" ("spaceId", slug, name, "autonomyLevel") VALUES
    (space_id, 'engineering', 'Engineering', 'ask'),
    (space_id, 'sales',       'Sales',       'ask'),
    (space_id, 'marketing',   'Marketing',   'ask'),
    (space_id, 'design',      'Design',      'auto-low'),
    (space_id, 'support',     'Support',     'auto-low'),
    (space_id, 'ops_finance', 'Ops/Finance', 'ask')
  ON CONFLICT ("spaceId", slug) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM "StageGate" WHERE "spaceId" = space_id AND stage = 'idea'
  ) THEN
    INSERT INTO "StageGate" ("spaceId", stage, title, "order") VALUES
      (space_id, 'idea', 'Define your company in one sentence', 0),
      (space_id, 'idea', 'Identify your target customer',       1),
      (space_id, 'idea', 'Connect GitHub',                      2);
  END IF;
END;
$$;

-- seed_stage_gates: install canonical gate rows for a single stage (idempotent).
CREATE OR REPLACE FUNCTION seed_stage_gates(p_space_id text, p_stage text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "StageGate"
    WHERE "spaceId" = p_space_id AND stage = p_stage
  ) THEN
    RETURN;
  END IF;

  CASE p_stage
    WHEN 'idea' THEN
      INSERT INTO "StageGate" ("spaceId", stage, title, "order") VALUES
        (p_space_id, 'idea', 'Define your company in one sentence', 0),
        (p_space_id, 'idea', 'Identify your target customer',       1),
        (p_space_id, 'idea', 'Connect GitHub',                      2);
    WHEN 'initial' THEN
      INSERT INTO "StageGate" ("spaceId", stage, title, "order") VALUES
        (p_space_id, 'initial', 'Claim a domain or repo',       0),
        (p_space_id, 'initial', 'Capture the brand voice',      1),
        (p_space_id, 'initial', 'Ship a first product surface', 2);
    WHEN 'identity' THEN
      INSERT INTO "StageGate" ("spaceId", stage, title, "order") VALUES
        (p_space_id, 'identity', 'Approve the logo and wordmark', 0),
        (p_space_id, 'identity', 'Publish the landing page',      1),
        (p_space_id, 'identity', 'Review the core copy',          2),
        (p_space_id, 'identity', 'Claim the social handles',      3);
    WHEN 'building' THEN
      INSERT INTO "StageGate" ("spaceId", stage, title, "order") VALUES
        (p_space_id, 'building', 'Define the feature roadmap',    0),
        (p_space_id, 'building', 'Deploy to production',          1),
        (p_space_id, 'building', 'Run a real founder onboarding', 2);
    WHEN 'selling' THEN
      INSERT INTO "StageGate" ("spaceId", stage, title, "order") VALUES
        (p_space_id, 'selling', 'Turn Stripe live',               0),
        (p_space_id, 'selling', 'Publish the pricing page',       1),
        (p_space_id, 'selling', 'Test the sales pitch',           2),
        (p_space_id, 'selling', 'Land the first paying customer', 3);
    WHEN 'scaling' THEN
      INSERT INTO "StageGate" ("spaceId", stage, title, "order") VALUES
        (p_space_id, 'scaling', 'Run a support flow',     0),
        (p_space_id, 'scaling', 'Wire the ops dashboard', 1),
        (p_space_id, 'scaling', 'Track runway weekly',    2);
    ELSE
      RETURN;
  END CASE;
END;
$$;

-- seed_workspace_documents: insert the nine canonical Charles document shells.
CREATE OR REPLACE FUNCTION seed_workspace_documents(p_space_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO "Document" ("spaceId", slug, title)
  SELECT p_space_id, slug, title
  FROM (VALUES
    ('executive-summary',     'Executive summary'),
    ('business-plan',         'Business plan'),
    ('brand-kit',             'Brand kit'),
    ('pitch-deck',            'Pitch deck'),
    ('business-model-canvas', 'Business model canvas'),
    ('growth-blueprint',      'Growth blueprint'),
    ('product-prd',           'Product PRD'),
    ('sales-plan',            'Sales plan'),
    ('marketing-plan',        'Marketing plan')
  ) AS v(slug, title)
  WHERE NOT EXISTS (
    SELECT 1 FROM "Document" d
    WHERE d."spaceId" = p_space_id AND d.slug = v.slug
  );
END;
$$;
