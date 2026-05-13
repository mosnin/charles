"""Stage catalog parity for the Python runtime.

Keep in sync with lib/stages/catalog.ts. The TS file is the source of
truth for the UI; this file is what advance_stage uses to seed gates.
Drift between the two means gates created at advance-time disagree with
what the UI displays — so the gate titles here must match the TS
catalog and the SQL function in 20260513000000_charles_stage_seeding.sql.
"""

from __future__ import annotations

Stage = str  # one of: idea, initial, identity, building, selling, scaling

STAGE_ORDER: list[Stage] = [
    "idea",
    "initial",
    "identity",
    "building",
    "selling",
    "scaling",
]

STAGES: dict[Stage, dict] = {
    "idea": {
        "label": "Idea",
        "purpose": "Charles knows what you're building and who it's for.",
        "gates": [
            "Define your company in one sentence",
            "Identify your target customer",
            "Connect GitHub",
        ],
    },
    "initial": {
        "label": "Initial",
        "purpose": "First working surface exists.",
        "gates": [
            "Claim a domain or repo",
            "Capture the brand voice",
            "Ship a first product surface",
        ],
    },
    "identity": {
        "label": "Identity",
        "purpose": "The product can be described to a stranger.",
        "gates": [
            "Approve the logo and wordmark",
            "Publish the landing page",
            "Review the core copy",
            "Claim the social handles",
        ],
    },
    "building": {
        "label": "Building",
        "purpose": "Charles is shipping the product.",
        "gates": [
            "Define the feature roadmap",
            "Deploy to production",
            "Run a real founder onboarding",
        ],
    },
    "selling": {
        "label": "Selling",
        "purpose": "Money flowing in.",
        "gates": [
            "Turn Stripe live",
            "Publish the pricing page",
            "Test the sales pitch",
            "Land the first paying customer",
        ],
    },
    "scaling": {
        "label": "Scaling",
        "purpose": "Charles defends the gains.",
        "gates": [
            "Run a support flow",
            "Wire the ops dashboard",
            "Track runway weekly",
        ],
    },
}


def gates_for_stage(stage: Stage) -> list[str]:
    """Ordered gate titles for the given stage, or [] if unknown."""
    entry = STAGES.get(stage)
    return list(entry["gates"]) if entry else []


def next_stage(stage: Stage) -> Stage | None:
    """The stage after `stage`, or None if `stage` is the last one."""
    try:
        i = STAGE_ORDER.index(stage)
    except ValueError:
        return None
    if i >= len(STAGE_ORDER) - 1:
        return None
    return STAGE_ORDER[i + 1]


def prev_stage(stage: Stage) -> Stage | None:
    """The stage before `stage`, or None if `stage` is the first one."""
    try:
        i = STAGE_ORDER.index(stage)
    except ValueError:
        return None
    if i <= 0:
        return None
    return STAGE_ORDER[i - 1]


__all__ = [
    "Stage",
    "STAGE_ORDER",
    "STAGES",
    "gates_for_stage",
    "next_stage",
    "prev_stage",
]
