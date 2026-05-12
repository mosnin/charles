# Charles

Your AI cofounder. One manager agent. Six departments. From idea to revenue without hiring.

---

## What it is

Charles is a manager agent that runs an entire company. The founder talks to one agent. That agent holds the mission, the roadmap, and the current stage of the company, and delegates work across engineering, sales, marketing, design, support, and Ops/Finance.

It is not a chatbot, not a wrapper over a model, not a no-code builder. It is a coordination layer over specialist agents, each with their own tools and skills, each accountable to the same founder.

It remembers what matters. It asks before it spends, ships, or speaks on your behalf. The founder stays in the chair.

---

## How it works

```
Founder (chat)
  └── Charles (manager agent)
        ├── Mission · Roadmap · Stage
        ├── Core memory  ·  Long-term memory
        └── Departments (handoff)
              ├── Engineering   →  GitHub · Supabase · Vercel
              ├── Sales          →  CRM · outbound email
              ├── Marketing     →  copy · image/video · social
              ├── Design        →  logo · landing · brand
              ├── Support        →  inbox · helpdesk
              └── Ops/Finance   →  Stripe · expenses · reporting

Every external write goes through an approval gate.
```

The company moves through six stages, in order: `Idea → Initial → Identity → Building → Selling → Scaling`. Each stage has exit gates Charles enforces. The founder can override.

Memory is layered: working (per-turn scratchpad), core (~20 persistent slots, always injected), long-term (pgvector recall on demand).

Autonomy is per-department and configurable: `observe`, `ask`, `auto-low`, `autonomous`. The default is `ask`.

See `PRODUCT_SCOPE.md` for the canonical definition. See `ROADMAP.md` for what's shipping.

---

## Stack

- Next.js 15 (App Router, Turbopack)
- React 19
- TypeScript 5.8
- Clerk auth
- Supabase (Postgres + pgvector)
- Upstash Redis
- Modal (Python agent runtime)
- OpenAI Agents SDK
- Stripe
- Resend
- Telnyx
- Composio
- MCP

---

## Run locally

```bash
pnpm install
pnpm dev
```

Copy `.env.example` to `.env.local` and fill in credentials. See `ENVIRONMENT.md` for the full variable reference. At minimum you need Clerk, Supabase, and a model provider key to boot the app.

Database setup: create a Supabase project, enable the `pgvector` extension, and run the migrations in `supabase/`.

The agent runtime runs on Modal. See `agent/README.md` (in the `agent/` directory) for deploying the Python runtime.

---

## Repo layout

```
agent/         Python / Modal agent runtime (manager + departments)
app/           Next.js routes, pages, API handlers
components/    React UI components
lib/           Shared TypeScript: auth, billing, memory, approvals, tools
plugins/       Plug-in slash-command packs and skill bundles
supabase/      SQL schema and migrations
docs/          Architecture notes, design system, internal references
```

---

## Contributing

Operating rules for humans and agents working in this repo live in `AGENTS.md` and `CLAUDE.md`. Read both before opening a PR. Protected systems (auth, billing, RLS, approval gating, kill switch, audit log, cost tracker) are non-negotiable — see `PRODUCT_SCOPE.md` for the list.

UI work must follow `STYLESHEET.md`. Workflow scope and boundaries are in `WORKFLOW_BOUNDARIES.md`.

---

## License

Proprietary. All rights reserved.
