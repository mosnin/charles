"""Department agent registry for Charles.

The manager (`agent/manager/charles.py`) looks up department agents here
when delegating work, so the manager never imports concrete department
classes directly. Adding a department = wire it into this map; nothing
else has to change at the call site.
"""

from __future__ import annotations

from departments._base import BaseDepartmentAgent
from departments.design import DesignAgent
from departments.engineering import EngineeringAgent
from departments.marketing import MarketingAgent
from departments.ops_finance import OpsFinanceAgent
from departments.sales import SalesAgent
from departments.support import SupportAgent

DEPARTMENT_REGISTRY: dict[str, type[BaseDepartmentAgent]] = {
    "engineering": EngineeringAgent,
    "sales": SalesAgent,
    "marketing": MarketingAgent,
    "design": DesignAgent,
    "support": SupportAgent,
    "ops_finance": OpsFinanceAgent,
}

__all__ = ["BaseDepartmentAgent", "DEPARTMENT_REGISTRY"]
