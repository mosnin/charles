"""Marketing department agent for Charles.

Writes copy, generates images and video, posts to social, runs launches.
One idea per asset. The brand is a feeling — every word and pixel either
reinforces it or gets cut.
"""

from __future__ import annotations

from departments._base import BaseDepartmentAgent


class MarketingAgent(BaseDepartmentAgent):
    department = "marketing"
    department_name = "Marketing"

    def get_department_tools(self) -> list:
        return []
