"""PostHog product-analytics read tools for the marketing department.

Read-only. The agent uses these to answer founder questions like
"how many signups this week?" or "which event is firing most?". No
event tracking writes — those happen client-side in app code.

Auth: IntegrationConnection (toolkit='posthog') → POSTHOG_API_KEY env.
Project id from IntegrationConnection.accessKey or POSTHOG_PROJECT_ID.
Host from IntegrationConnection.metadata.host or POSTHOG_HOST
(default https://us.posthog.com).
"""

from __future__ import annotations

import os
from typing import Any

import httpx
import structlog

from agents import function_tool
from db import supabase

logger = structlog.get_logger(__name__)

_DEFAULT_HOST = "https://us.posthog.com"
_TIMEOUT = 20.0
_MAX_DAYS = 365
_MAX_LIMIT = 50


async def _get_posthog_config(space_id: str) -> tuple[str | None, str | None, str]:
    """Return (api_key, project_id, host). api_key/project_id may be None."""
    api_key: str | None = None
    project_id: str | None = None
    host = _DEFAULT_HOST

    if space_id:
        try:
            db = await supabase()
            res = await (
                db.table("IntegrationConnection")
                .select("accessToken, accessKey, metadata")
                .eq("spaceId", space_id)
                .eq("toolkit", "posthog")
                .eq("status", "active")
                .maybe_single()
                .execute()
            )
            if res.data:
                api_key = res.data.get("accessToken") or None
                project_id = res.data.get("accessKey") or None
                meta = res.data.get("metadata") or {}
                if isinstance(meta, dict) and meta.get("host"):
                    host = str(meta["host"])
        except Exception as err:  # noqa: BLE001
            logger.warning("posthog_config_lookup_failed", space_id=space_id, error=str(err)[:200])

    api_key = api_key or os.environ.get("POSTHOG_API_KEY")
    project_id = project_id or os.environ.get("POSTHOG_PROJECT_ID")
    host = os.environ.get("POSTHOG_HOST", host).rstrip("/")
    return api_key, project_id, host


def _auth_headers(key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def _clamp(value: int, lo: int, hi: int) -> int:
    if value < lo:
        return lo
    if value > hi:
        return hi
    return value


def _escape(s: str) -> str:
    return s.replace("'", "''")


async def _hogql(
    client: httpx.AsyncClient,
    host: str,
    project_id: str,
    api_key: str,
    query: str,
) -> tuple[list[list[Any]] | None, str | None]:
    """POST to /api/projects/{id}/query/. Returns (results, error)."""
    resp = await client.post(
        f"{host}/api/projects/{project_id}/query/",
        headers=_auth_headers(api_key),
        json={"query": {"kind": "HogQLQuery", "query": query}},
    )
    if resp.status_code == 401:
        return None, "PostHog auth failed. Check API key or reconnect PostHog."
    if resp.status_code == 403:
        return None, "PostHog forbidden — the personal API key lacks project access."
    if resp.status_code == 429:
        return None, "PostHog rate limit hit. Retry shortly."
    if not resp.is_success:
        body: dict[str, Any] = {}
        try:
            body = resp.json()
        except Exception:  # noqa: BLE001
            pass
        msg = body.get("detail") or body.get("error") or resp.text[:200]
        return None, f"PostHog error {resp.status_code}: {msg}"

    data = resp.json()
    return data.get("results") or [], None


@function_tool
async def posthog_event_count(
    event_name: str,
    days: int = 30,
    space_id: str = "",
) -> str:
    """Return the count of an event over the last N days."""
    api_key, project_id, host = await _get_posthog_config(space_id)
    if not api_key or not project_id:
        return "No PostHog credentials found. Connect PostHog in settings or set POSTHOG_API_KEY + POSTHOG_PROJECT_ID."

    d = _clamp(days, 1, _MAX_DAYS)
    q = (
        f"SELECT count() FROM events WHERE event = '{_escape(event_name)}' "
        f"AND timestamp >= now() - INTERVAL {d} DAY"
    )

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        results, err = await _hogql(client, host, project_id, api_key, q)
    if err:
        return err
    assert results is not None
    n = 0
    if results and results[0]:
        try:
            n = int(results[0][0])
        except (TypeError, ValueError):
            n = 0
    return f"{event_name}: {n} events in the last {d} days."


@function_tool
async def posthog_top_events(
    days: int = 30,
    limit: int = 10,
    space_id: str = "",
) -> str:
    """Return the most-fired events with their counts."""
    api_key, project_id, host = await _get_posthog_config(space_id)
    if not api_key or not project_id:
        return "No PostHog credentials found. Connect PostHog in settings or set POSTHOG_API_KEY + POSTHOG_PROJECT_ID."

    d = _clamp(days, 1, _MAX_DAYS)
    lim = _clamp(limit, 1, _MAX_LIMIT)
    q = (
        f"SELECT event, count() AS c FROM events "
        f"WHERE timestamp >= now() - INTERVAL {d} DAY "
        f"GROUP BY event ORDER BY c DESC LIMIT {lim}"
    )

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        results, err = await _hogql(client, host, project_id, api_key, q)
    if err:
        return err
    assert results is not None
    if not results:
        return f"No events recorded in the last {d} days."
    lines = [f"Top events (last {d} days):"]
    for row in results:
        ev = str(row[0]) if row and len(row) > 0 else "(unknown)"
        try:
            c = int(row[1]) if row and len(row) > 1 else 0
        except (TypeError, ValueError):
            c = 0
        lines.append(f"  {ev}: {c}")
    return "\n".join(lines)


@function_tool
async def posthog_active_users(days: int = 30, space_id: str = "") -> str:
    """Return the count of unique active distinct_ids over the last N days."""
    api_key, project_id, host = await _get_posthog_config(space_id)
    if not api_key or not project_id:
        return "No PostHog credentials found. Connect PostHog in settings or set POSTHOG_API_KEY + POSTHOG_PROJECT_ID."

    d = _clamp(days, 1, _MAX_DAYS)
    q = (
        f"SELECT count(DISTINCT distinct_id) FROM events "
        f"WHERE timestamp >= now() - INTERVAL {d} DAY"
    )

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        results, err = await _hogql(client, host, project_id, api_key, q)
    if err:
        return err
    assert results is not None
    n = 0
    if results and results[0]:
        try:
            n = int(results[0][0])
        except (TypeError, ValueError):
            n = 0
    return f"{n} active users in the last {d} days."


@function_tool
async def posthog_funnel(
    steps_csv: str,
    days: int = 30,
    space_id: str = "",
) -> str:
    """Compute step-by-step conversion through a sequence of events.

    steps_csv: comma-separated list of event names, in order.
    """
    api_key, project_id, host = await _get_posthog_config(space_id)
    if not api_key or not project_id:
        return "No PostHog credentials found. Connect PostHog in settings or set POSTHOG_API_KEY + POSTHOG_PROJECT_ID."

    steps = [s.strip() for s in steps_csv.split(",") if s.strip()]
    if not steps:
        return "Funnel needs at least one event name (comma-separated)."

    d = _clamp(days, 1, _MAX_DAYS)
    counts: list[int] = []

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        for ev in steps:
            q = (
                f"SELECT count(DISTINCT distinct_id) FROM events "
                f"WHERE event = '{_escape(ev)}' "
                f"AND timestamp >= now() - INTERVAL {d} DAY"
            )
            results, err = await _hogql(client, host, project_id, api_key, q)
            if err:
                return err
            assert results is not None
            n = 0
            if results and results[0]:
                try:
                    n = int(results[0][0])
                except (TypeError, ValueError):
                    n = 0
            counts.append(n)

    lines = [f"Funnel (last {d} days):"]
    for i, ev in enumerate(steps):
        c = counts[i]
        if i == 0:
            lines.append(f"  1. {ev}: {c}")
        else:
            prev = counts[i - 1]
            pct = (c / prev * 100.0) if prev > 0 else 0.0
            lines.append(f"  {i + 1}. {ev}: {c} ({pct:.1f}% of previous)")
    return "\n".join(lines)


@function_tool
async def posthog_signups_trend(days: int = 30, space_id: str = "") -> str:
    """Return the daily count of 'user signed up' events for the last N days."""
    api_key, project_id, host = await _get_posthog_config(space_id)
    if not api_key or not project_id:
        return "No PostHog credentials found. Connect PostHog in settings or set POSTHOG_API_KEY + POSTHOG_PROJECT_ID."

    d = _clamp(days, 1, _MAX_DAYS)
    q = (
        f"SELECT toDate(timestamp) AS day, count() AS c FROM events "
        f"WHERE event = 'user signed up' "
        f"AND timestamp >= now() - INTERVAL {d} DAY "
        f"GROUP BY day ORDER BY day ASC"
    )

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        results, err = await _hogql(client, host, project_id, api_key, q)
    if err:
        return err
    assert results is not None
    if not results:
        return f"No signups recorded in the last {d} days."
    lines = [f"Signups by day (last {d} days):"]
    total = 0
    for row in results:
        day = str(row[0]) if row and len(row) > 0 else "?"
        try:
            c = int(row[1]) if row and len(row) > 1 else 0
        except (TypeError, ValueError):
            c = 0
        total += c
        lines.append(f"  {day}: {c}")
    lines.append(f"Total: {total}")
    return "\n".join(lines)
