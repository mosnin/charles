# Fundraise Prep

The work before the work. A round goes faster when the deck, the data room, and the investor briefs are organised in advance — not assembled the night before the first call.

## What it does

- `/deck-outline` — Generates a 12-slide pitch deck outline grounded in what Charles already knows about your company. Emits the outline as a structured plan.
- `/data-room` — Audits your data room against a standard checklist, identifies gaps, and creates checklist items for the missing pieces.

## Skill bundles

- `fundraise_brief` — Briefs the founder on a specific investor: prior touchpoints, mutual contacts, warmest intro path, one specific question to ask. Uses `recall_history` and `find_person`.

## Who it's for

Founders preparing to fundraise — pre-seed through Series A — who have been keeping notes in Charles for at least a few months. If history is thin, the briefs will be thin.

## Assumptions

- `recall_history` returns prior notes on customers, traction, financials, and investor touchpoints.
- `find_person` can match names of investors and surface mutual contacts.
- `add_checklist_item` writes to a fundraise-related deal or checklist context the founder has already created.

## Install

Copy this folder into the repo's `plugins/` directory. Restart the server.

## Limits

- The deck outline is a starting frame, not finished work. Polish belongs to the founder.
- The data room audit checks against a generic checklist — your investors may ask for more or less.
