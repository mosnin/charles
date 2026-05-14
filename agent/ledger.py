"""Step cost/execution ledger for autonomous agent runs.

Records every LLM call and tool invocation into ExecutionStep rows and keeps
AgentTask.estimatedCostUsd in sync. All DB writes are non-blocking — failures
are logged and swallowed so a ledger hiccup never kills a live agent run.

Column mapping (spec term → actual DB column):
  step_type    → toolName prefix  (e.g. "llm_call", "tool_call")
  tool_name    → toolName
  input_summary  → toolArgs  (stored as {"summary": ...})
  output_summary → toolResult (stored as {"summary": ...})
  tokens_in    → inputTokens
  tokens_out   → outputTokens
  error        → errorMessage
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog

from db import supabase

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Pricing table — per 1M tokens, USD
# ---------------------------------------------------------------------------

MODEL_PRICES: dict[str, dict[str, float]] = {
    "gpt-5-mini":   {"in": 0.75, "out": 4.50},
    "gpt-5.4-mini": {"in": 0.75, "out": 4.50},
    "gpt-4.1-mini": {"in": 0.40, "out": 1.60},
    "gpt-4o":       {"in": 2.50, "out": 10.00},
    "gpt-4.1":      {"in": 2.00, "out": 8.00},
    "gpt-4o-mini":  {"in": 0.15, "out": 0.60},
}
_DEFAULT_PRICE = {"in": 2.50, "out": 10.00}


def _calculate_cost(model: str, tokens_in: int, tokens_out: int) -> float:
    """Return cost in USD, rounded to 6 decimal places (matches numeric(10,6))."""
    prices = MODEL_PRICES.get(model, _DEFAULT_PRICE)
    cost = (tokens_in / 1_000_000) * prices["in"] + (tokens_out / 1_000_000) * prices["out"]
    return round(cost, 6)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# StepLedger
# ---------------------------------------------------------------------------

class StepLedger:
    """Records ExecutionStep rows and increments AgentTask cost totals.

    Usage::

        ledger = StepLedger(space_id="abc", task_id="xyz")
        step_id = await ledger.start_step("llm_call", "gpt-4o", "Summarise lead")
        await ledger.complete_step(step_id, "Done", tokens_in=500, tokens_out=120, cost_usd=0.002)

    Or the convenience wrapper for a full LLM call::

        await ledger.record_llm_call(
            tool_name="charles",
            input_summary="Autonomous sweep prompt",
            output_summary="Drafted follow-up email",
            model="gpt-4o",
            tokens_in=1200,
            tokens_out=300,
        )
    """

    def __init__(self, space_id: str, task_id: str | None = None) -> None:
        self.space_id = space_id
        self.task_id = task_id
        # Track the next stepIndex per task to satisfy the NOT NULL constraint.
        # Scoped to this ledger instance (one per agent run), so concurrent runs
        # don't clash — each run has its own StepLedger.
        self._step_index = 0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def start_step(
        self,
        step_type: str,
        tool_name: str | None,
        input_summary: str,
    ) -> str:
        """Insert an ExecutionStep row with status='running'. Returns the step id.

        If no task_id was provided at construction time, the DB insert is skipped
        (ExecutionStep.taskId is a NOT NULL FK) and a local-only UUID is returned.
        Subsequent complete_step / fail_step calls with that id are no-ops at the
        DB layer — all errors are caught so the agent run is never interrupted.
        """
        step_id = str(uuid.uuid4())
        effective_tool_name = tool_name or step_type
        step_index = self._step_index
        self._step_index += 1

        if not self.task_id:
            # Cannot insert without a valid FK — return a local id for tracking only.
            logger.debug(
                "ledger_start_step_no_task_id",
                step_id=step_id,
                space_id=self.space_id,
                tool_name=effective_tool_name,
            )
            return step_id

        try:
            db = await supabase()
            await (
                db.table("ExecutionStep")
                .insert({
                    "id": step_id,
                    "taskId": self.task_id,
                    "spaceId": self.space_id,
                    "stepIndex": step_index,
                    "toolName": effective_tool_name,
                    "toolArgs": {"summary": input_summary, "stepType": step_type},
                    "status": "running",
                    "startedAt": _now_iso(),
                    "inputTokens": 0,
                    "outputTokens": 0,
                    "costUsd": 0,
                })
                .execute()
            )
        except Exception:
            logger.exception(
                "ledger_start_step_failed",
                step_id=step_id,
                space_id=self.space_id,
                tool_name=effective_tool_name,
            )

        return step_id

    async def complete_step(
        self,
        step_id: str,
        output_summary: str,
        tokens_in: int = 0,
        tokens_out: int = 0,
        cost_usd: float = 0.0,
    ) -> None:
        """Update the step to status='completed' and fill token/cost fields."""
        try:
            db = await supabase()
            await (
                db.table("ExecutionStep")
                .update({
                    "status": "completed",
                    "toolResult": {"summary": output_summary},
                    "inputTokens": tokens_in,
                    "outputTokens": tokens_out,
                    "costUsd": round(cost_usd, 6),
                    "completedAt": _now_iso(),
                })
                .eq("id", step_id)
                .execute()
            )
        except Exception:
            logger.exception(
                "ledger_complete_step_failed",
                step_id=step_id,
                space_id=self.space_id,
            )
            return

        if cost_usd > 0 and self.task_id:
            await self._increment_task_cost(tokens_in, tokens_out, cost_usd)

    async def fail_step(self, step_id: str, error: str) -> None:
        """Update the step to status='failed' with an error message."""
        try:
            db = await supabase()
            await (
                db.table("ExecutionStep")
                .update({
                    "status": "failed",
                    "errorMessage": error[:2000],  # guard against huge tracebacks
                    "completedAt": _now_iso(),
                })
                .eq("id", step_id)
                .execute()
            )
        except Exception:
            logger.exception(
                "ledger_fail_step_failed",
                step_id=step_id,
                space_id=self.space_id,
            )

    async def record_llm_call(
        self,
        tool_name: str,
        input_summary: str,
        output_summary: str,
        model: str,
        tokens_in: int,
        tokens_out: int,
    ) -> None:
        """Convenience: start + complete a single LLM call step, computing cost."""
        cost_usd = _calculate_cost(model, tokens_in, tokens_out)
        step_id = await self.start_step("llm_call", tool_name, input_summary)
        await self.complete_step(
            step_id,
            output_summary=output_summary,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=cost_usd,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _increment_task_cost(
        self, tokens_in: int, tokens_out: int, cost_usd: float
    ) -> None:
        """Increment AgentTask token and cost totals via a read-then-write pattern.

        The RPC `increment_agent_task_cost` is not defined in the current
        migrations, so we fall back to a plain select + update. Races between
        concurrent runs are acceptable — this is an approximate audit trail.
        """
        if not self.task_id:
            return
        try:
            db = await supabase()
            result = await (
                db.table("AgentTask")
                .select("inputTokens,outputTokens,estimatedCostUsd")
                .eq("id", self.task_id)
                .maybe_single()
                .execute()
            )
            row = result.data
            if not row:
                logger.warning(
                    "ledger_task_not_found",
                    task_id=self.task_id,
                    space_id=self.space_id,
                )
                return

            new_cost = round(float(row["estimatedCostUsd"]) + cost_usd, 6)
            await (
                db.table("AgentTask")
                .update({
                    "inputTokens": int(row["inputTokens"]) + tokens_in,
                    "outputTokens": int(row["outputTokens"]) + tokens_out,
                    "estimatedCostUsd": new_cost,
                    "updatedAt": _now_iso(),
                })
                .eq("id", self.task_id)
                .execute()
            )
        except Exception:
            logger.exception(
                "ledger_increment_task_cost_failed",
                task_id=self.task_id,
                space_id=self.space_id,
            )

