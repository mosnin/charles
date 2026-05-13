"""Best-effort cost event logging for the agent runtime.

Mirrors lib/observability/cost-events.ts. Never raises — costs are
observability, not correctness; a failed insert can't break a run.
Keep the model price table in sync with the TS file; that file is the
source of truth.
"""

from __future__ import annotations

import logging
from typing import Literal

from db import supabase

log = logging.getLogger(__name__)

Department = Literal[
    "engineering",
    "sales",
    "marketing",
    "design",
    "support",
    "ops_finance",
    "manager",
    "in_process",
]

# Prices last reviewed 2026-05; cross-check provider pricing pages quarterly.
# Source of truth: lib/observability/cost-events.ts. Tuple = (input_per_1m, output_per_1m).
_MODEL_PRICES: dict[str, tuple[float, float]] = {
    "gpt-5":             (1.25, 10.00),
    "gpt-5-mini":        (0.25, 2.00),
    "gpt-5-nano":        (0.05, 0.40),
    "claude-opus-4-7":   (15.00, 75.00),
    "claude-sonnet-4-6": (3.00, 15.00),
    "claude-haiku-4-5":  (0.80, 4.00),
    "gpt-4o-mini":       (0.15, 0.60),
}

_warned_unknown_models: set[str] = set()


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Estimate USD cost. Unknown model → 0.0 (warn once)."""
    prices = _MODEL_PRICES.get(model)
    if prices is None:
        if model not in _warned_unknown_models:
            _warned_unknown_models.add(model)
            log.warning(
                "cost_events.unknown_model model=%s — add it to _MODEL_PRICES.",
                model,
            )
        return 0.0
    in_per_1m, out_per_1m = prices
    in_cost = (max(0, input_tokens) / 1_000_000) * in_per_1m
    out_cost = (max(0, output_tokens) / 1_000_000) * out_per_1m
    # Round to six decimals — matches the column's numeric(12,6).
    return round(in_cost + out_cost, 6)


async def emit_cost_event(
    *,
    space_id: str,
    department: Department | None,
    model: str,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cost_usd: float | None = None,
    run_id: str | None = None,
    tool_name: str | None = None,
) -> None:
    """Insert one CostEvent row. Best-effort: never raises."""
    try:
        if not space_id or not model:
            log.warning("cost_events.skip reason=missing_space_or_model")
            return

        cost = (
            cost_usd
            if cost_usd is not None
            else estimate_cost(model, input_tokens, output_tokens)
        )

        row: dict[str, object] = {
            "spaceId": space_id,
            "department": department,
            "model": model,
            "inputTokens": int(input_tokens or 0),
            "outputTokens": int(output_tokens or 0),
            "costUsd": float(cost),
        }
        if run_id:
            row["runId"] = run_id
        if tool_name:
            row["toolName"] = tool_name

        db = await supabase()
        await db.table("CostEvent").insert(row).execute()
    except Exception as exc:  # noqa: BLE001
        log.warning("cost_events.insert_failed error=%s", exc)


# Test-only helper for resetting the warned-model cache.
def _reset_warned_models() -> None:
    _warned_unknown_models.clear()
