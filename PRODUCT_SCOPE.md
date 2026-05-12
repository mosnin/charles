# Product Scope

The canonical definition of what Charles is, who it serves, and what it refuses to be. If a feature, screen, or commit contradicts this document, the feature is wrong — fix it back, don't drift the scope.

---

## What Charles is

Charles is your AI cofounder — a manager agent that runs an entire company across engineering, sales, marketing, design, support, and ops/finance, so a solo founder can ship from idea to revenue without hiring.

You talk to one agent. Charles holds the mission, the roadmap, and the current stage of the company. It delegates to specialist departments, keeps the work coherent across them, remembers what matters, and asks before it spends, ships, or speaks on your behalf. The founder stays in the chair. Charles does the work.

---

## Who it's for

- **Solo founders** building a software product who would otherwise need to hire five people they can't afford yet.
- **1–3 person teams** who want leverage, not headcount — engineers who need a marketer, designers who need an engineer, operators who need both.
- **Not** a fit for established companies with full departments already in place. Charles replaces the founding team, not the org chart. Companies past product-market fit should hire humans.

---

## What it does

**One manager. Six departments. Six stages. Three layers of memory. One approval gate.**

**Charles, the manager.** A single agent the founder talks to. It owns the mission, the roadmap, and the current stage. It routes work to departments, reconciles their output, and keeps the company moving in one direction.

**Six departments**, each a specialist agent with its own tools and skills:

- **Engineering** — writes, reviews, and ships code; manages repos, databases, deploys.
- **Sales** — finds prospects, drafts outreach, runs the pipeline, books calls.
- **Marketing** — writes copy, generates images and video, posts to social, runs launches.
- **Design** — produces the logo, the landing page, the brand system, the product surface.
- **Support** — triages the inbox, answers customers, escalates what matters.
- **Ops / Finance** — handles billing, expenses, vendors, and weekly reporting.

**Six stages** the company moves through, in order. Charles enforces the exit gates; the founder can override.

`Idea → Initial → Identity → Building → Selling → Scaling`

Each stage has a clear question to answer and a clear signal to move on. You don't write code before you know what you're building. You don't run ads before you have a thing to sell.

**Three layers of memory.**

- **Working memory** — the scratchpad for the current turn. Discarded after.
- **Core memory** — roughly twenty persistent slots, always injected into every prompt. The mission, the user, the stage, the open commitments. Small and load-bearing.
- **Long-term memory** — everything else, embedded into pgvector, recalled on demand.

**One approval gate.** Every external write — a commit to main, a charge to a customer, a message sent in the founder's name, a domain purchase — goes through an approval gate by default. Per-department autonomy is configurable: `observe`, `ask`, `auto-low`, `autonomous`. The default is `ask`. The founder is always one click from saying no.

---

## What it doesn't do

These are non-goals. Saying no to them is how Charles stays one thing.

1. **No enterprise admin tooling in v1.** No SSO directory sync, no SCIM, no fine-grained RBAC matrices. One founder, one company, maybe a couple of teammates.
2. **No vertical CRMs.** Charles is not a real-estate tool, not a legal tool, not a medical tool. It is a horizontal cofounder for software products.
3. **No team-of-50 collaboration.** No project management for large orgs. No multi-team handoffs. If you have fifty people, you don't need Charles, you need managers.
4. **No human services marketplace.** Charles does not connect you to freelancers, lawyers, or accountants. It does the work itself or it asks you.
5. **No autonomous incorporation, banking, or legal filings.** Charles will not form your LLC, open your bank account, or sign contracts. Those remain human.
6. **No general-purpose chatbot.** Charles is not a wrapper over a model. Without a mission, a stage, and a roadmap, it refuses to do work.
7. **No no-code form builder.** Charles is not a Typeform competitor, not a Notion competitor, not a Zapier competitor. It uses those tools; it does not replace them.
8. **No black-box autonomy.** Charles will not run unattended for days, spending money and shipping code, without approval gates. Autonomy is opt-in per department and reversible.
9. **No model training.** Charles uses frontier models through their APIs. It does not fine-tune, host, or distill its own weights in v1.

---

## Boundaries / protected systems

These systems are non-negotiable. Any agent — human or AI — working in this repo must respect them. Touching them requires explicit approval and a paper trail.

- **Auth** — Clerk. No bypasses. No shadow user tables. No "service accounts" with founder-level access.
- **Billing** — Stripe. No direct charges outside the billing module. No agent has a card on file it can swipe without an approval event.
- **Row-level security (RLS)** — every Supabase table is RLS-enforced. No service-role keys in client code. No queries that bypass the policy layer.
- **Approval gating** — every external write goes through the approvals subsystem. No tool may bypass the gate; tools that try are rejected at the runtime layer.
- **Kill switch** — a single founder-facing control that halts all agent activity, in-flight and queued. It must work in under one second. It is tested.
- **Audit log** — every tool call, every approval, every external write is logged with actor, timestamp, payload, and outcome. The log is append-only and queryable.
- **Cost tracker** — every model call, every paid API call, every cloud resource is metered against a per-founder budget. When the budget is exceeded, autonomy drops to `ask` automatically.

---

## Vocabulary

One-line definitions. Use these terms consistently across code, copy, and conversation.

- **Mission** — the one-sentence answer to "what is this company for?" Set once, edited rarely.
- **Roadmap** — the ordered list of outcomes Charles is driving toward. Living document.
- **Stage** — where the company is in `Idea → Initial → Identity → Building → Selling → Scaling`.
- **Department** — one of the six specialist agents (Engineering, Sales, Marketing, Design, Support, Ops/Finance).
- **Manager** — Charles itself; the single agent the founder talks to, which delegates to departments.
- **Core Memory** — the small, always-injected set of persistent facts about the founder, the company, and the current state.
- **Working Memory** — the per-turn scratchpad; discarded after the turn ends.
- **Long-term Memory** — the pgvector store of everything else, recalled on demand.
- **Approval** — a founder decision on a proposed external write. Granted, denied, or deferred.
- **Autonomy Level** — per-department setting: `observe`, `ask`, `auto-low`, `autonomous`. Default `ask`.
- **Integration** — a connection to an external system Charles can read from or write to (GitHub, Stripe, Resend, etc.).
- **Toolkit** — the set of tools a department can call. Scoped per department; not shared globally.
- **Plugin** — a third-party or user-authored bundle of skills, tools, and slash-commands that extends Charles.
