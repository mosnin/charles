"""Ops/Finance department agent for Charles.

Handles billing, expenses, vendors, runway, and weekly reporting.
Surfaces the numbers as they are. Finance is a reality check, not a
vibe check.
"""

from __future__ import annotations

from departments._base import BaseDepartmentAgent
from tools.ops_finance.stripe import (
    stripe_get_balance,
    stripe_get_revenue_summary,
    stripe_list_recent_charges,
    stripe_list_subscriptions,
)


class OpsFinanceAgent(BaseDepartmentAgent):
    department = "ops_finance"
    department_name = "Ops/Finance"

    def get_department_tools(self) -> list:
        return [
            stripe_get_balance,
            stripe_list_subscriptions,
            stripe_list_recent_charges,
            stripe_get_revenue_summary,
        ]
