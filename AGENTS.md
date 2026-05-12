# AGENTS.md

Operating manual for any AI agent (Claude Code, OpenAI Codex, Cursor, etc.) working inside this repository. Read this file before editing anything.

---

## What this repo is

Charles is an AI cofounder. The product (and the manager agent at the center of it) is named Charles. Charles runs an entire company across six departments — Engineering, Sales, Marketing, Design, Support, Ops/Finance — so a solo founder can ship from idea to revenue without hiring. Charles enforces stage gates (Idea → Initial → Identity → Building → Selling → Scaling), keeps layered memory (working, core, long-term), and routes every external write through an approval gate by default. This is a Next.js 15 + Supabase + Modal codebase; the agent runtime lives in `agent/` (Python, OpenAI Agents SDK) and the surface layer in `app/`.

---

## Pivot status

This repository is mid-pivot. The previous product was a single-tenant CRM for U.S. realtors. Realtor-shaped code, vocabulary, tables, and routes are still present and are being removed phase by phase per `ROADMAP.md`. While that cleanup is in flight:

- Any new code must follow the Charles model: manager agent dispatches to department agents, agents run with explicit memory layers, every external side effect passes through the approval gate.
- Do not extend the old model. Do not add features under realtor-shaped routes, helpers, or tables. If a task forces you near legacy code, prefer to delete or rename it toward the Charles model rather than build on top of it.
- The legacy `Contact` / `Deal` tables are being renamed to `Person` / `PipelineObject` in Phase 1 using expand-contract: add new tables, dual-write, cut over, then drop. Do not edit the old tables in place.
- The legacy "Brokerage" tier is being renamed to "Team" in Phase 1. Do not introduce new code under `app/broker/*` or `lib/brokerage-*`.

When in doubt about whether a piece of code is legacy or current, check `PRODUCT_SCOPE.md` and `ROADMAP.md`. If it isn't in either, treat it as legacy.

---

## Rules of the road

Non-negotiables. These apply to every agent, every task.

- Never disable, bypass, or weaken the approval gate (`AgentPausedRun`, `AgentDraft`, `permission_required` SSE), RLS, the Clerk auth middleware, or the kill-switch table.
- Never bypass the cost-tracker or telemetry. Every external action emits a `TelemetryEvent` and a cost-tracker entry.
- Never invent or guess environment variable names. Check `.env.example` first; if a var isn't there and you need it, add it to `.env.example` with a placeholder and surface it in your report.
- Never commit secrets. The prompt sanitizer (input + output scrubbing) stays in place; do not route around it.
- Never write new code that hard-codes legacy realtor vocabulary or behavior. New strings, types, tables, routes, and copy use Charles vocabulary (founder, department, run, stage, person, pipeline object).
- Migrations are append-only. To remove or rename, write a new migration ("drop X", "rename Y to Z"). Do not edit committed migrations.
- Expand-contract is the chosen DB strategy for the `Contact → Person` and `Deal → PipelineObject` renames in Phase 1. Add new tables and dual-write before dropping the old ones.
- The "Brokerage" tier is being renamed to "Team" in Phase 1. Do not create new code under `app/broker/*` or `lib/brokerage-*`.
- Read before writing. Always.
- Stay in scope. Don't drive-by refactor. Don't add dependencies without explicit instruction.
- When unsure, pause and ask via the approval gate. Don't guess at side effects.

---

## Project structure

```
agent/         Python agent runtime: manager + department agents, OpenAI Agents SDK, Modal deploy entrypoint
app/           Next.js 15 App Router: routes, API handlers, SSE proxies, server actions
components/    React 19 UI components, shared primitives, brand surfaces
lib/           TypeScript libs: db clients, auth helpers, integrations, agent tooling, sanitizer, cost-tracker
plugins/       Slash-command plugin packs loaded by Charles at runtime
supabase/      schema.sql, migrations/, RLS policies, seed data
docs/          Internal reference docs (architecture deep-dives, contracts)
```

Top-level docs you should know: `PRODUCT_SCOPE.md`, `ROADMAP.md`, `STYLESHEET.md`, `WORKFLOW_BOUNDARIES.md`, `CLAUDE.md`, `SECURITY.md`, `ARCHITECTURE.md`, `DB_CONVENTIONS.md`, `ENVIRONMENT.md`.

---

## Stack

- Next.js 15 (App Router, Turbopack)
- React 19
- TypeScript 5.8
- Clerk (auth + middleware)
- Supabase Postgres + pgvector (data, RLS, embeddings)
- Modal (Python agent runtime sandbox)
- OpenAI Agents SDK (manager + department agents)
- Upstash Redis (rate limits, ephemeral state)
- Stripe (billing)
- Resend (email), Telnyx (SMS)
- Composio (third-party integration adapters)
- MCP server (external tool surface)

---

## Commands

Run from the repo root with `pnpm`.

```
pnpm install         Install dependencies
pnpm dev             Next.js dev server (Turbopack)
pnpm build           Production build
pnpm lint            next lint
pnpm typecheck       tsc --noEmit
pnpm test            vitest run
pnpm test:watch      vitest (watch mode)
pnpm test:contract   node --test scripts/*.test.mjs
pnpm eval            Eval suite (RUN_EVALS=1)
```

Database migrations live in `supabase/migrations/` and are applied via the Supabase CLI / dashboard against the target project. There is no `pnpm db:migrate` script; check `supabase/` and `ENVIRONMENT.md` before touching schema. The Python agent runtime is deployed with `modal deploy agent/modal_app.py`.

---

## How agents should think

This repo runs under a dual-persona operating mode defined in `CLAUDE.md`. It applies to every AI agent working here, not just Claude.

**Engineering, infrastructure, integrations, anything logical — Musk lens.** First-principles. Delete first. Question every constraint. Push for the simplest thing that works. Be honest about failure modes. Hostile to ceremony. Bias toward speed. Treat your own prior commits with the same skepticism you'd apply to anyone else's.

**Product, design, UX, naming, copy, prioritization, anything the user sees or feels — Jobs lens.** The product is one idea. Cut, don't add. Sweat every detail. Configuration is failure to decide. Documentation inside the product is a confession that the design didn't self-explain. Trust your taste. Refuse mediocrity.

Switch lenses when the task type switches, and name the switch in your reply. Full spec lives in `CLAUDE.md`.

---

## Where to start

- `PRODUCT_SCOPE.md` — what Charles is, who it's for, the six departments, the stage gates
- `ROADMAP.md` — the phases, what's shipping now, what's next
- `WORKFLOW_BOUNDARIES.md` — what an agent is and is not allowed to do without approval
- `STYLESHEET.md` — required reading before any UI work
- `CLAUDE.md` — dual-persona operating mode in full
- `SECURITY.md` — protected systems, secret handling, sanitizer contract
- `ENVIRONMENT.md` — env vars, deploy targets, runtime topology
