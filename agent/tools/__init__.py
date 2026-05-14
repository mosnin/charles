"""Tool modules for the Charles agents.

Each module is its own surface; the orchestrator and department agents
import what they need directly (e.g. `from tools.streaming import
publish_event`). We don't re-export submodules at package init to keep
import side-effects to the minimum the importer asked for.
"""
