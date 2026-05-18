"""HTTP bridge for the TS chat surface to invoke manager-side tools.

The Next.js chat API POSTs to bridge endpoints exposed in modal_app.py with
a shared-secret bearer token. The bridge invokes the same primitives that
back CharlesManager's tool surface — but as plain async functions, not
through the OpenAI agents Runner — so TS can fire department delegations,
advance stages, read mission state, and write core memory without going
through the full conversational agent loop.

We deliberately do NOT import the @function_tool wrappers from
agent/manager/charles.py: those are decorated objects bound to a specific
agent run. The four primitives here mirror what those tools do, calling
the same DB tables and memory helpers, so the behavior stays in sync
without coupling to the agent SDK at the HTTP edge.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from agents import Runner

from config import settings
from db import supabase
from departments import DEPARTMENT_REGISTRY
from lib.cost_events import emit_cost_event
from memory.layers import format_core_for_prompt, load_layers, set_core_slot
from stages import gates_for_stage

VALID_STAGES = ("idea", "initial", "identity", "building", "selling", "scaling")
VALID_DEPARTMENTS = tuple(DEPARTMENT_REGISTRY.keys())

_MAX_DEPT_OUTPUT_CHARS = 2000


async def delegate(
    space_id: str,
    department: str,
    task: str,
    context: str = "",
    run_id: str | None = None,
) -> dict[str, Any]:
    """Run a department agent inline for one task.

    Returns: { status, output, swarmMemberId, department }
    """
    if department not in DEPARTMENT_REGISTRY:
        return {
            "status": "failed",
            "output": (
                f"Unknown department '{department}'. "
                f"Choose from: {', '.join(VALID_DEPARTMENTS)}"
            ),
            "department": department,
            "swarmMemberId": None,
        }

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

    insert_res = await db.table("SwarmMember").insert(member_row).execute()
    member_id = insert_res.data[0]["id"] if insert_res.data else None

    try:
        cls = DEPARTMENT_REGISTRY[department]
        dept_agent = await cls(space_id=space_id).build_agent()
        message = task if not context else f"{task}\n\nContext:\n{context}"
        result = await Runner.run(dept_agent, message, max_turns=12)
        output = result.final_output or "No output produced."

        # Best-effort cost emission — never fail the delegation on a cost bug.
        try:
            usage = getattr(result, "usage", None)
            tokens_in = int(getattr(usage, "input_tokens", 0) or 0) if usage else 0
            tokens_out = int(getattr(usage, "output_tokens", 0) or 0) if usage else 0
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
        except Exception:
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

        truncated = output
        if len(truncated) > _MAX_DEPT_OUTPUT_CHARS:
            truncated = truncated[:_MAX_DEPT_OUTPUT_CHARS] + "...[truncated]"

        return {
            "status": "completed",
            "output": truncated,
            "department": department,
            "swarmMemberId": member_id,
        }

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
        return {
            "status": "failed",
            "output": err,
            "department": department,
            "swarmMemberId": member_id,
        }


async def advance_stage(
    space_id: str,
    new_stage: str,
    reason: str = "",
) -> dict[str, Any]:
    """Move the workspace to a new stage. Mirrors CharlesManager.advance_stage.

    Returns: { status, output, stage }
    """
    if new_stage not in VALID_STAGES:
        return {
            "status": "failed",
            "output": f"Invalid stage. Must be one of: {', '.join(VALID_STAGES)}",
            "stage": None,
        }

    db = await supabase()
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
            return {
                "status": "blocked",
                "output": (
                    f"Cannot advance: incomplete stage gates: "
                    f"{', '.join(incomplete)}. Complete them or override."
                ),
                "stage": None,
            }

    await (
        db.table("WorkspaceStage")
        .insert({"spaceId": space_id, "stage": new_stage, "exitedBy": "agent"})
        .execute()
    )
    await (
        db.table("Mission")
        .update({"stage": new_stage})
        .eq("spaceId", space_id)
        .execute()
    )
    await set_core_slot(space_id, "current_stage", new_stage)

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
                {"spaceId": space_id, "stage": new_stage, "title": t, "order": i}
                for i, t in enumerate(titles)
            ]
            await db.table("StageGate").insert(rows).execute()

    return {
        "status": "completed",
        "output": f"Stage advanced to: {new_stage}",
        "stage": new_stage,
    }


async def get_mission(space_id: str) -> dict[str, Any]:
    """Fetch the mission row + all core memory slots for a space."""
    db = await supabase()
    layers = await load_layers(space_id)
    mission_res = await (
        db.table("Mission")
        .select("*")
        .eq("spaceId", space_id)
        .maybe_single()
        .execute()
    )
    mission = mission_res.data if mission_res else None
    return {
        "mission": mission,
        "core": layers.core,
        "promptBlock": format_core_for_prompt(layers.core),
    }


async def update_core_memory(
    space_id: str,
    slot: str,
    value: str,
) -> dict[str, Any]:
    """Upsert one core-memory slot. Returns { ok: True, slot, value }."""
    await set_core_slot(space_id, slot, value)
    return {"ok": True, "slot": slot, "value": value}


# ---------------------------------------------------------------------------
# Auth — shared-secret bearer token
# ---------------------------------------------------------------------------

def check_auth(authorization_header: str | None, expected_secret: str) -> bool:
    """Constant-ish check that the Authorization header carries the right
    shared secret. Returns False on missing config so the endpoint can 401
    cleanly rather than silently allowing through on a misconfigured deploy.
    """
    if not expected_secret:
        return False
    if not authorization_header:
        return False
    prefix = "Bearer "
    if not authorization_header.startswith(prefix):
        return False
    token = authorization_header[len(prefix):].strip()
    return token == expected_secret


# Re-export the literal type for endpoint signatures that want it.
Department = Literal[
    "engineering", "sales", "marketing", "design", "support", "ops_finance"
]
