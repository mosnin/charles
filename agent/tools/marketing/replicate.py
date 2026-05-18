"""Replicate image / video generation tools.

Replicate runs open-source generative models behind a uniform REST API.
We poll prediction status synchronously up to a short ceiling — long
generations are rare; if it doesn't finish in time the founder gets the
prediction id back and can check on it later.

Auth: IntegrationConnection (toolkit='replicate') → REPLICATE_API_TOKEN env.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

import httpx
import structlog

from agents import function_tool
from db import supabase
from tools._approval import gate_or_execute

logger = structlog.get_logger(__name__)

_REPLICATE_API = "https://api.replicate.com/v1"
_TIMEOUT = 30.0
_POLL_INTERVAL = 2.0
_MAX_WAIT_IMAGE = 60.0
_MAX_WAIT_VIDEO = 120.0


async def _get_replicate_token(space_id: str) -> str | None:
    if space_id:
        try:
            db = await supabase()
            res = await (
                db.table("IntegrationConnection")
                .select("accessToken")
                .eq("spaceId", space_id)
                .eq("toolkit", "replicate")
                .eq("status", "active")
                .maybe_single()
                .execute()
            )
            if res.data and res.data.get("accessToken"):
                return res.data["accessToken"]
        except Exception as err:  # noqa: BLE001
            logger.warning("replicate_token_lookup_failed", space_id=space_id, error=str(err)[:200])

    return os.environ.get("REPLICATE_API_TOKEN")


def _auth_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def _normalize_output(output: Any) -> str:
    if output is None:
        return ""
    if isinstance(output, str):
        return output
    if isinstance(output, list):
        return "\n".join(str(o) for o in output)
    return str(output)


async def _create_prediction(
    client: httpx.AsyncClient,
    token: str,
    model: str,
    input_payload: dict[str, Any],
) -> tuple[dict[str, Any] | None, str | None]:
    """POST to /models/{model}/predictions. Returns (data, error_string)."""
    resp = await client.post(
        f"{_REPLICATE_API}/models/{model}/predictions",
        headers=_auth_headers(token),
        json={"input": input_payload},
    )
    if resp.status_code == 401:
        return None, "Replicate auth failed. Check token or reconnect Replicate in settings."
    if resp.status_code == 402:
        return None, "Replicate billing issue: insufficient credits or payment required."
    if resp.status_code == 429:
        return None, "Replicate rate limit hit. Retry shortly."
    if not resp.is_success:
        body: dict[str, Any] = {}
        try:
            body = resp.json()
        except Exception:  # noqa: BLE001
            pass
        return None, f"Replicate error {resp.status_code}: {body.get('detail', resp.text[:200])}"

    return resp.json(), None


async def _poll_until_done(
    client: httpx.AsyncClient,
    token: str,
    prediction_id: str,
    max_wait: float,
) -> dict[str, Any]:
    """Poll the prediction endpoint until terminal or timeout."""
    waited = 0.0
    while waited < max_wait:
        resp = await client.get(
            f"{_REPLICATE_API}/predictions/{prediction_id}",
            headers=_auth_headers(token),
        )
        if not resp.is_success:
            return {"status": "polling_error", "id": prediction_id, "error": resp.text[:200]}
        data = resp.json()
        status = data.get("status")
        if status in ("succeeded", "failed", "canceled"):
            return data
        await asyncio.sleep(_POLL_INTERVAL)
        waited += _POLL_INTERVAL
    return {"status": "timeout", "id": prediction_id}


@function_tool
async def replicate_generate_image(
    prompt: str,
    model: str = "black-forest-labs/flux-schnell",
    aspect_ratio: str = "1:1",
    space_id: str = "",
) -> str:
    """Generate an image with Replicate. Returns the output URL or an error string."""

    async def _execute() -> str:
        token = await _get_replicate_token(space_id)
        if not token:
            return "No Replicate token found. Connect Replicate in settings or set REPLICATE_API_TOKEN."

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            data, err = await _create_prediction(
                client,
                token,
                model,
                {"prompt": prompt, "aspect_ratio": aspect_ratio},
            )
            if err:
                return err
            assert data is not None
            pred_id = data.get("id", "")
            status = data.get("status", "")
            if status in ("succeeded", "failed", "canceled"):
                final = data
            else:
                final = await _poll_until_done(client, token, pred_id, _MAX_WAIT_IMAGE)

        status = final.get("status", "")
        if status == "succeeded":
            out = _normalize_output(final.get("output"))
            logger.info("replicate_image_generated", space_id=space_id, prediction=pred_id)
            return out or f"Generation succeeded but returned no output. Prediction id {pred_id}."
        if status == "failed":
            return f"Replicate generation failed: {final.get('error') or 'unknown error'}"
        if status == "timeout":
            return f"Generation still running. Check prediction ID {pred_id} later."
        return f"Replicate generation ended with status={status}. Prediction ID {pred_id}."

    return await gate_or_execute(
        space_id=space_id,
        department="marketing",
        action_label=f"Generate image with prompt: {prompt[:80]}",
        risk="low",
        execute_fn=_execute,
    )


@function_tool
async def replicate_generate_video(
    prompt: str,
    model: str = "minimax/video-01",
    duration_seconds: int = 6,
    space_id: str = "",
) -> str:
    """Generate a video with Replicate. Returns the output URL or an error string."""

    async def _execute() -> str:
        token = await _get_replicate_token(space_id)
        if not token:
            return "No Replicate token found. Connect Replicate in settings or set REPLICATE_API_TOKEN."

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            data, err = await _create_prediction(
                client,
                token,
                model,
                {"prompt": prompt, "duration": duration_seconds},
            )
            if err:
                return err
            assert data is not None
            pred_id = data.get("id", "")
            status = data.get("status", "")
            if status in ("succeeded", "failed", "canceled"):
                final = data
            else:
                final = await _poll_until_done(client, token, pred_id, _MAX_WAIT_VIDEO)

        status = final.get("status", "")
        if status == "succeeded":
            out = _normalize_output(final.get("output"))
            logger.info("replicate_video_generated", space_id=space_id, prediction=pred_id)
            return out or f"Generation succeeded but returned no output. Prediction id {pred_id}."
        if status == "failed":
            return f"Replicate generation failed: {final.get('error') or 'unknown error'}"
        if status == "timeout":
            return f"Generation still running. Check prediction ID {pred_id} later."
        return f"Replicate generation ended with status={status}. Prediction ID {pred_id}."

    return await gate_or_execute(
        space_id=space_id,
        department="marketing",
        action_label=f"Generate video with prompt: {prompt[:80]}",
        risk="low",
        execute_fn=_execute,
    )


@function_tool
async def replicate_get_prediction(prediction_id: str, space_id: str = "") -> str:
    """Read the current status + output of a Replicate prediction by id."""
    token = await _get_replicate_token(space_id)
    if not token:
        return "No Replicate token found. Connect Replicate in settings or set REPLICATE_API_TOKEN."

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(
            f"{_REPLICATE_API}/predictions/{prediction_id}",
            headers=_auth_headers(token),
        )

    if resp.status_code == 404:
        return f"Prediction {prediction_id} not found."
    if not resp.is_success:
        return f"Replicate error {resp.status_code} fetching prediction {prediction_id}: {resp.text[:200]}"

    data = resp.json()
    status = data.get("status", "unknown")
    if status == "succeeded":
        return f"status=succeeded output={_normalize_output(data.get('output'))}"
    if status == "failed":
        return f"status=failed error={data.get('error') or 'unknown'}"
    return f"status={status} (prediction {prediction_id})"
