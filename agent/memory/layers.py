"""Memory layer loader for Charles agents.

Three-tier memory:
  core    — CoreMemory rows (structured key/value slots, fast lookup)
  working — per-run scratchpad, starts empty, agents mutate freely
  recent  — semantic pgvector recall from AgentMemory (long-term)

Usage:
    layers = await load_layers(space_id, query="product roadmap")
    prompt_block = format_core_for_prompt(layers.core)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from db import supabase
from memory.store import search_similar


@dataclass
class MemoryLayers:
    core: dict[str, str | None]   # {slot: value} for all CoreMemory rows
    working: dict[str, Any]       # per-run scratchpad, starts empty
    recent: list[dict]            # top-k AgentMemory hits from pgvector recall


async def load_layers(
    space_id: str,
    query: str = "",
    top_k: int = 8,
) -> MemoryLayers:
    """Load all three memory layers for a space."""
    db = await supabase()

    # Core memory: all slots for space
    core_res = await (
        db.table("CoreMemory")
        .select("slot,value")
        .eq("spaceId", space_id)
        .execute()
    )
    core: dict[str, str | None] = {
        row["slot"]: row["value"] for row in (core_res.data or [])
    }

    # Long-term: pgvector semantic recall
    recent: list[dict] = []
    if query:
        recent = await search_similar(
            space_id=space_id,
            query=query,
            limit=top_k,
        )

    return MemoryLayers(core=core, working={}, recent=recent)


def format_core_for_prompt(core: dict[str, str | None]) -> str:
    """Format core memory as a prompt injection block."""
    lines = ["## Core Memory"]
    for slot, value in core.items():
        display = value or "(not set)"
        lines.append(f"- {slot}: {display}")
    return "\n".join(lines)


async def set_core_slot(space_id: str, slot: str, value: str) -> None:
    """Upsert a single CoreMemory slot."""
    db = await supabase()
    await (
        db.table("CoreMemory")
        .upsert(
            {"spaceId": space_id, "slot": slot, "value": value},
            on_conflict="spaceId,slot",
        )
        .execute()
    )
