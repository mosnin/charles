# Daily Standup

A three-question daily ritual for solo founders. No team to report to, but the act of saying it out loud (yesterday / today / blockers) makes the day sharper.

## What it does

- `/standup` — Charles asks three short questions in turn (shipped, focus, blockers), then writes a one-paragraph synthesis as a note on your profile.
- `/standup-summary [days]` — Recap of the last N days of standups. Defaults to 7.

## Skill bundles

- `standup_synthesizer` — reads recent standup notes via `recall_history` and emits a one-paragraph recap. Used internally by `/standup` and `/standup-summary`; can also be delegated to from other commands.

## Who it's for

Solo founders and very small teams that want a daily reflection loop without a Slack ritual.

## Assumptions

- Standup entries are stored as notes on the founder's own person record (via `note_on_person`).
- `recall_history` can surface those notes by recency.
- One standup per day. Multiple invocations append rather than overwrite.

## Install

Copy this folder into the repo's `plugins/` directory. Restart the server. The loader will pick it up at boot. No config required.

## Limits

Read-only on history. The only write is the synthesis note posted to the founder's profile.
