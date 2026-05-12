"""Base class for all six Charles department agents.

Each department subclass sets `department` and `department_name`, then
optionally overrides `get_department_tools()`. Call `build_agent()` to
get an Agent instance ready to run.

The space_id is closed over at construction time — never taken from
LLM tool arguments — mirroring the AgentContext pattern from chippi.py.
"""

from __future__ import annotations

import os
from typing import Any

from agents import Agent, RunContextWrapper, function_tool

from config import settings
from db import supabase
from memory.layers import format_core_for_prompt, load_layers, set_core_slot
from memory.store import save_memory, search_similar


class BaseDepartmentAgent:
    """Base for all six Charles department agents."""

    department: str = ""       # subclasses set this — e.g. "engineering"
    department_name: str = ""  # human label  — e.g. "Engineering"

    def __init__(self, space_id: str) -> None:
        self.space_id = space_id

    # ── Base tools (available to every department) ───────────────────────────

    def get_base_tools(self) -> list[Any]:
        """Tools available to all department agents."""
        space_id = self.space_id

        @function_tool
        async def recall_memory(query: str) -> str:
            """Recall relevant memories for this space via semantic search."""
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

        @function_tool
        async def get_core_memory() -> str:
            """Get all core memory slots for this space."""
            layers = await load_layers(space_id)
            return format_core_for_prompt(layers.core)

        @function_tool
        async def update_core_memory(slot: str, value: str) -> str:
            """Update a core memory slot (e.g. company_name, github_repo, current_stage)."""
            await set_core_slot(space_id, slot, value)
            return f"Core memory updated: {slot} = {value}"

        return [recall_memory, store_memory, get_core_memory, update_core_memory]

    # ── Prompt construction ──────────────────────────────────────────────────

    def build_system_prompt(
        self,
        mission: dict | None,
        core: dict[str, str | None],
    ) -> str:
        """Build the system prompt from the department's .md template + live context."""
        prompts_dir = os.path.join(os.path.dirname(__file__), "_prompts")
        prompt_file = os.path.join(prompts_dir, f"{self.department}.md")

        if os.path.exists(prompt_file):
            with open(prompt_file) as f:
                template = f.read()
        else:
            template = (
                f"You are the {self.department_name} department agent for Charles."
            )

        mission_block = ""
        if mission:
            mission_block = (
                f"MISSION: {mission.get('title', '(not set)')} — "
                f"{mission.get('description', '')}\n"
                f"STAGE: {mission.get('stage', 'idea').upper()}"
            )

        core_block = format_core_for_prompt(core)

        return "\n\n".join(part for part in [template, mission_block, core_block] if part)

    # ── Context loading ──────────────────────────────────────────────────────

    async def load_context(self) -> tuple[dict | None, dict[str, str | None]]:
        """Load mission and core memory for this space."""
        db = await supabase()
        mission_res = await (
            db.table("Mission")
            .select("*")
            .eq("spaceId", self.space_id)
            .maybe_single()
            .execute()
        )
        mission = mission_res.data
        layers = await load_layers(self.space_id)
        return mission, layers.core

    # ── Department-specific tools (override in subclasses) ──────────────────

    def get_department_tools(self) -> list[Any]:
        """Subclasses override to add department-specific tools."""
        return []

    # ── Agent builder ────────────────────────────────────────────────────────

    async def build_agent(self) -> Agent:
        """Build and return an OpenAI Agent instance."""
        mission, core = await self.load_context()
        system_prompt = self.build_system_prompt(mission, core)
        tools = self.get_base_tools() + self.get_department_tools()
        return Agent[None](
            name=f"Charles — {self.department_name}",
            model=settings.worker_model,
            instructions=system_prompt,
            tools=tools,
        )
