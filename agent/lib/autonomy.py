"""Per-department autonomy lookup for the agent runtime.

Mirrors lib/departments/autonomy.ts. The runtime calls
get_department_autonomy(space_id, slug) before mutating-tool execution
to decide whether to execute, gate, or block.
"""

from __future__ import annotations

from typing import Literal

from db import supabase

AutonomyLevel = Literal["observe", "ask", "auto-low", "autonomous"]
DEFAULT_AUTONOMY: AutonomyLevel = "ask"

ALL_DEPARTMENTS: tuple[str, ...] = (
    "engineering",
    "design",
    "marketing",
    "sales",
    "support",
    "ops_finance",
)


async def get_department_autonomy(space_id: str, slug: str) -> AutonomyLevel:
    """Return the dept's autonomy. DEFAULT_AUTONOMY when the row is missing.

    Never raises — every failure path returns DEFAULT_AUTONOMY so a
    DB hiccup or unseeded row can't break a tool call.
    """
    if not space_id or not slug:
        return DEFAULT_AUTONOMY
    try:
        db = await supabase()
        res = await (
            db.table("Department")
            .select("autonomyLevel")
            .eq("spaceId", space_id)
            .eq("slug", slug)
            .maybe_single()
            .execute()
        )
    except Exception:  # noqa: BLE001
        return DEFAULT_AUTONOMY
    if not res or not res.data:
        return DEFAULT_AUTONOMY
    level = res.data.get("autonomyLevel") or DEFAULT_AUTONOMY
    if level not in ("observe", "ask", "auto-low", "autonomous"):
        return DEFAULT_AUTONOMY
    return level  # type: ignore[return-value]
