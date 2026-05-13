"""LinkedIn tools — post and read on behalf of the founder.

LinkedIn requires a Member URN (e.g. 'urn:li:person:abc') on every UGC
post. We resolve it on demand via /v2/me on each call — simpler than
caching on IntegrationConnection, and the call is cheap. If perf ever
matters, cache in process memory; not worth the schema change today.

Auth priority: IntegrationConnection (toolkit='linkedin', status='active')
→ LINKEDIN_ACCESS_TOKEN env. All tools return strings.
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

_LI_API = "https://api.linkedin.com/v2"
_TIMEOUT = 20.0


async def _get_linkedin_token(space_id: str) -> str | None:
    if space_id:
        try:
            db = await supabase()
            res = await (
                db.table("IntegrationConnection")
                .select("accessToken")
                .eq("spaceId", space_id)
                .eq("toolkit", "linkedin")
                .eq("status", "active")
                .maybe_single()
                .execute()
            )
            if res.data and res.data.get("accessToken"):
                return res.data["accessToken"]
        except Exception as err:  # noqa: BLE001
            logger.warning("linkedin_token_lookup_failed", space_id=space_id, error=str(err)[:200])

    return os.environ.get("LINKEDIN_ACCESS_TOKEN")


def _auth_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
    }


def _handle_response(resp: httpx.Response, action: str) -> str | None:
    if resp.status_code == 401:
        return f"LinkedIn auth failed for {action}. Reconnect LinkedIn in settings or refresh LINKEDIN_ACCESS_TOKEN."
    if resp.status_code == 403:
        return f"LinkedIn permission denied for {action}. Token may lack required scopes (w_member_social/r_liteprofile)."
    if resp.status_code == 429:
        return f"LinkedIn rate limit hit for {action}. Retry after cooldown."
    if not resp.is_success:
        body: dict[str, Any] = {}
        try:
            body = resp.json()
        except Exception:  # noqa: BLE001
            pass
        msg = body.get("message") or resp.text[:200]
        return f"LinkedIn API error {resp.status_code} for {action}: {msg}"
    return None


async def _get_member_urn(client: httpx.AsyncClient, token: str) -> str:
    """Resolve the authenticated member URN via /v2/me. Returns urn or error string."""
    resp = await client.get(f"{_LI_API}/me", headers=_auth_headers(token))
    err = _handle_response(resp, "get_me")
    if err:
        return err
    member_id = (resp.json() or {}).get("id")
    if not member_id:
        return "LinkedIn: could not resolve member id."
    return f"urn:li:person:{member_id}"


@function_tool
async def linkedin_post(
    text: str,
    visibility: str = "PUBLIC",
    space_id: str = "",
) -> str:
    """Post text to the connected member's LinkedIn feed. Returns the post URL.

    visibility: 'PUBLIC' (default, visible to anyone) or 'CONNECTIONS'.
    """

    async def _execute() -> str:
        token = await _get_linkedin_token(space_id)
        if not token:
            return "No LinkedIn token found. Connect LinkedIn in settings or set LINKEDIN_ACCESS_TOKEN."

        vis = visibility.upper() if visibility else "PUBLIC"
        if vis not in {"PUBLIC", "CONNECTIONS"}:
            vis = "PUBLIC"

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            urn = await _get_member_urn(client, token)
            if not urn.startswith("urn:li:person:"):
                return urn  # error string

            payload = {
                "author": urn,
                "lifecycleState": "PUBLISHED",
                "specificContent": {
                    "com.linkedin.ugc.ShareContent": {
                        "shareCommentary": {"text": text},
                        "shareMediaCategory": "NONE",
                    }
                },
                "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": vis},
            }

            resp = await client.post(
                f"{_LI_API}/ugcPosts",
                headers=_auth_headers(token),
                json=payload,
            )

        err = _handle_response(resp, "post")
        if err:
            return err

        # The post id can come back in the body or the x-restli-id header.
        data = resp.json() if resp.content else {}
        post_id = data.get("id") or resp.headers.get("x-restli-id", "")
        url = f"https://www.linkedin.com/feed/update/{post_id}/" if post_id else ""
        logger.info("linkedin_post_created", space_id=space_id, post_id=post_id)
        return f"Posted: {url}" if url else "LinkedIn post created but no id returned."

    return await gate_or_execute(
        space_id=space_id,
        department="marketing",
        action_label=f"Post to LinkedIn: {text[:80]}",
        risk="high",
        execute_fn=_execute,
    )


@function_tool
async def linkedin_get_recent_posts(limit: int = 10, space_id: str = "") -> str:
    """List recent UGC posts authored by the connected member."""
    token = await _get_linkedin_token(space_id)
    if not token:
        return "No LinkedIn token found. Connect LinkedIn in settings or set LINKEDIN_ACCESS_TOKEN."

    limit = max(1, min(limit, 50))

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        urn = await _get_member_urn(client, token)
        if not urn.startswith("urn:li:person:"):
            return urn

        resp = await client.get(
            f"{_LI_API}/ugcPosts",
            headers=_auth_headers(token),
            params={"q": "authors", "authors": f"List({urn})", "count": limit},
        )

    err = _handle_response(resp, "get_recent_posts")
    if err:
        return err

    elements = (resp.json() or {}).get("elements") or []
    if not elements:
        return "No recent posts."
    lines: list[str] = []
    for p in elements:
        post_id = p.get("id", "")
        created = (p.get("created") or {}).get("time", "")
        text = (
            ((p.get("specificContent") or {}).get("com.linkedin.ugc.ShareContent") or {})
            .get("shareCommentary", {})
            .get("text", "")
        )
        lines.append(f"{post_id} [{created}]: {text[:200]}")
    return "\n".join(lines)
