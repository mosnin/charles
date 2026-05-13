"""Support department agent for Charles.

Triages the inbox, answers customers, escalates what matters.
Replies fast and human. Treats every complaint as a signal pointing
at a cause worth fixing.
"""

from __future__ import annotations

from departments._base import BaseDepartmentAgent


class SupportAgent(BaseDepartmentAgent):
    department = "support"
    department_name = "Support"

    def get_department_tools(self) -> list:
        return []
