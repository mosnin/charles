# Roadmap

What Charles is shipping, in order. Phases are commitments, not estimates with a buffer. If a phase slips, we cut scope, not standards.

Total: roughly 11.5 weeks from Phase 0 to Phase 6.

---

## Now (Phases 0–1)

### Phase 0 — Brand and doc reset (~0.5 wk)

Reset the surface. Rename the product, rebuild the landing, rewrite the core docs. No new features. No new agents. The repo speaks with one voice before the rebuild begins.

- New name, new logo, new landing page.
- `PRODUCT_SCOPE.md`, `README.md`, `ROADMAP.md`, `AGENTS.md`, `STYLESHEET.md`, `WORKFLOW_BOUNDARIES.md` rewritten or refreshed.
- Old vertical-CRM code marked for removal but not yet deleted.

### Phase 1 — Manager and first department, end to end (~3 wk)

The smallest version of Charles that is genuinely useful. One manager agent, one department (Engineering), one integration (GitHub), one memory system, one onboarding flow. The whole loop, working.

- **Manager agent.** Talks to the founder. Owns mission, roadmap, current stage. Delegates to Engineering.
- **Engineering department.** Reads and writes code via the GitHub adapter. Opens PRs. Requests review through the approval gate.
- **GitHub adapter.** Auth, repo access, PR creation, file read/write, branch management. Scoped tokens. Audit-logged.
- **Memory.** Working + core + long-term, with pgvector. Core slots populated during onboarding.
- **Onboarding.** Founder signs up, names the company, states the mission, picks the first move. Charles is ready.
- **Approval gate.** All external writes routed through approvals. Per-tool autonomy levels enforced. Kill switch live.

By the end of Phase 1, a solo founder can sign up, describe their idea, and have Charles open the first pull request against a real repo — with the founder approving every change.

---

## Next (Phases 2–3)

### Phase 2 — The other five departments and core integrations (~2 wk)

Sales, Marketing, Design, Support, Ops/Finance — each as a specialist agent with its own toolkit. The integrations the early departments need: Supabase, Vercel, Stripe.

- Sales, Marketing, Design, Support, Ops/Finance agents shipped.
- Supabase adapter (schema reads, migrations through approval).
- Vercel adapter (deploy hooks, env vars).
- Stripe adapter (read-only first; charges remain `ask`).
- Per-department toolkits scoped at the runtime layer.

### Phase 3 — Stages, roadmap UI, gates (~1.5 wk)

The company isn't just a chat. It's a journey through six stages with explicit exit gates. The founder sees where they are and what's next.

- Roadmap UI: mission, current stage, open work, recent approvals.
- Stage engine: `Idea → Initial → Identity → Building → Selling → Scaling`, with exit criteria.
- Stage gates Charles enforces, founder can override.
- Per-department autonomy controls in the UI.

---

## Later (Phases 4–6)

### Phase 4 — Creative and growth rails (~1.5 wk)

The tools Marketing and Design need to do real work, plus the rails for early go-to-market.

- Image and video generation through Replicate, OpenAI, Anthropic.
- Twitter and LinkedIn posting through the approval gate.
- Domain purchase via Cloudflare or Namecheap.
- Email rails through Resend and Loops.

### Phase 5 — Multi-seat, platform billing, observability (~2 wk)

The platform Charles runs on, not the product Charles makes.

- Multi-seat teams (founder + small number of teammates), with per-seat permissions.
- Platform billing on Stripe (Charles charges the founder, not the founder's customers).
- Cost tracker dashboard: per-model, per-department, per-day.
- Audit log explorer.
- Observability for the agent runtime (traces, retries, failures).

### Phase 6 — Open extension surface (~1 wk)

Make Charles extensible by people who don't work here.

- Public MCP server SDK for external clients.
- Documented plugin format for slash-command packs and skill bundles.
- Sample plugins published.

---

## Not on the roadmap

The things Charles will not become, restated for clarity. Mirrors `PRODUCT_SCOPE.md`.

- **No enterprise admin tooling.** No SSO directory sync, SCIM, or RBAC matrices.
- **No vertical CRMs.** Charles is horizontal; it is not a real-estate, legal, or medical product.
- **No team-of-50 collaboration.** Charles is for founding teams, not large orgs.
- **No human services marketplace.** Charles does the work or asks; it does not broker freelancers.
- **No autonomous incorporation, banking, or legal filings.** Those remain human.
- **No general-purpose chatbot.** Without a mission and a stage, Charles refuses to do work.
- **No no-code form builder.** Charles uses tools like Typeform and Notion; it does not replace them.
- **No black-box autonomy.** Approval gates and the kill switch are permanent.
- **No model training.** Charles uses frontier APIs; it does not fine-tune or host weights in v1.
