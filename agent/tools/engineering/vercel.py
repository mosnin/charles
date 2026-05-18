"""Vercel tools — list/inspect projects, gate writes through approval.

Reads (list_projects, get_env_vars) execute directly. Writes
(set_env_var, trigger_deployment) return an "ACTION REQUIRES APPROVAL"
string instead of executing — the manager turns those into approval
requests the founder confirms before re-invocation.

Auth: IntegrationConnection (toolkit='vercel') → VERCEL_TOKEN env.
"""

from __future__ import annotations

import os
from typing import Any

import httpx
import structlog

from agents import function_tool
from db import supabase

logger = structlog.get_logger(__name__)

_VERCEL_API = "https://api.vercel.com"
_TIMEOUT = 20.0


async def _get_vercel_token(space_id: str) -> str | None:
    if space_id:
        try:
            db = await supabase()
            res = await (
                db.table("IntegrationConnection")
                .select("accessToken")
                .eq("spaceId", space_id)
                .eq("toolkit", "vercel")
                .eq("status", "active")
                .maybe_single()
                .execute()
            )
            if res.data and res.data.get("accessToken"):
                return res.data["accessToken"]
        except Exception as err:  # noqa: BLE001
            logger.warning("vercel_token_lookup_failed", space_id=space_id, error=str(err)[:200])

    return os.environ.get("VERCEL_TOKEN")


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _handle_response(resp: httpx.Response, action: str) -> str | None:
    if resp.status_code == 401:
        return f"Vercel auth failed for {action}. Check token or reconnect Vercel."
    if resp.status_code == 403:
        return f"Vercel permission denied for {action}. Token scope may be insufficient."
    if not resp.is_success:
        body: dict[str, Any] = {}
        try:
            body = resp.json()
        except Exception:  # noqa: BLE001
            pass
        msg = (body.get("error") or {}).get("message") or resp.text[:200]
        return f"Vercel API error {resp.status_code} for {action}: {msg}"
    return None


@function_tool
async def vercel_list_projects(space_id: str = "") -> str:
    """List the Vercel projects the connected token can see."""
    token = await _get_vercel_token(space_id)
    if not token:
        return "No Vercel token found. Connect Vercel in settings or set VERCEL_TOKEN."

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(
            f"{_VERCEL_API}/v9/projects",
            headers=_auth_headers(token),
            params={"limit": 50},
        )

    err = _handle_response(resp, "list_projects")
    if err:
        return err

    projects = resp.json().get("projects", [])
    if not projects:
        return "No Vercel projects."

    return "\n".join(f"{p.get('id')}  {p.get('name')}  framework={p.get('framework') or 'n/a'}" for p in projects)


@function_tool
async def vercel_get_env_vars(project_id: str, space_id: str = "") -> str:
    """List env var KEYS for a Vercel project. Values are NEVER returned — only set/unset."""
    token = await _get_vercel_token(space_id)
    if not token:
        return "No Vercel token found. Connect Vercel in settings or set VERCEL_TOKEN."

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(
            f"{_VERCEL_API}/v9/projects/{project_id}/env",
            headers=_auth_headers(token),
        )

    err = _handle_response(resp, "get_env_vars")
    if err:
        return err

    envs = resp.json().get("envs", [])
    if not envs:
        return f"No env vars on project {project_id}."

    lines = []
    for e in envs:
        key = e.get("key")
        # Vercel returns 'value' only for plaintext non-secret vars; treat
        # anything we can't read as 'set' to avoid leaking secrets through
        # the agent's transcript.
        marker = "set" if e.get("value") or e.get("type") in {"encrypted", "secret", "system"} else "unset"
        targets = ",".join(e.get("target") or [])
        lines.append(f"{key} = ({marker}) target={targets}")
    return "\n".join(lines)


@function_tool
async def vercel_set_env_var(
    project_id: str,
    key: str,
    value: str,
    target: str = "production",
    space_id: str = "",
) -> str:
    """Set an env var on a Vercel project.

    ACTION REQUIRES APPROVAL — surfaces a gate string; the manager runs it
    only after founder confirmation.
    """
    return (
        f"ACTION REQUIRES APPROVAL: set env var '{key}' on Vercel project "
        f"{project_id} (target={target}). Value will be stored encrypted; "
        f"the founder must approve before this is applied."
    )


@function_tool
async def vercel_trigger_deployment(
    project_id: str,
    ref: str = "main",
    space_id: str = "",
) -> str:
    """Trigger a deployment of `ref` on the given Vercel project.

    ACTION REQUIRES APPROVAL — surfaces a gate string; the manager runs it
    only after founder confirmation.
    """
    return (
        f"ACTION REQUIRES APPROVAL: trigger deployment of {ref} on Vercel "
        f"project {project_id}. The founder must approve before this is applied."
    )
