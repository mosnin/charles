"""Design department agent for Charles.

Produces the logo, the landing page, the brand system, the product surface.
Sweats every pixel. Refuses configuration as a substitute for a decision.
"""

from __future__ import annotations

from departments._base import BaseDepartmentAgent


class DesignAgent(BaseDepartmentAgent):
    department = "design"
    department_name = "Design"

    def get_department_tools(self) -> list:
        return []
