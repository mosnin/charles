"""Stripe read-only tools.

Read-only on purpose: the agent can answer revenue / subscription / charge
questions, but cannot create charges, issue refunds, or mutate
subscriptions. Those operations belong behind a separate, gated flow.

Auth priority: IntegrationConnection (toolkit='stripe') → STRIPE_SECRET_KEY.
All tools return strings — errors included — so the agent can surface them.
"""

from __future__ import annotations

import os
import time
from typing import Any

import httpx
import structlog

from agents import function_tool
from db import supabase

logger = structlog.get_logger(__name__)

_STRIPE_API = "https://api.stripe.com/v1"
_TIMEOUT = 20.0


async def _get_stripe_key(space_id: str) -> str | None:
    if space_id:
        try:
            db = await supabase()
            res = await (
                db.table("IntegrationConnection")
                .select("accessToken")
                .eq("spaceId", space_id)
                .eq("toolkit", "stripe")
                .eq("status", "active")
                .maybe_single()
                .execute()
            )
            if res.data and res.data.get("accessToken"):
                return res.data["accessToken"]
        except Exception as err:  # noqa: BLE001
            logger.warning("stripe_key_lookup_failed", space_id=space_id, error=str(err)[:200])

    return os.environ.get("STRIPE_SECRET_KEY")


def _auth_headers(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}"}


def _format_money(amount: int | None, currency: str | None) -> str:
    if amount is None:
        return "n/a"
    return f"{amount / 100:.2f} {(currency or '').upper()}"


def _handle_response(resp: httpx.Response, action: str) -> str | None:
    if resp.status_code == 401:
        return f"Stripe auth failed for {action}. Check key or reconnect Stripe."
    if resp.status_code == 429:
        return f"Stripe rate limit hit for {action}. Retry shortly."
    if not resp.is_success:
        body: dict[str, Any] = {}
        try:
            body = resp.json()
        except Exception:  # noqa: BLE001
            pass
        msg = (body.get("error") or {}).get("message") or resp.text[:200]
        return f"Stripe API error {resp.status_code} for {action}: {msg}"
    return None


@function_tool
async def stripe_get_balance(space_id: str = "") -> str:
    """Return the connected Stripe account's available + pending balance."""
    key = await _get_stripe_key(space_id)
    if not key:
        return "No Stripe key found. Connect Stripe in settings or set STRIPE_SECRET_KEY."

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(f"{_STRIPE_API}/balance", headers=_auth_headers(key))

    err = _handle_response(resp, "get_balance")
    if err:
        return err

    data = resp.json()
    available = ", ".join(_format_money(b.get("amount"), b.get("currency")) for b in data.get("available", []))
    pending = ", ".join(_format_money(b.get("amount"), b.get("currency")) for b in data.get("pending", []))
    return f"Available: {available or 'none'}\nPending: {pending or 'none'}"


@function_tool
async def stripe_list_subscriptions(limit: int = 20, space_id: str = "") -> str:
    """List active Stripe subscriptions (most recent first)."""
    key = await _get_stripe_key(space_id)
    if not key:
        return "No Stripe key found. Connect Stripe in settings or set STRIPE_SECRET_KEY."

    limit = max(1, min(limit, 100))
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(
            f"{_STRIPE_API}/subscriptions",
            headers=_auth_headers(key),
            params={"status": "active", "limit": limit},
        )

    err = _handle_response(resp, "list_subscriptions")
    if err:
        return err

    subs = resp.json().get("data", [])
    if not subs:
        return "No active subscriptions."

    lines: list[str] = []
    for s in subs:
        item = (s.get("items", {}).get("data") or [{}])[0]
        price = item.get("price") or {}
        amount = price.get("unit_amount")
        currency = price.get("currency")
        interval = (price.get("recurring") or {}).get("interval", "?")
        lines.append(
            f"{s.get('id')} customer={s.get('customer')} {_format_money(amount, currency)}/{interval}"
        )
    return "\n".join(lines)


@function_tool
async def stripe_list_recent_charges(limit: int = 20, space_id: str = "") -> str:
    """List the most recent Stripe charges (succeeded + failed)."""
    key = await _get_stripe_key(space_id)
    if not key:
        return "No Stripe key found. Connect Stripe in settings or set STRIPE_SECRET_KEY."

    limit = max(1, min(limit, 100))
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(
            f"{_STRIPE_API}/charges",
            headers=_auth_headers(key),
            params={"limit": limit},
        )

    err = _handle_response(resp, "list_charges")
    if err:
        return err

    charges = resp.json().get("data", [])
    if not charges:
        return "No recent charges."

    lines: list[str] = []
    for c in charges:
        lines.append(
            f"{c.get('id')} {_format_money(c.get('amount'), c.get('currency'))} "
            f"status={c.get('status')} customer={c.get('customer')}"
        )
    return "\n".join(lines)


@function_tool
async def stripe_get_revenue_summary(space_id: str = "") -> str:
    """Return MRR estimate, active subscription count, and last-30-days revenue."""
    key = await _get_stripe_key(space_id)
    if not key:
        return "No Stripe key found. Connect Stripe in settings or set STRIPE_SECRET_KEY."

    headers = _auth_headers(key)
    thirty_days_ago = int(time.time()) - 30 * 86_400

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        sub_resp = await client.get(
            f"{_STRIPE_API}/subscriptions",
            headers=headers,
            params={"status": "active", "limit": 100},
        )
        err = _handle_response(sub_resp, "revenue_summary subscriptions")
        if err:
            return err

        # Single charges page; for a real summary use /reporting endpoints.
        charge_resp = await client.get(
            f"{_STRIPE_API}/charges",
            headers=headers,
            params={"limit": 100, "created[gte]": thirty_days_ago},
        )
        err = _handle_response(charge_resp, "revenue_summary charges")
        if err:
            return err

    subs = sub_resp.json().get("data", [])
    mrr_by_currency: dict[str, int] = {}
    for s in subs:
        for item in s.get("items", {}).get("data", []):
            price = item.get("price") or {}
            amount = price.get("unit_amount") or 0
            currency = (price.get("currency") or "usd").lower()
            interval = (price.get("recurring") or {}).get("interval", "month")
            qty = item.get("quantity") or 1
            monthly = amount * qty if interval == "month" else (amount * qty // 12 if interval == "year" else amount * qty)
            mrr_by_currency[currency] = mrr_by_currency.get(currency, 0) + monthly

    rev_by_currency: dict[str, int] = {}
    for c in charge_resp.json().get("data", []):
        if c.get("status") == "succeeded":
            cur = (c.get("currency") or "usd").lower()
            rev_by_currency[cur] = rev_by_currency.get(cur, 0) + (c.get("amount") or 0)

    mrr_str = ", ".join(_format_money(v, k) for k, v in mrr_by_currency.items()) or "0"
    rev_str = ", ".join(_format_money(v, k) for k, v in rev_by_currency.items()) or "0"

    return (
        f"Active subscriptions: {len(subs)}\n"
        f"MRR estimate: {mrr_str}\n"
        f"Last 30 days revenue (succeeded charges, capped at 100): {rev_str}"
    )
