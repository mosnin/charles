"""Goal → Plan decomposition.

A short-lived LLM agent with output_type=Plan. Given a goal and a brief
context block (what the company is, what stage it's at, what tools
each department has), it emits a structured Plan: 1-8 steps, each
typed with department + expected_outcome + depends_on.

This is a deliberately lightweight planner. Not GOAP A*. Not a
multi-pass reasoner. Just structured output from a single LLM call.
v1 trades planning sophistication for shipping speed — most founder
goals decompose well into 3-5 chunks that a strong model can produce
in one shot. When we hit goals the planner can't handle (replan-on-
failure, conditional branches, mid-execution founder edits), the
upgrade path is GOAP-style or a multi-pass reasoner. Not now.
"""

from __future__ import annotations

import structlog
from agents import Agent, Runner

from config import settings
from planner.types import Plan

logger = structlog.get_logger(__name__)


_PLANNER_INSTRUCTIONS = """You are Charles's internal planner. Your job is to take a goal the founder gave the cofounder and decompose it into a small DAG of department-level steps.

## Departments and what each does
- engineering: code, repos, deploys, infra (GitHub, Vercel, Supabase, Cloudflare DNS)
- sales: CRM, outbound, pipeline (Apollo, Clearbit, HubSpot — coming-soon)
- marketing: copy, image/video, social, landing pages (Loops, LinkedIn, Twitter, OpenAI images, Replicate, PostHog)
- design: logo, brand assets, UI (image generation, brand library)
- support: inbox, helpdesk, customer comms (Intercom — coming-soon)
- ops_finance: Stripe, expenses, reporting

## What makes a good plan
- **Concrete steps.** Each step should be one sentence describing one action a department can actually take with its tool roster. "Ship the landing page" is too vague. "Engineering: open a PR adding /pricing route" is right.
- **expected_outcome is the contract.** This is what the verifier checks. State it as something an observer could confirm. "The /pricing route returns 200 from the prod domain" — yes. "Pricing page is shipped" — no, too vague.
- **depends_on encodes serial work.** Marketing's launch tweet can't be written until engineering has the URL. So marketing depends_on engineering. Design's hero image doesn't depend on either — leave its depends_on empty so it runs in parallel.
- **Parallelism is free.** Don't artificially serialize. If two steps have nothing connecting them, leave their depends_on independent so they fire in parallel.
- **Small plans win.** 1-5 steps for most goals. The cap is 8. If a goal genuinely needs more than 8, it's two goals; ask the founder to split it (state this in your summary).

## What NOT to do
- Don't decompose into sub-steps within a single department. The department's own sub-agent will figure out its own toolchain. Give it one task per step, not a checklist.
- Don't include "the founder approves" as a step. Approvals are surfaced by the department when it hits a risky action — not a planning step.
- Don't include "verify" or "test" as a separate step. Verification happens after execution by a separate verifier agent — don't plan for it.

## Output
A Plan with goal echoed back, a one-paragraph summary, and the list of steps. Indices in `depends_on` refer to positions in `steps` (0-based).
"""


async def decompose_goal(goal: str, mission_block: str | None = None) -> Plan:
    """Decompose a founder goal into a structured Plan.

    Parameters
    ----------
    goal:
        The goal in the founder's words (or the manager's reformulation).
    mission_block:
        Optional one-paragraph context the manager injects so the
        planner knows what the company is and what stage it's at.
        Without this, the plan is generic — with it, the plan can
        reference real assets ("the existing /pricing route", "our
        brand kit at...").

    Raises
    ------
    Any exception the SDK raises — caller (typically the manager
    `plan_and_execute` tool) wraps and surfaces to the founder.
    """
    instructions = _PLANNER_INSTRUCTIONS
    if mission_block:
        instructions = (
            instructions
            + "\n\n## Company context\n"
            + mission_block.strip()
        )

    planner = Agent[None](
        name="Planner",
        model=settings.orchestrator_model,
        instructions=instructions,
        tools=[],
        output_type=Plan,
    )

    logger.info("planner.decompose.start", goal=goal[:200])
    result = await Runner.run(planner, goal, max_turns=4)
    plan = result.final_output_as(Plan)
    logger.info(
        "planner.decompose.done",
        step_count=len(plan.steps),
        departments=[s.department for s in plan.steps],
    )
    return plan
