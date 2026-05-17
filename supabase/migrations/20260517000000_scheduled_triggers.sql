-- ScheduledTrigger — the agent's calendar.
--
-- A row here means: "wake the agent at runAt to think about reason, with
-- payload as context." Two producers: (1) the agent itself, via the
-- schedule_self_wake tool — "check on PR #42 in 24h," "follow up with
-- Acme if no reply in 3 days." (2) The daily heartbeat — fanout cron
-- writes a heartbeat row per active space so the agent re-evaluates open
-- goals on a cadence even without external events.
--
-- The fanout cron (app/api/cron/trigger-fanout) polls every 5 minutes
-- for rows where runAt <= now AND status = 'pending', fires them via
-- Modal run_now_webhook, and marks status = 'fired'. Rows are
-- terminal-state — never re-fire. Recurring triggers schedule their
-- successor when they fire.
--
-- Cancellable from the founder UI (briefing "Coming up" section).

CREATE TABLE IF NOT EXISTS "ScheduledTrigger" (
  id                text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"         text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "runAt"           timestamptz NOT NULL,
  reason            text NOT NULL,
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdByTaskId" text REFERENCES "AgentTask"(id) ON DELETE SET NULL,
  source            text NOT NULL DEFAULT 'agent'
                      CHECK (source IN ('agent','heartbeat','founder','system')),
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','fired','cancelled','expired')),
  "firedAt"         timestamptz,
  "cancelledAt"     timestamptz,
  "createdAt"       timestamptz NOT NULL DEFAULT now()
);

-- Fanout cron path: WHERE status='pending' AND runAt <= now ORDER BY runAt.
CREATE INDEX IF NOT EXISTS ScheduledTrigger_pending_runAt_idx
  ON "ScheduledTrigger"("runAt") WHERE status = 'pending';

-- Founder UI path: list upcoming for a space.
CREATE INDEX IF NOT EXISTS ScheduledTrigger_space_pending_idx
  ON "ScheduledTrigger"("spaceId", "runAt") WHERE status = 'pending';

-- Heartbeat: track last wake per space. Cron consults this to skip
-- spaces whose heartbeat fired <23h ago. Lives on AgentSettings because
-- it's per-space configuration adjacent to enabled + dailyTokenBudget.
ALTER TABLE "AgentSettings"
  ADD COLUMN IF NOT EXISTS "lastHeartbeatAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "heartbeatHourUtc" int NOT NULL DEFAULT 14
    CHECK ("heartbeatHourUtc" >= 0 AND "heartbeatHourUtc" <= 23);
-- Default 14 UTC = 9am ET / 6am PT. Sensible default for US founders.
-- Adjustable per space later via a settings UI; v1 hard-defaults.
