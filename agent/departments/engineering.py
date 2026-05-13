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
from tools.engineering.supabase import (
    supabase_describe_table,
    supabase_list_tables,
    supabase_run_select,
    supabase_stage_migration,
)
from tools.engineering.vercel import (
    vercel_get_env_vars,
    vercel_list_projects,
    vercel_set_env_var,
    vercel_trigger_deployment,
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
            vercel_list_projects,
            vercel_get_env_vars,
            vercel_set_env_var,
            vercel_trigger_deployment,
            supabase_list_tables,
            supabase_describe_table,
            supabase_run_select,
            supabase_stage_migration,
        ]
