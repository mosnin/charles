"""Twitter (X) tools — post and read on behalf of the founder.

Auth priority: IntegrationConnection (toolkit='twitter', status='active')
→ TWITTER_BEARER_TOKEN env. Tokens are OAuth 2.0 user-context bearer
tokens — the same shape works for read + write on v2 endpoints.

All tools return strings (URLs or error descriptions). Wave 2 wraps the
mutating tool with the approval gate at the manager layer.
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

_TWITTER_API = "https://api.twitter.com/2"
_TIMEOUT = 20.0


async def _get_twitter_token(space_id: str) -> str | None:
    if space_id:
        try:
            db = await supabase()
            res = await (
                db.table("IntegrationConnection")
                .select("accessToken")
                .eq("spaceId", space_id)
                .eq("toolkit", "twitter")
                .eq("status", "active")
                .maybe_single()
                .execute()
            )
            if res.data and res.data.get("accessToken"):
                return res.data["accessToken"]
        except Exception as err:  # noqa: BLE001
            logger.warning("twitter_token_lookup_failed", space_id=space_id, error=str(err)[:200])

    return os.environ.get("TWITTER_BEARER_TOKEN")


def _auth_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def _handle_response(resp: httpx.Response, action: str) -> str | None:
    if resp.status_code == 401:
        return f"Twitter auth failed for {action}. Reconnect X in settings or refresh TWITTER_BEARER_TOKEN."
    if resp.status_code == 403:
        return f"Twitter permission denied for {action}. Token may lack required scopes (tweet.write/users.read)."
    if resp.status_code == 429:
        return f"Twitter rate limit hit for {action}. Retry after cooldown."
    if not resp.is_success:
        body: dict[str, Any] = {}
        try:
            body = resp.json()
        except Exception:  # noqa: BLE001
            pass
        msg = body.get("detail") or body.get("title") or resp.text[:200]
        return f"Twitter API error {resp.status_code} for {action}: {msg}"
    return None


async def _get_me(client: httpx.AsyncClient, token: str) -> dict[str, Any] | str:
    """Return the authenticated user's profile dict, or an error string."""
    resp = await client.get(
        f"{_TWITTER_API}/users/me",
        headers=_auth_headers(token),
        params={"user.fields": "public_metrics,username"},
    )
    err = _handle_response(resp, "get_me")
    if err:
        return err
    return resp.json().get("data") or {}


@function_tool
async def twitter_post_tweet(
    text: str,
    reply_to_tweet_id: str = "",
    space_id: str = "",
) -> str:
    """Post a tweet. Returns the tweet URL on success.

    Optionally reply to an existing tweet by passing reply_to_tweet_id.
    """

    async def _execute() -> str:
        token = await _get_twitter_token(space_id)
        if not token:
            return "No Twitter token found. Connect X in settings or set TWITTER_BEARER_TOKEN."

        payload: dict[str, Any] = {"text": text}
        if reply_to_tweet_id:
            payload["reply"] = {"in_reply_to_tweet_id": reply_to_tweet_id}

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                f"{_TWITTER_API}/tweets",
                headers=_auth_headers(token),
                json=payload,
            )

        err = _handle_response(resp, "post_tweet")
        if err:
            return err

        data = (resp.json() or {}).get("data") or {}
        tweet_id = data.get("id", "")
        url = f"https://x.com/i/web/status/{tweet_id}" if tweet_id else ""
        logger.info("twitter_tweet_posted", space_id=space_id, tweet_id=tweet_id)
        return f"Tweeted: {url}" if url else "Tweet posted but no id returned."

    return await gate_or_execute(
        space_id=space_id,
        department="marketing",
        action_label=f"Post tweet: {text[:80]}",
        risk="high",
        execute_fn=_execute,
    )


@function_tool
async def twitter_get_recent_tweets(limit: int = 10, space_id: str = "") -> str:
    """List recent tweets authored by the connected account."""
    token = await _get_twitter_token(space_id)
    if not token:
        return "No Twitter token found. Connect X in settings or set TWITTER_BEARER_TOKEN."

    limit = max(5, min(limit, 100))  # X API requires 5-100

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        me = await _get_me(client, token)
        if isinstance(me, str):
            return me
        user_id = me.get("id")
        if not user_id:
            return "Twitter: could not resolve authenticated user id."

        resp = await client.get(
            f"{_TWITTER_API}/users/{user_id}/tweets",
            headers=_auth_headers(token),
            params={"max_results": limit, "tweet.fields": "created_at"},
        )

    err = _handle_response(resp, "get_recent_tweets")
    if err:
        return err

    tweets = (resp.json() or {}).get("data") or []
    if not tweets:
        return "No recent tweets."
    return "\n".join(
        f"{t.get('id')} [{t.get('created_at', '')}]: {t.get('text', '')[:200]}"
        for t in tweets
    )


@function_tool
async def twitter_get_account_metrics(space_id: str = "") -> str:
    """Return follower/following/tweet counts for the connected account."""
    token = await _get_twitter_token(space_id)
    if not token:
        return "No Twitter token found. Connect X in settings or set TWITTER_BEARER_TOKEN."

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        me = await _get_me(client, token)
        if isinstance(me, str):
            return me

    metrics = me.get("public_metrics") or {}
    handle = me.get("username", "")
    return (
        f"@{handle}\n"
        f"Followers: {metrics.get('followers_count', 0)}\n"
        f"Following: {metrics.get('following_count', 0)}\n"
        f"Tweets: {metrics.get('tweet_count', 0)}"
    )
