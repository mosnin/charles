"""Planner — goal decomposition + DAG execution + outcome verification.

Closes autonomy gaps #2 (the planner) and #4 (verification loop) from
the agentic roadmap.

Architecture:

  charles.plan_and_execute(goal)              ← single manager tool
       │
       ├── decompose.decompose_goal(goal)     ← LLM agent, output_type=Plan
       │     returns Plan{steps[], summary}
       │
       ├── execute.execute_plan(plan, runner) ← DAG walker
       │     fires ready steps in parallel,
       │     awaits, finds newly-ready,
       │     repeats. Pure algorithm —
       │     `runner` is a callback so it's
       │     unit-testable without LLM/DB.
       │
       └── verify.verify_outcomes(plan, results)  ← LLM-as-judge,
             output_type=PlanVerification        ← returns per-step
                                                   {satisfied, reason}.

This module only eagerly imports `types` and `execute` — pure-Python
modules with no SDK dependency. `decompose` and `verify` (which import
the `agents` SDK) are loaded lazily so the unit-testable parts can be
exercised without the heavy deps installed.
"""

from planner.execute import ExecutionReport, StepStatus, execute_plan
from planner.types import Plan, PlanStep, PlanVerification, StepVerification


def decompose_goal(*args, **kwargs):  # pragma: no cover - thin lazy-loader
    """Lazy-load wrapper for planner.decompose.decompose_goal.

    Keeps the agents-SDK import off the module-load hot path so this
    package can be imported in environments where the SDK isn't
    installed (e.g. test environments running only the DAG-walker
    suite).
    """
    from planner.decompose import decompose_goal as _impl

    return _impl(*args, **kwargs)


def verify_outcomes(*args, **kwargs):  # pragma: no cover - thin lazy-loader
    """Lazy-load wrapper for planner.verify.verify_outcomes."""
    from planner.verify import verify_outcomes as _impl

    return _impl(*args, **kwargs)


__all__ = [
    "Plan",
    "PlanStep",
    "PlanVerification",
    "StepVerification",
    "decompose_goal",
    "execute_plan",
    "ExecutionReport",
    "StepStatus",
    "verify_outcomes",
]
