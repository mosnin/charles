"""Design department agent for Charles.

Produces the logo, the landing page, the brand system, the product surface.
Sweats every pixel. Refuses configuration as a substitute for a decision.
"""

from __future__ import annotations

from departments._base import BaseDepartmentAgent

# Design re-uses the marketing/-prefixed image-generation tools rather than
# duplicating them. The tools pass department='marketing' to gate_or_execute,
# so today Marketing's autonomy gates Design's image calls.
# TODO Phase 5: pipe caller dept into gate_or_execute so Design's autonomy
# gates its image-gen calls.
from tools.marketing.openai_images import (
    openai_edit_image,
    openai_generate_image,
)
from tools.marketing.replicate import (
    replicate_generate_image,
    replicate_get_prediction,
)


class DesignAgent(BaseDepartmentAgent):
    department = "design"
    department_name = "Design"

    def get_department_tools(self) -> list:
        return [
            replicate_generate_image,
            replicate_get_prediction,
            openai_generate_image,
            openai_edit_image,
        ]
