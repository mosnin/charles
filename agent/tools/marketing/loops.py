"""Loops lifecycle email tools.

The agent fires transactional sends, lifecycle events, and contact upserts
against Loops on the founder's behalf. Mutating calls hit Loops directly
here; the manager-layer approval gate wraps them in Wave 2 — the adapter
just needs to be honest about what it does and return errors as strings.

Auth: IntegrationConnection (toolkit='loops') → LOOPS_API_KEY.
"""

from __future__ import annotations

import json
import os
from typing import Any

import httpx
import structlog

from agents import function_tool
from db import supabase
from tools._approval import gate_or_execute

logger = structlog.get_logger(__name__)

_LOOPS_API = "https://app.loops.so/api/v1"
_TIMEOUT = 20.0


async def _get_loops_key(space_id: str) -> str | None:
    if space_id:
        try:
            db = await supabase()
            res = await (
                db.table("IntegrationConnection")
                .select("accessToken")
                .eq("spaceId", space_id)
                .eq("toolkit", "loops")
                .eq("status", "active")
                .maybe_single()
                .execute()
            )
            if res.data and res.data.get("accessToken"):
                return res.data["accessToken"]
        except Exception as err:  # noqa: BLE001
            logger.warning("loops_key_lookup_failed", space_id=space_id, error=str(err)[:200])

    return os.environ.get("LOOPS_API_KEY")


def _auth_headers(key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def _handle_response(resp: httpx.Response, action: str) -> str | None:
    if resp.status_code == 401:
        return f"Loops auth failed for {action}. Check key or reconnect Loops."
    if resp.status_code == 429:
        return f"Loops rate limit hit for {action}. Retry shortly."
    if not resp.is_success:
        body: dict[str, Any] = {}
        try:
            body = resp.json()
        except Exception:  # noqa: BLE001
            pass
        msg = body.get("message") or body.get("error") or resp.text[:200]
        return f"Loops API error {resp.status_code} for {action}: {msg}"
    return None


def _parse_json_arg(raw: str, label: str) -> tuple[dict[str, Any] | None, str | None]:
    if not raw:
        return {}, None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as err:
        return None, f"Loops: invalid JSON for {label}: {err}"
    if not isinstance(parsed, dict):
        return None, f"Loops: {label} must be a JSON object."
    return parsed, None


@function_tool
async def loops_send_transactional(
    email: str,
    transactional_id: str,
    data_variables: str = "",
    space_id: str = "",
) -> str:
    """Send a transactional email via a Loops template.

    data_variables: JSON object string passed to Loops as dataVariables.
    """

    async def _execute() -> str:
        key = await _get_loops_key(space_id)
        if not key:
            return "No Loops key found. Connect Loops in settings or set LOOPS_API_KEY."

        vars_dict, err = _parse_json_arg(data_variables, "data_variables")
        if err:
            return err

        payload: dict[str, Any] = {
            "email": email,
            "transactionalId": transactional_id,
        }
        if vars_dict:
            payload["dataVariables"] = vars_dict

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                f"{_LOOPS_API}/transactional",
                headers=_auth_headers(key),
                json=payload,
            )

        api_err = _handle_response(resp, "send_transactional")
        if api_err:
            return api_err

        logger.info("loops_transactional_sent", space_id=space_id, email=email, tx_id=transactional_id)
        return f"Sent transactional {transactional_id} to {email}."

    return await gate_or_execute(
        space_id=space_id,
        department="marketing",
        action_label=f"Send transactional {transactional_id} to {email}"[:120],
        risk="high",
        execute_fn=_execute,
    )


@function_tool
async def loops_send_event(
    email: str,
    event_name: str,
    properties: str = "",
    space_id: str = "",
) -> str:
    """Send a lifecycle event to Loops. properties is a JSON object string."""

    async def _execute() -> str:
        key = await _get_loops_key(space_id)
        if not key:
            return "No Loops key found. Connect Loops in settings or set LOOPS_API_KEY."

        props_dict, err = _parse_json_arg(properties, "properties")
        if err:
            return err

        payload: dict[str, Any] = {"email": email, "eventName": event_name}
        if props_dict:
            payload["eventProperties"] = props_dict

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                f"{_LOOPS_API}/events/send",
                headers=_auth_headers(key),
                json=payload,
            )

        api_err = _handle_response(resp, "send_event")
        if api_err:
            return api_err

        logger.info("loops_event_sent", space_id=space_id, email=email, event=event_name)
        return f"Sent event '{event_name}' for {email}."

    return await gate_or_execute(
        space_id=space_id,
        department="marketing",
        action_label=f"Send Loops event '{event_name}' for {email}"[:120],
        risk="high",
        execute_fn=_execute,
    )


@function_tool
async def loops_upsert_contact(
    email: str,
    first_name: str = "",
    last_name: str = "",
    user_id: str = "",
    subscribed: bool = True,
    space_id: str = "",
) -> str:
    """Create or update a Loops contact by email."""

    async def _execute() -> str:
        key = await _get_loops_key(space_id)
        if not key:
            return "No Loops key found. Connect Loops in settings or set LOOPS_API_KEY."

        payload: dict[str, Any] = {"email": email, "subscribed": subscribed}
        if first_name:
            payload["firstName"] = first_name
        if last_name:
            payload["lastName"] = last_name
        if user_id:
            payload["userId"] = user_id

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.put(
                f"{_LOOPS_API}/contacts/update",
                headers=_auth_headers(key),
                json=payload,
            )

        api_err = _handle_response(resp, "upsert_contact")
        if api_err:
            return api_err

        data = resp.json() if resp.content else {}
        contact_id = data.get("id") or data.get("contactId") or "(unknown id)"
        logger.info("loops_contact_upserted", space_id=space_id, email=email, contact_id=contact_id)
        return f"Upserted contact {email} (id={contact_id})."

    return await gate_or_execute(
        space_id=space_id,
        department="marketing",
        action_label=f"Upsert Loops contact {email}"[:120],
        risk="low",
        execute_fn=_execute,
    )


@function_tool
async def loops_find_contact(email: str, space_id: str = "") -> str:
    """Look up a Loops contact by email. Returns their properties or 'not found'."""
    key = await _get_loops_key(space_id)
    if not key:
        return "No Loops key found. Connect Loops in settings or set LOOPS_API_KEY."

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(
            f"{_LOOPS_API}/contacts/find",
            headers=_auth_headers(key),
            params={"email": email},
        )

    if resp.status_code == 404:
        return "not found"

    api_err = _handle_response(resp, "find_contact")
    if api_err:
        return api_err

    data = resp.json()
    # Loops returns an array; take the first match.
    if isinstance(data, list):
        if not data:
            return "not found"
        contact = data[0]
    elif isinstance(data, dict):
        contact = data
    else:
        return "not found"

    return json.dumps(contact)
