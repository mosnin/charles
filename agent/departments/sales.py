"""Sales department agent for Charles.

Finds prospects, drafts outreach, runs the pipeline, books calls.
Every outbound message earns its open. All sends are gated for
founder approval before they leave the building.
"""

from __future__ import annotations

from departments._base import BaseDepartmentAgent


class SalesAgent(BaseDepartmentAgent):
    department = "sales"
    department_name = "Sales"

    def get_department_tools(self) -> list:
        return []
