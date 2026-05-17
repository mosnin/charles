"""Agent self-scheduling — the calendar.

Exposes one tool: schedule_self_wake(when, reason, payload?). The agent
calls this to schedule a future wake-up — "check on PR #42 in 24h",
"follow up with Acme if no reply by Friday." The row lands in
ScheduledTrigger as source='agent'; the fanout cron picks it up at
runAt and re-invokes the orchestrator with the payload as context.

Why this is a tool and not, say, a queue write:
  - The agent already lives inside an OpenAI Agents SDK loop where tools
    are the first-class action surface.
  - schedule_self_wake is *not* high-risk — it doesn't move money, send
    a message, or change external state. So the approval gate skips it.
    (See agent/orchestrator.py _is_high_risk_tool — `schedule_` is not
    in the pattern list.)
  - The agent gets a string back ("scheduled for ...") which it can
    quote to the founder in chat.

Validates two things:
  1. when parses as ISO-8601 (or 'in Nh'/'in Nd' shorthand).
  2. when resolves to a future timestamp.
Persists via the same db.supabase() asyncpg shim other tools use.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

import structlog

from agents import function_tool
from db import supabase

logger = structlog.get_logger(__name__)


# Shorthand patterns the agent often reaches for: "in 24h", "in 3d",
# "in 90m". Parsed locally so the agent doesn't have to compute
# timestamps. Anything not matching falls through to ISO-8601 parse.
_SHORTHAND_RE = re.compile(r"^\s*in\s+(\d+)\s*([smhd])\s*$", re.IGNORECASE)


def _parse_when(when: str) -> datetime | None:
    """Returns a UTC datetime or None if unparseable."""
    m = _SHORTHAND_RE.match(when)
    if m:
        n = int(m.group(1))
        unit = m.group(2).lower()
        delta = {
            "s": timedelta(seconds=n),
            "m": timedelta(minutes=n),
            "h": timedelta(hours=n),
            "d": timedelta(days=n),
        }[unit]
        return datetime.now(timezone.utc) + delta

    try:
        # fromisoformat handles "2026-05-18T14:30:00+00:00" and naked
        # "2026-05-18T14:30". Naked strings are interpreted as UTC.
        parsed = datetime.fromisoformat(when.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except (ValueError, TypeError):
        return None


def build_scheduling_tools(space_id: str, run_id: str | None = None) -> list:
    """Return the scheduling tool list, closed over the active space.

    Same shape as the other tool factories in agent/tools/*. Called from
    agent/manager/charles.py inside _get_tools() so the closure picks up
    the right space_id at agent-build time.
    """

    @function_tool
    async def schedule_self_wake(
        when: str,
        reason: str,
        payload_json: str = "",
    ) -> str:
        """Schedule a future wake-up for yourself.

        Use this when a task can't be fully resolved right now and needs
        a future check-in. Examples: "the PR is in review, check on it
        in 24h", "the customer said they'd respond by Friday, follow up
        Saturday morning."

        Parameters
        ----------
        when:
            ISO-8601 timestamp (UTC) — "2026-05-19T14:00:00Z" — or
            shorthand "in 24h", "in 3d", "in 90m", "in 30s". Must
            resolve to a future time.
        reason:
            One sentence the future-you reads when waking. State what
            you're checking on and why. Example: "Check whether PR #42
            in repo charles got merged or still needs a review nudge."
        payload_json:
            Optional JSON string with extra context the wake should
            carry (PR number, contact id, etc.). Leave empty if not
            needed.

        Returns a confirmation string with the scheduled UTC time and
        the trigger id (which you can quote if asked to cancel).
        """
        run_at = _parse_when(when)
        if run_at is None:
            return (
                f"Could not parse when='{when}'. Use ISO-8601 "
                "(2026-05-19T14:00:00Z) or shorthand (in 24h, in 3d)."
            )
        now = datetime.now(timezone.utc)
        if run_at <= now:
            return f"when={run_at.isoformat()} is in the past. Scheduling refused."
        if not reason.strip():
            return "reason is required — say one sentence about what to check."

        payload: dict = {}
        if payload_json.strip():
            try:
                import json

                payload = json.loads(payload_json)
                if not isinstance(payload, dict):
                    return "payload_json must decode to a JSON object."
            except Exception as e:
                return f"payload_json is not valid JSON: {e}"

        db = await supabase()
        result = await (
            db.table("ScheduledTrigger")
            .insert(
                {
                    "spaceId": space_id,
                    "runAt": run_at.isoformat(),
                    "reason": reason.strip(),
                    "payload": payload,
                    "source": "agent",
                    "status": "pending",
                }
            )
            .execute()
        )
        row = (result.data or [{}])[0]
        trigger_id = row.get("id", "(unknown)")
        logger.info(
            "scheduled_self_wake",
            space_id=space_id,
            run_id=run_id,
            trigger_id=trigger_id,
            run_at=run_at.isoformat(),
            reason=reason.strip()[:120],
        )
        return (
            f"Scheduled wake-up for {run_at.isoformat()} "
            f"(trigger {trigger_id}): {reason.strip()}"
        )

    @function_tool
    async def list_upcoming_wakes(limit: int = 10) -> str:
        """List your own upcoming scheduled wake-ups for this space.

        Useful when you want to avoid duplicating a scheduled check or
        to remind the founder what you've already queued. Returns up to
        `limit` pending triggers (default 10), oldest first.
        """
        cap = max(1, min(limit, 50))
        db = await supabase()
        result = await (
            db.table("ScheduledTrigger")
            .select("id, runAt, reason, source")
            .eq("spaceId", space_id)
            .eq("status", "pending")
            .order("runAt", desc=False)
            .limit(cap)
            .execute()
        )
        rows = result.data or []
        if not rows:
            return "No scheduled wake-ups pending."
        lines = [f"{len(rows)} pending wake-up(s):"]
        for r in rows:
            lines.append(
                f"  - {r['runAt']} [{r['source']}] ({r['id'][:8]}): {r['reason']}"
            )
        return "\n".join(lines)

    return [schedule_self_wake, list_upcoming_wakes]
