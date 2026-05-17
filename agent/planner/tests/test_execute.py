"""Unit tests for the planner's DAG walker.

The walker is pure algorithm — the LLM-touching parts (decompose,
verify) are integration-style and not unit-tested here. The walker
has real edge cases: dependency propagation when a step fails,
parallel firing of independent steps, refusal of malformed graphs.
Those are what this file pins.

Run: `pytest agent/planner/tests/` from the repo root, after
installing agent deps (`pip install -e agent` or equivalent).
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable

import pytest

from planner.execute import (
    ExecutionReport,
    PlanValidationError,
    StepStatus,
    execute_plan,
    validate_plan_dag,
)
from planner.types import Plan, PlanStep


def _step(
    dept: str,
    task: str,
    expected: str = "step done",
    depends_on: list[int] | None = None,
) -> PlanStep:
    # task / expected default values padded to satisfy the
    # types.PlanStep min_length=4 schema constraint.
    return PlanStep(
        department=dept,  # type: ignore[arg-type]
        task=task if len(task) >= 4 else task.ljust(4, "."),
        expected_outcome=expected,
        depends_on=depends_on or [],
    )


def _plan(*steps: PlanStep, goal: str = "g", summary: str = "do the thing") -> Plan:
    return Plan(goal=goal, summary=summary, steps=list(steps))


# ── validate_plan_dag ──────────────────────────────────────────────────


def test_validate_rejects_out_of_range_dep() -> None:
    p = _plan(_step("engineering", "a", depends_on=[5]))
    with pytest.raises(PlanValidationError, match="out-of-range"):
        validate_plan_dag(p)


def test_validate_rejects_self_dependency() -> None:
    p = _plan(_step("engineering", "a", depends_on=[0]))
    with pytest.raises(PlanValidationError, match="depends on itself"):
        validate_plan_dag(p)


def test_validate_rejects_cycle() -> None:
    p = _plan(
        _step("engineering", "a", depends_on=[1]),
        _step("marketing", "b", depends_on=[0]),
    )
    with pytest.raises(PlanValidationError, match="cycle"):
        validate_plan_dag(p)


def test_validate_accepts_diamond() -> None:
    # 0 → 1, 0 → 2, 1 → 3, 2 → 3 — common diamond pattern, valid DAG.
    p = _plan(
        _step("engineering", "root"),
        _step("marketing", "left", depends_on=[0]),
        _step("design", "right", depends_on=[0]),
        _step("ops_finance", "join", depends_on=[1, 2]),
    )
    validate_plan_dag(p)  # does not raise


# ── execute_plan ───────────────────────────────────────────────────────


async def _ok_runner(step: PlanStep, idx: int) -> str:
    return f"[{step.department}] done: {step.task}"


@pytest.mark.asyncio
async def test_executes_linear_chain() -> None:
    p = _plan(
        _step("engineering", "a"),
        _step("marketing", "b", depends_on=[0]),
        _step("design", "c", depends_on=[1]),
    )
    report = await execute_plan(p, _ok_runner)
    assert report.all_succeeded
    assert [r.status for r in report.results] == [
        StepStatus.COMPLETED,
        StepStatus.COMPLETED,
        StepStatus.COMPLETED,
    ]


@pytest.mark.asyncio
async def test_runs_independent_steps_in_parallel() -> None:
    """If three steps have no deps and the runner takes 50ms each, the
    parallel walker should finish in ~50ms, not ~150ms."""
    import time

    async def slow_runner(step: PlanStep, idx: int) -> str:
        await asyncio.sleep(0.05)
        return "ok"

    p = _plan(
        _step("engineering", "a"),
        _step("marketing", "b"),
        _step("design", "c"),
    )
    t0 = time.monotonic()
    report = await execute_plan(p, slow_runner)
    elapsed = time.monotonic() - t0
    assert report.all_succeeded
    # Generous bound: parallel should finish in under ~100ms (one
    # sleep, plus scheduling). Serial would be ~150ms+.
    assert elapsed < 0.13, f"expected parallel execution, took {elapsed:.3f}s"


@pytest.mark.asyncio
async def test_failure_blocks_dependents_but_not_siblings() -> None:
    """Step 0 fails. Step 1 depends on 0 → blocked. Step 2 is
    independent → still runs."""

    async def runner(step: PlanStep, idx: int) -> str:
        if idx == 0:
            raise RuntimeError("boom")
        return "ok"

    p = _plan(
        _step("engineering", "fails"),
        _step("marketing", "dependent", depends_on=[0]),
        _step("design", "independent"),
    )
    report = await execute_plan(p, runner)
    assert report.results[0].status == StepStatus.FAILED
    assert report.results[1].status == StepStatus.BLOCKED
    assert report.results[2].status == StepStatus.COMPLETED


@pytest.mark.asyncio
async def test_blocked_propagates_transitively() -> None:
    """0 fails → 1 blocked (depends on 0) → 2 blocked (depends on 1)."""

    async def runner(step: PlanStep, idx: int) -> str:
        if idx == 0:
            raise RuntimeError("boom")
        return "ok"

    p = _plan(
        _step("engineering", "fails"),
        _step("marketing", "dep1", depends_on=[0]),
        _step("design", "dep2", depends_on=[1]),
    )
    report = await execute_plan(p, runner)
    assert [r.status for r in report.results] == [
        StepStatus.FAILED,
        StepStatus.BLOCKED,
        StepStatus.BLOCKED,
    ]


@pytest.mark.asyncio
async def test_runner_returning_error_string_counts_as_completed() -> None:
    """The runner is contractually supposed to return a string; only
    raised exceptions are flagged as FAILED. A returned '[dept] Failed: ...'
    string is treated as a normal completion — the executor doesn't
    inspect output strings to second-guess success. The verifier does.
    """

    async def runner(step: PlanStep, idx: int) -> str:
        return f"[{step.department}] Failed: deliberate error"

    p = _plan(_step("engineering", "a"))
    report = await execute_plan(p, runner)
    assert report.results[0].status == StepStatus.COMPLETED
    assert "Failed: deliberate error" in report.results[0].output


@pytest.mark.asyncio
async def test_single_step_plan() -> None:
    p = _plan(_step("engineering", "only"))
    report = await execute_plan(p, _ok_runner)
    assert len(report.results) == 1
    assert report.all_succeeded


@pytest.mark.asyncio
async def test_format_report_has_one_block_per_step() -> None:
    p = _plan(
        _step("engineering", "a"),
        _step("marketing", "b"),
    )
    report = await execute_plan(p, _ok_runner)
    out = report.format()
    assert "[engineering]" in out
    assert "[marketing]" in out
    assert "COMPLETED" in out


@pytest.mark.asyncio
async def test_diamond_executes_in_correct_order() -> None:
    """Diamond: 0 first, then 1 + 2 in parallel, then 3 after both."""
    started: list[int] = []
    finished: list[int] = []

    async def tracking_runner(step: PlanStep, idx: int) -> str:
        started.append(idx)
        await asyncio.sleep(0.01)
        finished.append(idx)
        return "ok"

    p = _plan(
        _step("engineering", "root"),
        _step("marketing", "left", depends_on=[0]),
        _step("design", "right", depends_on=[0]),
        _step("ops_finance", "join", depends_on=[1, 2]),
    )
    report = await execute_plan(p, tracking_runner)
    assert report.all_succeeded
    # 0 must finish before 1 and 2 start (since 1 and 2 depend on 0).
    finish_0 = finished.index(0)
    start_1 = started.index(1)
    start_2 = started.index(2)
    assert start_1 > finish_0
    assert start_2 > finish_0
    # 3 must start only after both 1 and 2 finish.
    finish_1 = finished.index(1)
    finish_2 = finished.index(2)
    start_3 = started.index(3)
    assert start_3 > max(finish_1, finish_2)
