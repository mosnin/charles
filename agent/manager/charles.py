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

from datetime import datetime, timezone
from typing import Any

from agents import Agent, Runner, function_tool

from config import settings
from db import supabase
from departments import DEPARTMENT_REGISTRY
from lib.cost_events import emit_cost_event
from memory.layers import format_core_for_prompt, load_layers, set_core_slot
from memory.store import save_memory, search_similar
from stages import gates_for_stage

DEPARTMENTS = list(DEPARTMENT_REGISTRY.keys())

_MAX_DEPT_OUTPUT_CHARS = 2000

_CHARLES_INSTRUCTIONS_BASE = """You are Charles — the AI cofounder and manager for this company.

Your role is to coordinate six departments (Engineering, Sales, Marketing, Design, Support, Ops/Finance) to help this founder build and ship their company from idea to revenue.

## Your responsibilities
- Own the company mission and roadmap
- Delegate work to the right departments using `delegate_to_department`
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

## Stage progression
idea → initial → identity → building → selling → scaling

Advance a stage only when all StageGates for the current stage are complete,
or the founder explicitly overrides. Use `advance_stage` to move forward.
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

        @function_tool
        async def delegate_to_department(
            department: str,
            task: str,
            context: str = "",
        ) -> str:
            """Delegate a task to a department agent and run it inline.

            department: one of engineering, sales, marketing, design, support, ops_finance
            task: clear description of what needs to be done
            context: optional extra context the department agent needs
            """
            cls = DEPARTMENT_REGISTRY.get(department)
            if cls is None:
                return (
                    f"Unknown department '{department}'. "
                    f"Choose from: {', '.join(DEPARTMENT_REGISTRY)}"
                )

            db = await supabase()
            member_row: dict[str, Any] = {
                "swarmRunId": run_id,
                "name": f"Charles — {department.capitalize()}",
                "role": department,
                "task": task,
                "wave": 1,
                "status": "running",
                "startedAt": datetime.now(timezone.utc).isoformat(),
            }
            if context:
                member_row["systemPrompt"] = context

            insert_res = await (
                db.table("SwarmMember")
                .insert(member_row)
                .execute()
            )
            member_id = insert_res.data[0]["id"] if insert_res.data else None

            try:
                dept_agent = await cls(space_id=space_id).build_agent()
                message = task if not context else f"{task}\n\nContext:\n{context}"
                result = await Runner.run(dept_agent, message, max_turns=12)
                output = result.final_output or "No output produced."

                # Record cost for this delegation. Best-effort; the helper
                # swallows its own exceptions, but we still wrap in try/except
                # so any *attribute*-extraction failure here can't bubble.
                try:
                    usage = getattr(result, "usage", None)
                    tokens_in = int(getattr(usage, "input_tokens", 0) or 0) if usage else 0
                    tokens_out = int(getattr(usage, "output_tokens", 0) or 0) if usage else 0
                    # If the SDK gave us no usage object, fall back to an
                    # estimate based on a typical turn shape (~2000 in / 500
                    # out per turn) so the dashboard still shows directional
                    # spend. Tune the constants once we have real data.
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
                    # A cost-event failure must never break a delegation.
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
                return f"[{department}] {output}"

            except Exception as exc:
                err = f"Error: {exc}"
                if member_id:
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
                return f"Department '{department}' failed: {exc}"

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

        return [
            get_mission,
            update_mission,
            update_core_memory,
            delegate_to_department,
            advance_stage,
            complete_stage_gate,
            list_stage_gates,
            create_task,
            recall_memory,
            store_memory,
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
