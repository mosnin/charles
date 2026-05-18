"""Cloudflare DNS + Registrar (availability-only) tools.

DNS record CRUD on zones the founder's API token can see. Domain
availability lookups via Cloudflare Registrar. Domain registration is
*explicitly not executed* here — it returns an approval-required string
because Phase 4 doesn't move money. Wave 2 wires the rest.

Auth: IntegrationConnection (toolkit='cloudflare_dns') → CLOUDFLARE_API_TOKEN.
"""

from __future__ import annotations

import os
from typing import Any

import httpx
import structlog

from agents import function_tool
from db import supabase
from tools._approval import gate_or_execute

logger = structlog.get_logger(__name__)

_CF_API = "https://api.cloudflare.com/client/v4"
_TIMEOUT = 20.0


async def _get_cf_token(space_id: str) -> str | None:
    if space_id:
        try:
            db = await supabase()
            res = await (
                db.table("IntegrationConnection")
                .select("accessToken")
                .eq("spaceId", space_id)
                .eq("toolkit", "cloudflare_dns")
                .eq("status", "active")
                .maybe_single()
                .execute()
            )
            if res.data and res.data.get("accessToken"):
                return res.data["accessToken"]
        except Exception as err:  # noqa: BLE001
            logger.warning("cf_token_lookup_failed", space_id=space_id, error=str(err)[:200])

    return os.environ.get("CLOUDFLARE_API_TOKEN")


def _auth_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def _handle_response(resp: httpx.Response, action: str) -> str | None:
    if resp.status_code == 401:
        return f"Cloudflare auth failed for {action}. Check token or reconnect Cloudflare."
    if resp.status_code == 403:
        return f"Cloudflare permission denied for {action}. Token may lack required scopes."
    if resp.status_code == 429:
        return f"Cloudflare rate limit hit for {action}. Retry shortly."
    if not resp.is_success:
        body: dict[str, Any] = {}
        try:
            body = resp.json()
        except Exception:  # noqa: BLE001
            pass
        errors = body.get("errors") or []
        msg = errors[0].get("message") if errors else resp.text[:200]
        return f"Cloudflare API error {resp.status_code} for {action}: {msg}"
    return None


@function_tool
async def cloudflare_list_zones(space_id: str = "") -> str:
    """List Cloudflare zones (domains) accessible to the token."""
    token = await _get_cf_token(space_id)
    if not token:
        return "No Cloudflare token found. Connect Cloudflare in settings or set CLOUDFLARE_API_TOKEN."

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(f"{_CF_API}/zones", headers=_auth_headers(token))

    err = _handle_response(resp, "list_zones")
    if err:
        return err

    zones = resp.json().get("result", [])
    if not zones:
        return "No zones found."

    return "\n".join(f"{z.get('name')} ({z.get('id')})" for z in zones)


@function_tool
async def cloudflare_list_records(
    zone_id: str,
    record_type: str = "",
    space_id: str = "",
) -> str:
    """List DNS records for a zone. Optionally filter by type (A/CNAME/MX/TXT/...)."""
    token = await _get_cf_token(space_id)
    if not token:
        return "No Cloudflare token found. Connect Cloudflare in settings or set CLOUDFLARE_API_TOKEN."

    params: dict[str, str] = {}
    if record_type:
        params["type"] = record_type.upper()

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(
            f"{_CF_API}/zones/{zone_id}/dns_records",
            headers=_auth_headers(token),
            params=params,
        )

    err = _handle_response(resp, "list_records")
    if err:
        return err

    records = resp.json().get("result", [])
    if not records:
        return "No records found."

    lines: list[str] = []
    for r in records:
        lines.append(
            f"{r.get('id')} {r.get('type')} {r.get('name')} -> {r.get('content')} "
            f"ttl={r.get('ttl')} proxied={r.get('proxied')}"
        )
    return "\n".join(lines)


@function_tool
async def cloudflare_create_record(
    zone_id: str,
    record_type: str,
    name: str,
    content: str,
    ttl: int = 1,
    proxied: bool = False,
    space_id: str = "",
) -> str:
    """Create a DNS record in a zone.

    ttl=1 means 'automatic'.
    """

    async def _execute() -> str:
        token = await _get_cf_token(space_id)
        if not token:
            return "No Cloudflare token found. Connect Cloudflare in settings or set CLOUDFLARE_API_TOKEN."

        payload: dict[str, Any] = {
            "type": record_type.upper(),
            "name": name,
            "content": content,
            "ttl": ttl,
            "proxied": proxied,
        }

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                f"{_CF_API}/zones/{zone_id}/dns_records",
                headers=_auth_headers(token),
                json=payload,
            )

        err = _handle_response(resp, "create_record")
        if err:
            return err

        data = resp.json().get("result", {})
        rec_id = data.get("id", "")
        logger.info("cf_record_created", space_id=space_id, zone=zone_id, record=rec_id)
        return f"Created {record_type.upper()} record {name} -> {content} (id={rec_id})."

    return await gate_or_execute(
        space_id=space_id,
        department="engineering",
        action_label=f"Create DNS {record_type.upper()} {name} -> {content}"[:120],
        risk="high",
        execute_fn=_execute,
    )


@function_tool
async def cloudflare_update_record(
    zone_id: str,
    record_id: str,
    content: str,
    ttl: int = 1,
    proxied: bool = False,
    space_id: str = "",
) -> str:
    """Update a DNS record's content/ttl/proxied flag."""

    async def _execute() -> str:
        token = await _get_cf_token(space_id)
        if not token:
            return "No Cloudflare token found. Connect Cloudflare in settings or set CLOUDFLARE_API_TOKEN."

        payload: dict[str, Any] = {"content": content, "ttl": ttl, "proxied": proxied}

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.patch(
                f"{_CF_API}/zones/{zone_id}/dns_records/{record_id}",
                headers=_auth_headers(token),
                json=payload,
            )

        err = _handle_response(resp, "update_record")
        if err:
            return err

        logger.info("cf_record_updated", space_id=space_id, zone=zone_id, record=record_id)
        return f"Updated record {record_id} -> {content}."

    return await gate_or_execute(
        space_id=space_id,
        department="engineering",
        action_label=f"Update DNS record {record_id} -> {content}"[:120],
        risk="high",
        execute_fn=_execute,
    )


@function_tool
async def cloudflare_delete_record(
    zone_id: str,
    record_id: str,
    space_id: str = "",
) -> str:
    """Delete a DNS record."""

    async def _execute() -> str:
        token = await _get_cf_token(space_id)
        if not token:
            return "No Cloudflare token found. Connect Cloudflare in settings or set CLOUDFLARE_API_TOKEN."

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.delete(
                f"{_CF_API}/zones/{zone_id}/dns_records/{record_id}",
                headers=_auth_headers(token),
            )

        err = _handle_response(resp, "delete_record")
        if err:
            return err

        logger.info("cf_record_deleted", space_id=space_id, zone=zone_id, record=record_id)
        return f"Deleted record {record_id}."

    return await gate_or_execute(
        space_id=space_id,
        department="engineering",
        action_label=f"Delete DNS record {record_id} in zone {zone_id}"[:120],
        risk="high",
        execute_fn=_execute,
    )


@function_tool
async def cloudflare_check_domain_availability(domain: str, space_id: str = "") -> str:
    """Check whether a domain is available to register via Cloudflare Registrar.

    Returns 'available' / 'unavailable' / 'unknown' plus a price hint when
    Cloudflare provides one.
    """
    token = await _get_cf_token(space_id)
    if not token:
        return "No Cloudflare token found. Connect Cloudflare in settings or set CLOUDFLARE_API_TOKEN."

    # Cloudflare's domain availability lookup lives under the user-scoped
    # registrar API; the public surface that works with a scoped token is
    # /accounts/{account_id}/registrar/domains/{domain}/check. We use the
    # token-discoverable endpoint and surface whatever Cloudflare returns.
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(
            f"{_CF_API}/domains/{domain}/check",
            headers=_auth_headers(token),
        )

    err = _handle_response(resp, "check_domain_availability")
    if err:
        return err

    data = resp.json().get("result", {}) or {}
    available = data.get("available")
    price = data.get("price") or data.get("currency_price")
    currency = data.get("currency", "USD")

    if available is True:
        if price is not None:
            return f"available — {price} {currency}/year"
        return "available"
    if available is False:
        return "unavailable"
    return "unknown"


@function_tool
async def cloudflare_register_domain(
    domain: str,
    years: int = 1,
    space_id: str = "",
) -> str:
    """Register a domain via Cloudflare Registrar.

    This does NOT execute the purchase in Phase 4 — the founder must
    complete payment manually through Cloudflare's dashboard.
    """
    return (
        f"ACTION REQUIRES APPROVAL: register {domain} for {years} year(s). "
        f"The founder must complete payment manually via Cloudflare Registrar."
    )
