"""OpenAI Images (DALL-E / gpt-image-1) generation and edit tools.

Direct REST calls — no openai SDK dependency. Keeps the failure surface
small and the auth path explicit. Returns image URLs as newline-joined
strings so the agent can hand them to a renderer or to a downstream step.

Auth: IntegrationConnection (toolkit='openai') → OPENAI_API_KEY env.
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

_OPENAI_API = "https://api.openai.com/v1"
_TIMEOUT = 60.0
_MAX_N = 4


async def _get_openai_key(space_id: str) -> str | None:
    if space_id:
        try:
            db = await supabase()
            res = await (
                db.table("IntegrationConnection")
                .select("accessToken")
                .eq("spaceId", space_id)
                .eq("toolkit", "openai")
                .eq("status", "active")
                .maybe_single()
                .execute()
            )
            if res.data and res.data.get("accessToken"):
                return res.data["accessToken"]
        except Exception as err:  # noqa: BLE001
            logger.warning("openai_key_lookup_failed", space_id=space_id, error=str(err)[:200])

    return os.environ.get("OPENAI_API_KEY")


def _extract_urls(body: dict[str, Any]) -> list[str]:
    urls: list[str] = []
    for item in body.get("data", []) or []:
        url = item.get("url")
        if url:
            urls.append(url)
            continue
        # gpt-image-1 returns b64_json by default; surface that as a data: URI.
        b64 = item.get("b64_json")
        if b64:
            urls.append(f"data:image/png;base64,{b64}")
    return urls


def _error_string(resp: httpx.Response, action: str) -> str:
    body: dict[str, Any] = {}
    try:
        body = resp.json()
    except Exception:  # noqa: BLE001
        pass
    msg = (body.get("error") or {}).get("message") or resp.text[:200]
    return f"OpenAI {action} error {resp.status_code}: {msg}"


@function_tool
async def openai_generate_image(
    prompt: str,
    size: str = "1024x1024",
    model: str = "gpt-image-1",
    n: int = 1,
    space_id: str = "",
) -> str:
    """Generate `n` images. Returns URL(s) joined by newlines or an error string."""

    async def _execute() -> str:
        key = await _get_openai_key(space_id)
        if not key:
            return "No OpenAI key found. Connect OpenAI in settings or set OPENAI_API_KEY."

        n_clamped = max(1, min(n, _MAX_N))

        payload: dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "n": n_clamped,
            "size": size,
        }

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                f"{_OPENAI_API}/images/generations",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json=payload,
            )

        if not resp.is_success:
            return _error_string(resp, "generate_image")

        urls = _extract_urls(resp.json())
        if not urls:
            return "OpenAI returned no images."
        logger.info("openai_image_generated", space_id=space_id, count=len(urls))
        return "\n".join(urls)

    return await gate_or_execute(
        space_id=space_id,
        department="marketing",
        action_label=f"Generate image with prompt: {prompt[:80]}",
        risk="low",
        execute_fn=_execute,
    )


@function_tool
async def openai_edit_image(
    prompt: str,
    image_url: str,
    mask_url: str = "",
    space_id: str = "",
) -> str:
    """Edit an existing image. Returns URL(s) joined by newlines or an error string."""

    async def _execute() -> str:
        key = await _get_openai_key(space_id)
        if not key:
            return "No OpenAI key found. Connect OpenAI in settings or set OPENAI_API_KEY."

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            img_resp = await client.get(image_url)
            if not img_resp.is_success:
                return f"Could not fetch image from {image_url}: {img_resp.status_code}"
            files: list[tuple[str, tuple[str, bytes, str]]] = [
                ("image", ("image.png", img_resp.content, "image/png")),
            ]
            if mask_url:
                mask_resp = await client.get(mask_url)
                if not mask_resp.is_success:
                    return f"Could not fetch mask from {mask_url}: {mask_resp.status_code}"
                files.append(("mask", ("mask.png", mask_resp.content, "image/png")))

            data = {"prompt": prompt, "model": "gpt-image-1"}
            resp = await client.post(
                f"{_OPENAI_API}/images/edits",
                headers={"Authorization": f"Bearer {key}"},
                data=data,
                files=files,
            )

        if not resp.is_success:
            return _error_string(resp, "edit_image")

        urls = _extract_urls(resp.json())
        if not urls:
            return "OpenAI returned no edited images."
        return "\n".join(urls)

    return await gate_or_execute(
        space_id=space_id,
        department="marketing",
        action_label=f"Edit image with prompt: {prompt[:80]}",
        risk="low",
        execute_fn=_execute,
    )
