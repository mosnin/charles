# WORKFLOW_BOUNDARIES.md

What an AI agent is and is NOT allowed to do inside this repository and at runtime, without explicit user approval.

---

## Why this file exists

Charles delegates real power to agents — they write code, send messages, charge cards, deploy, and act on a founder's behalf. Delegated power without explicit boundaries is how things go sideways. This file is the contract: what an agent may do freely, what requires the approval gate, what is forbidden without an explicit instruction from the founder, and how the kill-switch and audit trail are honored. Every agent (manager Charles, department agents, ad-hoc coding agents like Claude Code or Codex) operates under these rules.

---

## Always-allowed actions

These never require approval. They are local, reversible, and have no external side effects.

- Reading any file in the repo.
- Running typecheck (`pnpm typecheck`), lint (`pnpm lint`), and the local test suite (`pnpm test`, `pnpm test:contract`).
- Querying the local dev database for read-only inspection.
- Generating drafts (code, copy, emails, plans, designs) that are written to the draft store (`AgentDraft`) and not auto-sent or auto-merged.
- Updating in-repo documentation files (`*.md`) and proposing changes via PR.
- Searching long-term memory (`AgentMemory` via pgvector) and reading from core memory (`CoreMemory`).
- Recording working-memory scratchpad entries (`ExecutionStep.scratchpad`).
- Emitting `TelemetryEvent` rows for observability.

---

## Allowed-with-default-approval actions

These run through the approval gate. The agent prepares the action, opens an `AgentPausedRun`, emits a `permission_required` SSE event, and waits for the founder's approval before executing. A founder can raise a department to `autonomous` to skip the gate for that department's scope; until they do, default is approval-required.

- Any external write: API calls to third parties (Composio, MCP, custom adapters) that mutate state.
- Code commits to a tracked branch and PR merges into `main`.
- Sending email (Resend), SMS or voice (Telnyx), or any outbound message to a real person.
- Posting to social channels or any public surface.
- Charging cards or issuing refunds via Stripe.
- Deploying to production (Vercel, Modal, or any other target).
- Creating, transferring, or modifying domains and DNS.
- Creating or rotating integration credentials and API keys.
- Writing to Core Memory (`CoreMemory`) — see Memory boundaries.
- Spawning a sub-agent run that itself can take any of the above actions.

---

## Never-allowed-without-explicit-user-instruction actions

These require a direct, in-session instruction from the founder. An agent may not take them based on inferred intent, prior context, or a stale instruction.

- Disabling or weakening Clerk auth, the auth middleware, or RLS policies.
- Disabling or bypassing the approval gate (`AgentPausedRun` / `AgentDraft` / `permission_required` SSE).
- Disabling the kill-switch or removing kill-switch checks.
- Force-pushing to `main` or any protected branch.
- Deleting branches, tags, or releases.
- Dropping tables, truncating tables, or running destructive migrations outside the expand-contract path.
- Modifying or rotating Stripe webhook secrets, Clerk webhook secrets, or other webhook signing keys.
- Granting new OAuth scopes to an existing integration or installing a new integration that requests broader scopes than the prior version.
- Training on founder or user data, or sending founder/user data to any third party not already in `ENVIRONMENT.md`.
- Exfiltrating data outside the configured stack (no ad-hoc uploads, no "for backup" copies to external services).
- Bypassing the prompt sanitizer on either input or output paths.
- Removing audit log entries or cost-tracker entries.
- Editing committed migrations in place (write a new migration instead).

---

## Department autonomy levels

Each of the six departments (Engineering, Sales, Marketing, Design, Support, Ops/Finance) runs at one of four autonomy levels. The founder sets the level per department. The level governs what triggers the approval gate.

- **observe** — Agent may read and propose. No drafts are created automatically; no external action is taken. Every proposal surfaces as a notification.
- **ask** — Agent may read, propose, and prepare drafts. Every external write opens the approval gate before executing. This is the safe default.
- **auto-low** — Agent may execute low-impact actions autonomously (defined per department, capped by cost and blast radius). Anything above the cap opens the approval gate.
- **autonomous** — Agent may execute any action in its scope without per-action approval. Always-forbidden actions above still require explicit instruction. Telemetry, audit, cost-tracker, and kill-switch still apply.

Defaults at install:

- Engineering — `ask`
- Sales — `ask`
- Marketing — `ask`
- Ops/Finance — `ask`
- Support — `auto-low`
- Design — `auto-low`

Founders can raise or lower any department at any time. Lowering takes effect immediately; raising requires a confirmation step.

---

## Memory boundaries

Charles uses three memory layers. Each has different write rules.

- **Working memory** (`ExecutionStep.scratchpad`) — per-turn, ephemeral, agent-writable. Wiped at run end. No PII rules beyond the sanitizer.
- **Core memory** (`CoreMemory`, ~20 slots, always injected verbatim into the agent's context) — high-signal facts about the founder, the company, and active priorities. Agents may propose writes; writes require approval unless the founder has set Core memory to autonomous. Agents may not write into core memory: personal PII (SSN, government ID, home address) without explicit founder consent; third-party secrets, API keys, or credentials; founder bank, card, or financial-account numbers; raw user data belonging to the founder's customers. Anything sensitive that needs to influence behavior should live behind a reference, not in the slot itself.
- **Long-term memory** (`AgentMemory`, pgvector) — agent-writable for run summaries, learned patterns, and recall snippets. Same content prohibitions as core memory. Sanitizer runs on every write.

If an agent is about to write something to memory and is unsure whether it crosses a line, the answer is don't — pause and ask.

---

## Kill-switch

Every agent run must check the `kill-switch` table at the start of each step and abort cleanly if a kill flag is set for that scope (global, founder, department, or run). The check is a single read against an indexed table; there is no excuse to skip it. On abort, the agent writes a final `TelemetryEvent` with the abort reason, marks the run as `killed`, and releases any approval-gate locks. No external action is taken on a killed run, even one mid-flight.

---

## Audit and cost

Every external action — every approval-gated write, every third-party call, every send, every charge, every deploy — produces a `TelemetryEvent` row (who, what, when, scope, outcome) and a `cost-tracker` entry (tokens, dollars, vendor). Non-negotiable. Telemetry and cost-tracker calls are not optional, not debug-only, and not behind a feature flag. An action that cannot be audited and costed cannot ship.

---

## Escalation

When in doubt, pause. The default move is to open an `AgentPausedRun`, emit a `permission_required` SSE event with a tight summary of the proposed action and its blast radius, and wait. The founder either approves, rejects, or rewrites the action. Acting without approval when the gate exists is worse than missing the window — the gate is the product. If the agent is unable to open the gate (infrastructure failure), it must abort the run rather than proceed unattended.
