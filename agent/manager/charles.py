"""Charles — the manager agent for the Charles AI cofounder platform.

Charles owns the founder's mission, delegates work to departments,
tracks stage gates, manages approvals, and runs the daily briefing.
He does not do department-level work himself — he delegates it.

Usage:
    manager = CharlesManager(space_id="...", run_id="...")
    agent = await manager.build_agent()
    result = await Runner.run(agent, message, context=None, max_turns=50)
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any

from agents import Agent, Runner, function_tool

from config import settings
from db import supabase
from departments import DEPARTMENT_REGISTRY
from lib.cost_events import emit_cost_event
from memory.layers import format_core_for_prompt, load_layers, set_core_slot
from memory.store import save_memory, search_similar
from planner import (
    decompose_goal,
    execute_plan,
    verify_outcomes,
)
from planner.execute import PlanValidationError
from stages import gates_for_stage
from tools._scheduling import build_scheduling_tools

DEPARTMENTS = list(DEPARTMENT_REGISTRY.keys())

_MAX_DEPT_OUTPUT_CHARS = 2000


async def _mark_plan_run_failed(db, plan_run_id: str, error: str) -> None:
    """Close out a SwarmRun row when planning or execution crashes.
    Wrapped in try/except so bookkeeping failures don't bubble.
    """
    try:
        await (
            db.table("SwarmRun")
            .update(
                {
                    "status": "failed",
                    "completedAt": datetime.now(timezone.utc).isoformat(),
                    "errorMessage": error[:2000],
                }
            )
            .eq("id", plan_run_id)
            .execute()
        )
    except Exception:  # noqa: BLE001
        pass


async def _persist_verifier_verdicts(db, plan_run_id: str, verification) -> None:
    """Write per-step verifier verdicts onto the matching SwarmMember
    rows (joined by stepIndex), then close out the SwarmRun with the
    overall verdict. Best-effort throughout — the chat surface
    already has the formatted report, persistence is for the Plan View.
    """
    try:
        # Per-step: update each SwarmMember by (swarmRunId, stepIndex).
        for sv in verification.steps:
            sv_dict = sv if isinstance(sv, dict) else sv.model_dump()
            try:
                await (
                    db.table("SwarmMember")
                    .update({"verifierVerdict": sv_dict})
                    .eq("swarmRunId", plan_run_id)
                    .eq("stepIndex", sv_dict["step_index"])
                    .execute()
                )
            except Exception:  # noqa: BLE001
                # One step's update failure shouldn't block others.
                continue

        # Overall: close the run with verifier roll-up.
        await (
            db.table("SwarmRun")
            .update(
                {
                    "status": (
                        "completed"
                        if verification.overall_satisfied
                        else "failed"
                    ),
                    "overallSatisfied": verification.overall_satisfied,
                    "verifierSummary": verification.summary,
                    "completedAt": datetime.now(timezone.utc).isoformat(),
                }
            )
            .eq("id", plan_run_id)
            .execute()
        )
    except Exception:  # noqa: BLE001
        pass


def _format_plan_report(plan, report, verification, verify_error: str) -> str:
    """Compose the plan_and_execute response from plan + execution +
    verification. One string the manager surfaces to the founder.

    Sections:
      PLAN — goal + summary
      STEPS — per-step status, output, verdict, follow-up
      OVERALL — verifier's roll-up, follow-ups to schedule
    """
    lines: list[str] = []
    lines.append(f"PLAN: {plan.goal}")
    lines.append(f"Summary: {plan.summary}")
    lines.append("")

    # Index verifier verdicts by step_index for fast lookup.
    verdicts: dict = {}
    if verification is not None:
        for sv in verification.steps:
            sv_dict = sv if isinstance(sv, dict) else sv.model_dump()
            verdicts[sv_dict["step_index"]] = sv_dict

    lines.append("STEPS:")
    for r in report.results:
        step = plan.steps[r.step_index]
        lines.append(
            f"\n{r.step_index + 1}. [{step.department}] {step.task}"
        )
        lines.append(f"   Expected: {step.expected_outcome}")
        lines.append(f"   Status: {r.status.value}")
        body = r.output if r.status.value == "completed" else (r.error or "(no output)")
        body_short = body if len(body) <= 800 else body[:800] + "...[truncated]"
        lines.append(f"   Output: {body_short}")
        v = verdicts.get(r.step_index)
        if v:
            tick = "✓" if v["satisfied"] else "✗"
            lines.append(f"   Verdict: {tick} {v['reason']}")
            if v.get("suggested_follow_up"):
                lines.append(f"   Follow-up: {v['suggested_follow_up']}")

    lines.append("")
    if verification is not None:
        overall = "satisfied" if verification.overall_satisfied else "not satisfied"
        lines.append(f"OVERALL ({overall}): {verification.summary}")

        # Surface any suggested follow-ups in a callable form so the
        # manager can act on them with schedule_self_wake.
        followups: list[str] = []
        for sv in verification.steps:
            sv_dict = sv if isinstance(sv, dict) else sv.model_dump()
            if sv_dict.get("suggested_follow_up"):
                followups.append(
                    f"  - Step {sv_dict['step_index'] + 1}: "
                    f"{sv_dict['suggested_follow_up']}"
                )
        if followups:
            lines.append("")
            lines.append(
                "SUGGESTED FOLLOW-UPS — schedule via schedule_self_wake "
                "if you want to close the loop:"
            )
            lines.extend(followups)
    elif verify_error:
        lines.append(
            f"OVERALL: verification crashed ({verify_error}). "
            "Execution finished; re-judge manually or re-run plan_and_execute "
            "if outputs look off."
        )

    return "\n".join(lines)

_CHARLES_INSTRUCTIONS_BASE = """You are Charles — the AI cofounder and manager for this company.

Your role is to coordinate six departments (Engineering, Sales, Marketing, Design, Support, Ops/Finance) to help this founder build and ship their company from idea to revenue.

## Your responsibilities
- Own the company mission and roadmap
- Delegate work to the right departments using `delegate_to_department` (solo)
  or `delegate_to_team` (multiple departments in parallel)
- Track stage progression (idea → initial → identity → building → selling → scaling)
- Request founder approval for any risky or external action before executing
- Update core memory as you learn more about the company
- Run a daily briefing when asked

## Rules
- Never do department-level work yourself — delegate it
- Never take an external action (send email, commit code, post to social, spend money) without the founder's explicit approval
- When in doubt, ask the founder
- Keep answers concise and action-oriented
- You are not a chatbot. You run a company.

## Departments
- engineering: code, repos, deploys, infra
- sales: CRM, outbound, pipeline
- marketing: copy, image/video, social, landing pages
- design: logo, brand assets, UI
- support: inbox, helpdesk, customer comms
- ops_finance: Stripe, expenses, reporting

## How to delegate

You have three delegation tools, ordered by scope:

- `delegate_to_department(department, task, context?)` — one department,
  inline. Use when there's a single thing to delegate.

- `delegate_to_team(team_json)` — multiple departments in parallel,
  one round. Use when 2-6 departments work independently on different
  parts of the same step and none blocks the others.

- `plan_and_execute(goal)` — full pipeline: decompose, execute across
  departments (parallel where possible), verify outcomes, surface any
  follow-ups. Use this for multi-step goals where the structure isn't
  obvious — "ship the pricing page," "do a launch campaign,"
  "stand up customer support." This is the cofounder move: stop
  manually choreographing, hand it a goal, get back a plan + the
  results + a judged verdict on whether the goal was actually met.

  After plan_and_execute returns, read the "SUGGESTED FOLLOW-UPS"
  section. For each one worth holding (deploy verification, PR-merge
  re-check, customer reply follow-up), call schedule_self_wake to
  close the loop later. That's how you keep threads across runs.

### Which one to reach for
- Single sentence, one department → delegate_to_department
- Multi-department, one round, you've already decomposed → delegate_to_team
- Multi-step or open goal, you haven't decomposed yet → plan_and_execute

### What plan_and_execute is NOT for
- Open-ended exploration ("what should we build?") — that's a chat, not a plan.
- Asks for advice — read the room; the founder wants discussion, not execution.
- Single-step tasks — overkill; the planner adds latency and tokens.

### Don't manufacture parallelism
If marketing needs the API URL to write copy, that's serial — let the
planner encode it via depends_on, or do delegate_to_department in
sequence yourself.

## Stage progression
idea → initial → identity → building → selling → scaling

Advance a stage only when all StageGates for the current stage are complete,
or the founder explicitly overrides. Use `advance_stage` to move forward.

## Your calendar (self-scheduled wake-ups)

You can schedule your own future wake-ups with `schedule_self_wake(when, reason, payload_json)`.
Use this whenever work can't fully resolve in the current run — when something is
awaiting a response, a deploy, a review, or a deadline. The fanout cron will re-wake
you at the scheduled time with the payload as context.

Schedule a wake-up when you:
- Send a draft for founder approval and want to follow up if it sits >24h.
- Open a PR or kick off a deploy and want to verify the outcome.
- Reach out to a customer or prospect and want to follow up if there's no reply.
- Promise the founder "I'll check on X by Friday."
- Hit a blocker you expect to clear (e.g., DNS propagation, build queue).

`when` accepts ISO-8601 ("2026-05-19T14:00:00Z") or shorthand ("in 24h", "in 3d",
"in 90m"). `reason` should be one sentence describing what future-you will check.
`payload_json` is optional context (PR number, contact id) the wake should carry.

Use `list_upcoming_wakes()` before scheduling to avoid duplicate wake-ups for
the same thing. Don't over-schedule — every wake costs tokens. A good cofounder
remembers; they don't set ten alarms.
"""


class CharlesManager:
    """Builds the Charles manager agent for a given space."""

    def __init__(self, space_id: str, run_id: str | None = None) -> None:
        self.space_id = space_id
        self.run_id = run_id

    # ── Tools ────────────────────────────────────────────────────────────────

    def _get_tools(self) -> list[Any]:
        space_id = self.space_id
        run_id = self.run_id

        @function_tool
        async def get_mission() -> str:
            """Get the current mission, stage, and all core memory."""
            db = await supabase()
            layers = await load_layers(space_id)
            mission_res = await (
                db.table("Mission")
                .select("*")
                .eq("spaceId", space_id)
                .maybe_single()
                .execute()
            )
            mission = mission_res.data

            result: list[str] = []
            if mission:
                result.append(f"Mission: {mission.get('title', '(not set)')}")
                result.append(f"Stage: {mission.get('stage', 'idea')}")
                if mission.get("description"):
                    result.append(f"Description: {mission['description']}")
                if mission.get("oneLinePitch"):
                    result.append(f"One-line pitch: {mission['oneLinePitch']}")
                if mission.get("targetCustomer"):
                    result.append(f"Target customer: {mission['targetCustomer']}")
            result.append(format_core_for_prompt(layers.core))
            return "\n".join(result)

        @function_tool
        async def update_mission(
            title: str = "",
            description: str = "",
            one_line_pitch: str = "",
            target_customer: str = "",
        ) -> str:
            """Update the company mission fields. Pass only fields to change."""
            db = await supabase()
            update_data: dict[str, str] = {}
            if title:
                update_data["title"] = title
            if description:
                update_data["description"] = description
            if one_line_pitch:
                update_data["oneLinePitch"] = one_line_pitch
            if target_customer:
                update_data["targetCustomer"] = target_customer
            if not update_data:
                return "Nothing to update — pass at least one field."
            await (
                db.table("Mission")
                .update(update_data)
                .eq("spaceId", space_id)
                .execute()
            )
            return f"Mission updated: {', '.join(update_data.keys())}"

        @function_tool
        async def update_core_memory(slot: str, value: str) -> str:
            """Set a core memory slot.

            Available slots: company_name, tagline, product_description,
            one_line_pitch, target_customer, current_stage, github_repo,
            primary_domain, key_constraints, founder_name
            """
            await set_core_slot(space_id, slot, value)
            return f"Core memory updated: {slot}"

        async def _run_one_dept(
            department: str,
            task: str,
            context: str,
            wave: int,
            swarm_run_override: str | None = None,
            step_index: int | None = None,
        ) -> tuple[str, str | None]:
            """Run a single department delegation end-to-end.

            Shared body for solo (`delegate_to_department`), team
            (`delegate_to_team`), and plan-driven (`plan_and_execute`)
            delegation. Returns (output_str, member_id_or_None). The
            member_id is exposed so plan_and_execute can post the
            verifier verdict back to the same SwarmMember row.

            Solo/team callers discard the member_id; the string return
            keeps the existing chat-surface contract intact.

            Parameters
            ----------
            swarm_run_override:
                When set (plan_and_execute case), the SwarmMember row's
                swarmRunId is this value instead of self.run_id. Lets
                plan execution group its steps under a fresh SwarmRun
                with a proper Plan jsonb attached.
            step_index:
                When set, persisted on the SwarmMember row so the Plan
                View can join SwarmRun.plan.steps[stepIndex] to the
                member row. None for solo/team delegations.
            """
            cls = DEPARTMENT_REGISTRY.get(department)
            if cls is None:
                return (
                    f"[{department}] Unknown department. "
                    f"Choose from: {', '.join(DEPARTMENT_REGISTRY)}",
                    None,
                )

            db = await supabase()
            member_row: dict[str, Any] = {
                "swarmRunId": swarm_run_override or run_id,
                "name": f"Charles — {department.capitalize()}",
                "role": department,
                "task": task,
                "wave": wave,
                "status": "running",
                "startedAt": datetime.now(timezone.utc).isoformat(),
            }
            if context:
                member_row["systemPrompt"] = context
            if step_index is not None:
                member_row["stepIndex"] = step_index

            member_id: str | None = None
            try:
                insert_res = await (
                    db.table("SwarmMember").insert(member_row).execute()
                )
                if insert_res.data:
                    member_id = insert_res.data[0]["id"]
            except Exception:  # noqa: BLE001
                # SwarmMember insert is bookkeeping — don't let a missing
                # SwarmRun parent FK or schema drift block a real delegation.
                pass

            try:
                dept_agent = await cls(space_id=space_id).build_agent()
                message = task if not context else f"{task}\n\nContext:\n{context}"
                result = await Runner.run(dept_agent, message, max_turns=12)
                output = result.final_output or "No output produced."

                # Cost tracking — best-effort, never blocks delegation.
                try:
                    usage = getattr(result, "usage", None)
                    tokens_in = (
                        int(getattr(usage, "input_tokens", 0) or 0) if usage else 0
                    )
                    tokens_out = (
                        int(getattr(usage, "output_tokens", 0) or 0) if usage else 0
                    )
                    if not usage:
                        turns = len(getattr(result, "raw_responses", []) or []) or 1
                        tokens_in = turns * 2000
                        tokens_out = turns * 500
                    await emit_cost_event(
                        space_id=space_id,
                        department=department,  # type: ignore[arg-type]
                        model=settings.worker_model,
                        input_tokens=tokens_in,
                        output_tokens=tokens_out,
                        run_id=run_id,
                    )
                except Exception:  # noqa: BLE001
                    pass

                if member_id:
                    await (
                        db.table("SwarmMember")
                        .update({
                            "status": "completed",
                            "output": output,
                            "completedAt": datetime.now(timezone.utc).isoformat(),
                        })
                        .eq("id", member_id)
                        .execute()
                    )

                if len(output) > _MAX_DEPT_OUTPUT_CHARS:
                    output = output[:_MAX_DEPT_OUTPUT_CHARS] + "...[truncated]"
                return f"[{department}] {output}", member_id

            except Exception as exc:
                err = f"Error: {exc}"
                if member_id:
                    try:
                        await (
                            db.table("SwarmMember")
                            .update({
                                "status": "failed",
                                "output": err,
                                "completedAt": datetime.now(timezone.utc).isoformat(),
                            })
                            .eq("id", member_id)
                            .execute()
                        )
                    except Exception:  # noqa: BLE001
                        pass
                return f"[{department}] Failed: {exc}", member_id

        @function_tool
        async def delegate_to_department(
            department: str,
            task: str,
            context: str = "",
        ) -> str:
            """Delegate one task to one department, inline.

            Use this when there's a single department to delegate to, or
            when one department's output is needed before another can
            start. For multiple independent departments running side-by-
            side, use `delegate_to_team` instead — it runs them in
            parallel.

            department: one of engineering, sales, marketing, design, support, ops_finance
            task: clear description of what needs to be done
            context: optional extra context the department agent needs
            """
            output, _ = await _run_one_dept(department, task, context, wave=1)
            return output

        @function_tool
        async def delegate_to_team(team_json: str) -> str:
            """Delegate work to multiple departments in parallel.

            Use this when several departments need to work independently
            on different parts of the same goal. Example: engineering
            spins up the API, marketing writes the launch copy, design
            ships the logo — none of them block on the others, so they
            run as a team.

            team_json: a JSON array of objects, each with:
              - department: engineering | sales | marketing | design | support | ops_finance
              - task: what that department should do (clear, scoped, one sentence)
              - context: optional extra context the department needs

            Example:
              [
                {"department": "engineering", "task": "Open a PR adding /pricing route"},
                {"department": "marketing", "task": "Draft 3 headlines for the pricing page"},
                {"department": "design", "task": "Pick a hero image from our brand assets"}
              ]

            All departments run concurrently. Each result is returned
            labeled with the department name. A failure in one branch
            does not affect the others — you get a "[dept] Failed: ..."
            line for the failed one and full output for the rest.

            Cap: 6 departments per team (one per department). For larger
            scopes, run sequential teams rather than one big one.
            """
            try:
                team = json.loads(team_json)
            except json.JSONDecodeError as exc:
                return f"team_json is not valid JSON: {exc}"
            if not isinstance(team, list) or not team:
                return "team_json must be a non-empty JSON array."
            if len(team) > len(DEPARTMENT_REGISTRY):
                return (
                    f"Team size {len(team)} exceeds max "
                    f"{len(DEPARTMENT_REGISTRY)} (one per department)."
                )

            validated: list[tuple[str, str, str]] = []
            seen_depts: set[str] = set()
            for i, entry in enumerate(team):
                if not isinstance(entry, dict):
                    return f"Entry {i} is not an object."
                dept = entry.get("department")
                task = entry.get("task")
                context = entry.get("context", "")
                if dept not in DEPARTMENT_REGISTRY:
                    return (
                        f"Entry {i}: unknown department '{dept}'. "
                        f"Choose from: {', '.join(DEPARTMENT_REGISTRY)}"
                    )
                if dept in seen_depts:
                    return (
                        f"Entry {i}: department '{dept}' appears twice. "
                        "Combine the tasks into one entry instead."
                    )
                seen_depts.add(dept)
                if not isinstance(task, str) or not task.strip():
                    return f"Entry {i}: task is required (non-empty string)."
                if not isinstance(context, str):
                    return f"Entry {i}: context must be a string if provided."
                validated.append((dept, task.strip(), context))

            # Run in parallel. return_exceptions=True so one branch's
            # crash can't cancel its teammates — each is wrapped to
            # return a string regardless, but defence-in-depth.
            results = await asyncio.gather(
                *(_run_one_dept(d, t, c, wave=2) for (d, t, c) in validated),
                return_exceptions=True,
            )

            lines = [
                f"Team delegation complete ({len(validated)} "
                f"department{'' if len(validated) == 1 else 's'}, "
                "ran in parallel):"
            ]
            for (dept, _task, _ctx), result in zip(validated, results):
                if isinstance(result, BaseException):
                    lines.append(f"[{dept}] Failed: {result}")
                else:
                    # _run_one_dept returns (output, member_id) — team
                    # only needs the output string.
                    output_str = result[0] if isinstance(result, tuple) else str(result)
                    lines.append(output_str)
            return "\n\n".join(lines)

        @function_tool
        async def plan_and_execute(goal: str) -> str:
            """Decompose a goal, execute it across departments, verify outcomes.

            The big-picture tool. Use this when the founder hands you
            a goal that decomposes into multiple steps across multiple
            departments — "ship the pricing page," "do a launch
            campaign for v2," "spin up customer support." Plan and
            Execute does all four things in one shot:

              1. Decomposes the goal into 1-8 concrete steps, each
                 with a department, expected outcome, and dependency
                 graph (so independent steps run in parallel).
              2. Executes the DAG — fires every ready step in
                 parallel, awaits, finds newly-ready, repeats. A
                 step's failure blocks only its dependents; the rest
                 of the plan keeps running.
              3. Verifies each step's actual output against its
                 expected outcome via an LLM judge. Catches "I did
                 the thing!" outputs that don't contain evidence.
              4. For deferred outcomes (PR merge, deploy propagation,
                 customer reply), the verifier suggests follow-up
                 wake-ups you can schedule via `schedule_self_wake`.

            Returns a structured text summary: the plan, every step's
            terminal status + output, the verifier's per-step verdict,
            and any suggested follow-ups. The summary is what you
            speak back to the founder.

            When NOT to use this:
              - Single-step asks (just call delegate_to_department).
              - Open-ended exploration ("what should we build next?")
                — that's a conversation, not a plan.
              - Asks where the founder is asking for advice rather
                than execution — read the room.

            goal: the goal in one or two sentences. Specific is good
                  ("ship the /pricing page on charles.app, end-of-week"
                  beats "do the pricing thing").
            """
            db = await supabase()

            # Pull the slug once for the discoverability link at the
            # bottom of the response. Best-effort — chat still works
            # without the link.
            space_slug: str | None = None
            try:
                slug_res = await (
                    db.table("Space")
                    .select("slug")
                    .eq("id", space_id)
                    .maybe_single()
                    .execute()
                )
                if slug_res.data:
                    space_slug = slug_res.data.get("slug")
            except Exception:  # noqa: BLE001
                pass

            # ── 1. Decompose ─────────────────────────────────────────
            try:
                mission_block = ""
                try:
                    mission_res = await (
                        db.table("Mission")
                        .select("title, description, stage, oneLinePitch, targetCustomer")
                        .eq("spaceId", space_id)
                        .maybe_single()
                        .execute()
                    )
                    m = mission_res.data
                    if m:
                        mission_block = (
                            f"Mission: {m.get('title', '(not set)')}\n"
                            f"Stage: {m.get('stage', 'idea')}\n"
                            f"Description: {m.get('description', '(not set)')}\n"
                            f"One-line pitch: {m.get('oneLinePitch', '(not set)')}\n"
                            f"Target customer: {m.get('targetCustomer', '(not set)')}"
                        )
                except Exception:  # noqa: BLE001
                    pass

                plan = await decompose_goal(goal, mission_block=mission_block or None)
            except Exception as exc:  # noqa: BLE001
                return f"Plan decomposition failed: {exc}"

            # ── 2. Persist SwarmRun root ─────────────────────────────
            # The Plan View reads from this row: the plan jsonb holds
            # the structured Plan (steps[], expected_outcome, depends_on,
            # etc.), and SwarmMember rows linked by stepIndex provide
            # per-step status + output + verifier verdict.
            #
            # Best-effort — if the insert fails (FK constraint, schema
            # drift, missing SwarmRun parent type), the plan still
            # executes but won't show up in the Plan View. The chat
            # surface still gets the formatted report.
            plan_run_id: str | None = None
            try:
                run_insert = await (
                    db.table("SwarmRun")
                    .insert(
                        {
                            "spaceId": space_id,
                            "goal": goal,
                            "plan": plan.model_dump(mode="json"),
                            "status": "running",
                        }
                    )
                    .execute()
                )
                if run_insert.data:
                    plan_run_id = run_insert.data[0]["id"]
            except Exception:  # noqa: BLE001
                pass

            # ── 3. Execute (DAG walker) ──────────────────────────────
            try:
                async def runner_fn(step, idx: int) -> str:
                    # Each plan step runs through the same shared helper
                    # solo and team delegations use, so cost tracking,
                    # SwarmMember bookkeeping, and output truncation all
                    # behave identically. wave=3 distinguishes plan-driven
                    # delegations from solo (wave=1) and team (wave=2).
                    # swarm_run_override + step_index land the row in
                    # the Plan View's read path.
                    output, _member_id = await _run_one_dept(
                        step.department,
                        step.task,
                        step.context,
                        wave=3,
                        swarm_run_override=plan_run_id,
                        step_index=idx,
                    )
                    return output

                report = await execute_plan(plan, runner_fn)
            except PlanValidationError as exc:
                if plan_run_id:
                    await _mark_plan_run_failed(db, plan_run_id, str(exc))
                return f"Plan rejected (invalid DAG): {exc}"
            except Exception as exc:  # noqa: BLE001
                if plan_run_id:
                    await _mark_plan_run_failed(db, plan_run_id, str(exc))
                return f"Plan execution crashed: {exc}"

            # ── 4. Verify ────────────────────────────────────────────
            try:
                if plan_run_id:
                    await (
                        db.table("SwarmRun")
                        .update({"status": "auditing"})
                        .eq("id", plan_run_id)
                        .execute()
                    )
                verification = await verify_outcomes(plan, report)
            except Exception as exc:  # noqa: BLE001
                verification = None  # type: ignore[assignment]
                verify_error = str(exc)
            else:
                verify_error = ""

            # ── 5. Persist verifier verdicts ─────────────────────────
            if plan_run_id and verification is not None:
                await _persist_verifier_verdicts(
                    db, plan_run_id, verification
                )
            elif plan_run_id:
                # Verifier crashed — still close the run so the UI
                # doesn't show it stuck in 'auditing'.
                await (
                    db.table("SwarmRun")
                    .update(
                        {
                            "status": (
                                "completed" if report.all_succeeded else "failed"
                            ),
                            "completedAt": datetime.now(timezone.utc).isoformat(),
                            "errorMessage": (
                                f"verifier crashed: {verify_error}"
                                if verify_error
                                else None
                            ),
                        }
                    )
                    .eq("id", plan_run_id)
                    .execute()
                )

            formatted = _format_plan_report(plan, report, verification, verify_error)
            if plan_run_id:
                # Surface the run id so the manager can mention it
                # to the founder: "see the plan at /plans/<id>".
                slug_for_url = space_slug or "<slug>"
                formatted = (
                    f"PLAN_RUN_ID: {plan_run_id} "
                    f"(view at /s/{slug_for_url}/plans/{plan_run_id})\n\n"
                    + formatted
                )
            return formatted

        @function_tool
        async def advance_stage(new_stage: str, reason: str = "") -> str:
            """Advance the workspace to a new stage.

            Stages in order: idea, initial, identity, building, selling, scaling.
            All StageGates for the current stage must be complete, or the
            founder must explicitly override by passing reason='founder override'.
            """
            valid = ["idea", "initial", "identity", "building", "selling", "scaling"]
            if new_stage not in valid:
                return f"Invalid stage. Must be one of: {', '.join(valid)}"

            db = await supabase()

            # Check for incomplete gates unless founder explicitly overrides
            founder_override = "founder override" in (reason or "").lower()
            if not founder_override:
                gates_res = await (
                    db.table("StageGate")
                    .select("title")
                    .eq("spaceId", space_id)
                    .eq("isComplete", False)
                    .execute()
                )
                incomplete = [g["title"] for g in (gates_res.data or [])]
                if incomplete:
                    return (
                        f"Cannot advance: incomplete stage gates: "
                        f"{', '.join(incomplete)}. "
                        "Complete them or ask the founder to override."
                    )

            # Record stage transition
            await (
                db.table("WorkspaceStage")
                .insert({
                    "spaceId": space_id,
                    "stage": new_stage,
                    "exitedBy": "agent",
                })
                .execute()
            )

            # Update mission stage
            await (
                db.table("Mission")
                .update({"stage": new_stage})
                .eq("spaceId", space_id)
                .execute()
            )
            await set_core_slot(space_id, "current_stage", new_stage)

            # Lazy-seed the new stage's exit gates if none exist yet.
            # Idempotent — re-advancing into the same stage is a no-op.
            existing_res = await (
                db.table("StageGate")
                .select("id", count="exact")
                .eq("spaceId", space_id)
                .eq("stage", new_stage)
                .limit(1)
                .execute()
            )
            existing_count = getattr(existing_res, "count", None)
            if existing_count is None:
                existing_count = len(existing_res.data or [])
            if existing_count == 0:
                titles = gates_for_stage(new_stage)
                if titles:
                    rows = [
                        {
                            "spaceId": space_id,
                            "stage": new_stage,
                            "title": title,
                            "order": i,
                        }
                        for i, title in enumerate(titles)
                    ]
                    await db.table("StageGate").insert(rows).execute()

            return f"Stage advanced to: {new_stage}"

        @function_tool
        async def complete_stage_gate(gate_title: str) -> str:
            """Mark a stage gate as complete by its title."""
            db = await supabase()
            await (
                db.table("StageGate")
                .update({"isComplete": True, "completedAt": "NOW()"})
                .eq("spaceId", space_id)
                .eq("title", gate_title)
                .execute()
            )
            return f"Gate complete: {gate_title}"

        @function_tool
        async def list_stage_gates(include_complete: bool = False) -> str:
            """List the stage gates for this space.

            include_complete: if True, show completed gates too.
            """
            db = await supabase()
            query = (
                db.table("StageGate")
                .select("title,isComplete,stage,order")
                .eq("spaceId", space_id)
                .order("order")
            )
            if not include_complete:
                query = query.eq("isComplete", False)
            res = await query.execute()
            gates = res.data or []
            if not gates:
                return "No pending stage gates."
            lines = [
                f"- [{' DONE' if g.get('isComplete') else 'TODO'}] {g['title']} (stage: {g.get('stage', '?')})"
                for g in gates
            ]
            return "\n".join(lines)

        @function_tool
        async def create_task(
            title: str,
            description: str = "",
            priority: str = "normal",
            assignee_dept: str = "",
        ) -> str:
            """Create a task for the founder or a department to work on.

            Use when the conversation surfaces a discrete next step the
            founder needs to remember, OR when delegating something to a
            department that will run later.

            priority: one of 'low', 'normal', 'high' (defaults to 'normal').
            assignee_dept: one of the six department slugs to assign to a
              department; pass '' to leave unassigned.
            """
            if priority not in ("low", "normal", "high"):
                priority = "normal"
            valid_depts = (
                "engineering",
                "sales",
                "marketing",
                "design",
                "support",
                "ops_finance",
            )
            assignee_kind = "agent" if assignee_dept in valid_depts else "unassigned"
            db = await supabase()
            row = {
                "spaceId": space_id,
                "title": title.strip()[:200],
                "description": description.strip()[:2000],
                "priority": priority,
                "assigneeKind": assignee_kind,
                "assigneeDept": assignee_dept if assignee_kind == "agent" else None,
                "createdBy": "agent",
                "createdByDept": "manager",
            }
            if not row["title"]:
                return "Task title is required."
            res = await db.table("Task").insert(row).execute()
            if res.data and len(res.data) > 0:
                return f"Task created: {row['title']}"
            return "Could not create task."

        @function_tool
        async def recall_memory(query: str) -> str:
            """Recall relevant long-term memories for this space."""
            results = await search_similar(space_id=space_id, query=query, limit=8)
            if not results:
                return "No memories found."
            return "\n".join(r.get("content", "") for r in results)

        @function_tool
        async def store_memory(content: str, importance: float = 0.5) -> str:
            """Store an important memory for later recall (0.0 trivial → 1.0 critical)."""
            await save_memory(
                space_id=space_id,
                entity_type="space",
                entity_id=space_id,
                memory_type="fact",
                content=content.strip(),
                importance=max(0.0, min(1.0, importance)),
            )
            return "Memory stored."

        scheduling_tools = build_scheduling_tools(space_id, run_id)

        return [
            get_mission,
            update_mission,
            update_core_memory,
            delegate_to_department,
            delegate_to_team,
            plan_and_execute,
            advance_stage,
            complete_stage_gate,
            list_stage_gates,
            create_task,
            recall_memory,
            store_memory,
            *scheduling_tools,
        ]

    # ── System prompt ────────────────────────────────────────────────────────

    async def load_system_prompt(self) -> str:
        """Build the full system prompt with live mission + core memory injected."""
        db = await supabase()
        layers = await load_layers(self.space_id)
        mission_res = await (
            db.table("Mission")
            .select("*")
            .eq("spaceId", self.space_id)
            .maybe_single()
            .execute()
        )
        mission = mission_res.data

        mission_block = ""
        if mission:
            mission_block = (
                f"CURRENT MISSION: {mission.get('title', '(not set)')}\n"
                f"STAGE: {mission.get('stage', 'idea').upper()}\n"
                f"DESCRIPTION: {mission.get('description', '(not set)')}\n"
                f"ONE-LINE PITCH: {mission.get('oneLinePitch', '(not set)')}\n"
                f"TARGET CUSTOMER: {mission.get('targetCustomer', '(not set)')}"
            )

        core_block = format_core_for_prompt(layers.core)

        parts = [_CHARLES_INSTRUCTIONS_BASE]
        if mission_block:
            parts.append(mission_block)
        parts.append(core_block)
        return "\n\n".join(parts)

    # ── Agent builder ────────────────────────────────────────────────────────

    async def build_agent(self, extra_tools: list | None = None) -> Agent:
        """Build and return the Charles manager Agent instance.

        `extra_tools` lets the caller append integration tools loaded per
        space (Gmail, Slack, HubSpot, etc. via Composio). The manager's own
        founder-OS tools always come first so the model treats integrations
        as supplemental.
        """
        system_prompt = await self.load_system_prompt()
        tools = self._get_tools()
        if extra_tools:
            tools = tools + extra_tools
        return Agent[None](
            name="Charles",
            model=settings.worker_model,
            instructions=system_prompt,
            tools=tools,
        )
