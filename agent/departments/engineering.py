"""Engineering department agent for Charles.

Handles code, repos, PRs, and infra. Delegates write actions via
the GitHub tools; all external actions surface an approval gate.
"""

from __future__ import annotations

from departments._base import BaseDepartmentAgent
from tools.engineering.github import (
    github_create_file,
    github_create_repo,
    github_open_pr,
    github_read_file,
)


class EngineeringAgent(BaseDepartmentAgent):
    department = "engineering"
    department_name = "Engineering"

    def get_department_tools(self) -> list:
        return [
            github_create_repo,
            github_create_file,
            github_open_pr,
            github_read_file,
        ]
