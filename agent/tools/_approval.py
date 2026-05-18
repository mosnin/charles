"""Runtime enforcement of per-department autonomy on mutating tools.

A mutating tool calls gate_or_execute() with a label, risk level, and
a callable that performs the actual mutation. The helper inspects the
department's autonomy and returns one of:

  - "BLOCKED: ..."                  when autonomy = 'observe'
  - "ACTION REQUIRES APPROVAL: ..." when autonomy = 'ask', or 'auto-low' on a 'high'-risk action
  - <result of execute_fn()>        when autonomy = 'autonomous', or 'auto-low' on 'low' risk
"""

from __future__ import annotations

from typing import Awaitable, Callable, Literal

from lib.autonomy import get_department_autonomy

Risk = Literal["low", "high"]


async def gate_or_execute(
    *,
    space_id: str,
    department: str,
    action_label: str,
    risk: Risk,
    execute_fn: Callable[[], Awaitable[str]],
) -> str:
    autonomy = await get_department_autonomy(space_id, department)
    if autonomy == "observe":
        return f"BLOCKED: {department} is in observe mode. {action_label} not executed."
    if autonomy == "autonomous":
        return await execute_fn()
    if autonomy == "auto-low" and risk == "low":
        return await execute_fn()
    return f"ACTION REQUIRES APPROVAL: {action_label}"
