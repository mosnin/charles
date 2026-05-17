"""DAG executor — walks a Plan, fires ready nodes in parallel, repeats.

Pure algorithm. The `runner` callback is the boundary — pass in
`_run_one_dept` from the manager and the executor runs the plan
against real department sub-agents; pass in a fake and it's unit-
testable without LLM or DB.

Algorithm (textbook topological + early-finish):
  1. Find steps with no pending dependencies AND not already terminal.
  2. If none ready: stop. Either all done, or stuck behind a failure.
  3. Fire ready steps in parallel via asyncio.gather.
  4. Record success/failure for each.
  5. Propagate failure: any step whose dependency failed becomes
     'blocked' (terminal) — we don't run it.
  6. Goto 1.

Circular dependencies: detected up front by `validate_plan_dag` and
raised as PlanValidationError. The executor itself assumes a valid
DAG.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from enum import Enum

from planner.types import Plan, PlanStep


class StepStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    BLOCKED = "blocked"  # dependency failed; never ran


@dataclass
class StepResult:
    step_index: int
    status: StepStatus
    output: str = ""
    error: str = ""


@dataclass
class ExecutionReport:
    """Per-step terminal status + outputs, plus a roll-up summary."""

    plan: Plan
    results: list[StepResult] = field(default_factory=list)

    @property
    def all_succeeded(self) -> bool:
        return all(r.status == StepStatus.COMPLETED for r in self.results)

    def output_for(self, step_index: int) -> str:
        for r in self.results:
            if r.step_index == step_index:
                return r.output
        return ""

    def format(self) -> str:
        """Human-readable summary for the manager to relay to the
        founder. One block per step."""
        lines = []
        for r in self.results:
            step = self.plan.steps[r.step_index]
            head = f"[{step.department}] {r.status.value.upper()}"
            body = r.output if r.status == StepStatus.COMPLETED else (r.error or "(no output)")
            lines.append(f"{head} — {step.task}\n{body}")
        return "\n\n".join(lines)


class PlanValidationError(ValueError):
    """Raised when a plan's dependency graph is malformed (out-of-range
    indices, self-dependency, or cycle)."""


def validate_plan_dag(plan: Plan) -> None:
    """Reject malformed plans before execution.

    Catches: depends_on indices that point at nonexistent steps, self-
    dependencies, and cycles. The Pydantic types catch most shape
    issues; this is for the graph-level invariants Pydantic can't
    express.
    """
    n = len(plan.steps)
    for i, step in enumerate(plan.steps):
        for dep in step.depends_on:
            if dep < 0 or dep >= n:
                raise PlanValidationError(
                    f"Step {i} depends_on out-of-range index {dep} (plan has {n} steps)"
                )
            if dep == i:
                raise PlanValidationError(f"Step {i} depends on itself")

    # Cycle detection via DFS with three-colour marking.
    WHITE, GRAY, BLACK = 0, 1, 2
    colour = [WHITE] * n

    def dfs(node: int, path: list[int]) -> None:
        if colour[node] == GRAY:
            cycle = path[path.index(node):] + [node]
            raise PlanValidationError(
                f"Plan has a dependency cycle: {' -> '.join(str(c) for c in cycle)}"
            )
        if colour[node] == BLACK:
            return
        colour[node] = GRAY
        path.append(node)
        for dep in plan.steps[node].depends_on:
            dfs(dep, path)
        path.pop()
        colour[node] = BLACK

    for i in range(n):
        if colour[i] == WHITE:
            dfs(i, [])


RunnerFn = Callable[[PlanStep, int], Awaitable[str]]
"""Type of the per-step runner the caller supplies. Receives the step
and its index. Returns the step's textual output. Should NOT raise on
ordinary tool/agent failures — return an error string instead so the
executor can route it through the normal failure path. Truly
exceptional raises are caught and recorded as failures, defence-in-
depth.
"""


async def execute_plan(plan: Plan, runner: RunnerFn) -> ExecutionReport:
    """Walk the plan, firing ready steps in parallel, until done or stuck."""
    validate_plan_dag(plan)

    report = ExecutionReport(plan=plan)
    status: list[StepStatus] = [StepStatus.PENDING] * len(plan.steps)
    output: list[str] = [""] * len(plan.steps)

    while True:
        ready: list[int] = []
        for i, step in enumerate(plan.steps):
            if status[i] != StepStatus.PENDING:
                continue
            # Any failed/blocked dep → this step is blocked (terminal).
            if any(
                status[d] in (StepStatus.FAILED, StepStatus.BLOCKED)
                for d in step.depends_on
            ):
                status[i] = StepStatus.BLOCKED
                output[i] = "Dependency failed; step skipped."
                continue
            # All deps complete?
            if all(status[d] == StepStatus.COMPLETED for d in step.depends_on):
                ready.append(i)

        if not ready:
            break

        for i in ready:
            status[i] = StepStatus.RUNNING

        # Fire in parallel. return_exceptions=True so one branch's
        # crash doesn't cancel the others — the runner is supposed to
        # be exception-safe but defence-in-depth.
        outcomes = await asyncio.gather(
            *(_safe_run(runner, plan.steps[i], i) for i in ready),
            return_exceptions=False,
        )

        for i, (ok, value) in zip(ready, outcomes):
            if ok:
                status[i] = StepStatus.COMPLETED
                output[i] = value
            else:
                status[i] = StepStatus.FAILED
                output[i] = value

    # Compose the report in the original plan order (not execution order).
    for i, step_status in enumerate(status):
        report.results.append(
            StepResult(
                step_index=i,
                status=step_status,
                output=output[i] if step_status == StepStatus.COMPLETED else "",
                error=output[i] if step_status != StepStatus.COMPLETED else "",
            )
        )
    return report


async def _safe_run(runner: RunnerFn, step: PlanStep, idx: int) -> tuple[bool, str]:
    """Run one step. Returns (ok, output_or_error). Never raises."""
    try:
        out = await runner(step, idx)
        return True, out
    except Exception as exc:  # noqa: BLE001
        return False, f"Runner raised: {exc}"
