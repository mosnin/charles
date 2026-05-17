"""Outcome verification — gap #4.

After plan execution, an LLM-as-judge agent reads each step's
(expected_outcome, actual_output) pair and decides whether the actual
output supplies concrete evidence that the expected outcome was met.

This is the cheap pass — the verifier sees only the strings the
departments emitted, not the world. For outcomes that can't be
verified from text alone (PR merged, customer replied, deploy
propagated), the verifier suggests a deferred re-check the manager
schedules via the existing schedule_self_wake infrastructure (gap #3
shipped that). The two gaps compose.

This does NOT make external API calls of its own (no probing the live
URL, no GitHub status checks). v1 trusts what the department reported;
v2 can wire targeted re-readers. The judge's value here is catching
"I did the thing!" outputs that don't actually show the thing got
done.
"""

from __future__ import annotations

import json

import structlog
from agents import Agent, Runner

from config import settings
from planner.execute import ExecutionReport, StepStatus
from planner.types import Plan, PlanVerification

logger = structlog.get_logger(__name__)


_VERIFIER_INSTRUCTIONS = """You are Charles's outcome verifier. You take a plan's expected outcomes and the actual outputs each department produced, and you judge — bluntly — whether the actual evidence supports the claimed outcome.

## What "satisfied" means
- The actual output contains specific evidence the expected outcome was met. URLs, IDs, status codes, file paths, row counts, message IDs.
- Concrete evidence beats confident assertion. "PR opened at github.com/x/y/pull/42" is evidence. "I opened the PR" is not.
- For deferred outcomes (PR merged, customer replied, deploy propagated, payment cleared), satisfied=false. State the follow-up in suggested_follow_up.

## What "not satisfied" means
- The output reports success without quotable evidence.
- The output reports failure or blockers.
- The output is empty or generic.
- The output contradicts the expected outcome.

## Suggested follow-up
When satisfied=false but the work might genuinely complete on its own (deferred outcome), describe the check and a sensible delay:
  "Check whether PR #42 merged. Wait 24h."
  "Verify the deploy is live by hitting the prod URL. Wait 15m."
  "Follow up if the customer hasn't replied. Wait 3d."
Leave empty when no follow-up makes sense (e.g., the step failed irrecoverably).

## Tone
You're talking to a founder who wants the truth. No hedging. Reference specific lines from the output where you can. One sentence per verdict; the summary at the top can be two.

## Output
A PlanVerification with overall_satisfied (true only if every step satisfied), a one-paragraph summary, and one StepVerification per step in order.
"""


async def verify_outcomes(plan: Plan, report: ExecutionReport) -> PlanVerification:
    """Run the verifier over a completed plan + execution report.

    Failed/blocked steps are reported as satisfied=false up front
    without calling the LLM — there's nothing to verify. The LLM only
    judges COMPLETED steps. This saves a round-trip when a plan
    crashed early.
    """
    # Pre-fill the easy cases. The LLM gets only the ambiguous ones.
    pre_filled: dict[int, dict] = {}
    for r in report.results:
        if r.status == StepStatus.FAILED:
            pre_filled[r.step_index] = {
                "step_index": r.step_index,
                "satisfied": False,
                "reason": f"Step failed before completing: {r.error[:200]}",
                "suggested_follow_up": "",
            }
        elif r.status == StepStatus.BLOCKED:
            pre_filled[r.step_index] = {
                "step_index": r.step_index,
                "satisfied": False,
                "reason": "Skipped — a dependency failed.",
                "suggested_follow_up": "",
            }

    # If every step is pre-filled (everything failed/blocked), don't
    # bother calling the LLM. Compose the report directly.
    if len(pre_filled) == len(plan.steps):
        return PlanVerification(
            overall_satisfied=False,
            summary=(
                "The plan didn't reach execution. Every step either "
                "failed up front or was blocked by an earlier failure. "
                "Nothing to verify."
            ),
            steps=[pre_filled[i] for i in range(len(plan.steps))],  # type: ignore[arg-type]
        )

    # Build the judge's input: only the steps that actually ran.
    judge_input_steps = []
    for r in report.results:
        if r.step_index in pre_filled:
            continue
        step = plan.steps[r.step_index]
        judge_input_steps.append({
            "step_index": r.step_index,
            "department": step.department,
            "task": step.task,
            "expected_outcome": step.expected_outcome,
            "actual_output": r.output[:3000],  # truncate to keep prompt bounded
        })

    judge_message = (
        f"GOAL: {plan.goal}\n\n"
        f"PLAN SUMMARY: {plan.summary}\n\n"
        "STEP OUTCOMES TO VERIFY (one entry per completed step):\n\n"
        + json.dumps(judge_input_steps, indent=2)
    )

    verifier = Agent[None](
        name="Verifier",
        model=settings.orchestrator_model,
        instructions=_VERIFIER_INSTRUCTIONS,
        tools=[],
        output_type=PlanVerification,
    )

    logger.info(
        "planner.verify.start",
        completed_count=len(judge_input_steps),
        prefilled_count=len(pre_filled),
    )
    result = await Runner.run(verifier, judge_message, max_turns=4)
    judged = result.final_output_as(PlanVerification)

    # Merge: pre-filled failure rows + LLM-judged completed rows. The
    # judge sees only completed steps so its step_indices won't
    # collide with the pre-filled set.
    by_index: dict[int, dict] = {**pre_filled}
    for sv in judged.steps:
        by_index[sv.step_index] = sv.model_dump()

    merged_steps = [by_index[i] for i in range(len(plan.steps))]
    overall = all(s["satisfied"] for s in merged_steps)

    return PlanVerification(
        overall_satisfied=overall,
        summary=judged.summary,
        steps=merged_steps,  # type: ignore[arg-type]
    )
