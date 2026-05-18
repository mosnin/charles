"""Pydantic models the planner + verifier hand back as structured output.

The OpenAI Agents SDK conforms agent output to these models via
`Agent(output_type=Plan)` / `Agent(output_type=PlanVerification)`.
Field constraints serve double duty as guardrails — `depends_on` indices
out of range or department strings outside the literal union are caught
at parse time rather than discovered mid-execution.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Department = Literal[
    "engineering",
    "sales",
    "marketing",
    "design",
    "support",
    "ops_finance",
]

# Cap plan size — prevents the planner from emitting a 50-step plan
# that's actually noise. If a goal genuinely needs more than 8 steps,
# decompose into a chain of plans.
MAX_PLAN_STEPS = 8


class PlanStep(BaseModel):
    """One node in the plan DAG."""

    department: Department = Field(
        description="Which department's sub-agent will execute this step."
    )
    task: str = Field(
        description="Clear, one-sentence description of what to do.",
        min_length=4,
    )
    expected_outcome: str = Field(
        description=(
            "What ‘done’ looks like in concrete terms — a URL that "
            "returns 200, a row in a table, a PR merged, a draft "
            "approved. Used by the verifier to judge whether the "
            "department's output actually satisfied the goal."
        ),
        min_length=4,
    )
    depends_on: list[int] = Field(
        default_factory=list,
        description=(
            "Indices of other steps in this plan that must complete "
            "before this step can start. Empty list = ready immediately. "
            "Indices refer to the position in Plan.steps."
        ),
    )
    context: str = Field(
        default="",
        description=(
            "Optional extra context the department needs to do this "
            "well (constraints, references, prior decisions). Leave "
            "empty when the task is self-contained."
        ),
    )


class Plan(BaseModel):
    """A decomposed goal — what the planner agent emits."""

    goal: str = Field(description="The original goal, echoed back.")
    summary: str = Field(
        description=(
            "One-paragraph plain-English read-out of what the plan "
            "does and why. Shown to the founder so they can sanity-"
            "check before execution."
        ),
        min_length=10,
    )
    steps: list[PlanStep] = Field(
        description="The steps in execution order (dependencies aside).",
        min_length=1,
        max_length=MAX_PLAN_STEPS,
    )


class StepVerification(BaseModel):
    """Per-step judgement of whether the actual output satisfied the
    expected_outcome the planner committed to."""

    step_index: int
    satisfied: bool = Field(
        description=(
            "True when the actual output supplies concrete evidence "
            "the expected outcome was met. False when the department "
            "reported success without verifiable evidence, or when "
            "the output contradicts the expected outcome."
        ),
    )
    reason: str = Field(
        description=(
            "One sentence explaining the verdict. Reference specific "
            "lines from the actual output where possible."
        ),
        min_length=4,
    )
    suggested_follow_up: str = Field(
        default="",
        description=(
            "When satisfied=false but the outcome is deferred (PR "
            "merge, customer reply, deploy propagation, etc.), "
            "describe what to re-check and when — e.g. "
            "'Check whether PR #42 merged in 24h'. The manager will "
            "schedule a self-wake using this. Leave empty when no "
            "follow-up makes sense."
        ),
    )


class PlanVerification(BaseModel):
    """What the verifier agent emits at the end of a plan."""

    overall_satisfied: bool = Field(
        description=(
            "True when every step's satisfied=true. The goal is "
            "considered fully done only in that case."
        ),
    )
    summary: str = Field(
        description=(
            "One paragraph: did the plan achieve the goal? What "
            "remains (if anything)? Spoken to the founder, in "
            "Charles's voice — direct and unvarnished."
        ),
        min_length=10,
    )
    steps: list[StepVerification] = Field(
        description="One verification entry per plan step, in order.",
    )
