# ENVIRONMENT.md

Configuration and external-service reference for Charles. Based on actual
repository code — every variable below is read somewhere in `app/`, `lib/`,
`middleware.ts`, or `agent/`.

Charles runs as two deployed pieces:

- **The Next.js app** (Vercel) — web UI, API routes, onboarding, workspace.
- **The agent runtime** (Modal) — `agent/modal_app.py`, where `CharlesManager`
  actually runs chat turns and autonomous work.

They share secrets. A variable needed by the agent must be set in **both**
Vercel env **and** the Modal `charles-secrets` secret.

---

## 1. Tier 0 — the app will not boot without these

| Variable | Used by | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/supabase.ts`, `agent/config.py` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client Supabase | Project API keys → `anon` `public` |
| `SUPABASE_SERVICE_ROLE_KEY` | server Supabase, `agent/config.py` | Bypasses RLS — never ship to client. Mark **Sensitive** in Vercel |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk SDK (client) | Auth UI won't render without it |
| `CLERK_SECRET_KEY` | Clerk SDK (server), `middleware.ts` | Server auth + route protection. **Sensitive** |
| `CLERK_WEBHOOK_SECRET` | `app/api/webhooks/clerk` | Signing secret for the Clerk → Charles user-sync webhook. **Sensitive** |

---

## 2. Tier 1 — the agent runtime

Charles's chat, autonomous runs, and swarm all live on Modal. Without these
the workspace renders but the agent does nothing.

| Variable | Used by | Notes |
|---|---|---|
| `OPENAI_API_KEY` | `lib/embeddings.ts`, `agent/config.py` | Model inference + embeddings. **Sensitive** |
| `MODAL_CHAT_URL` | `app/api/ai/task` | The `chat_turn` endpoint from `modal deploy agent/modal_app.py` |
| `MODAL_SWARM_URL` | `app/api/swarm/*` | The `run-swarm` endpoint |
| `MODAL_WEBHOOK_URL` | agent trigger path | The `run_now_webhook` endpoint |
| `MODAL_BRIDGE_URL` | `app/api/agent-bridge/*` | Bridge base URL |
| `MODAL_BRIDGE_URL_DELEGATE` | `app/api/agent-bridge/delegate` | `bridge-delegate` endpoint |
| `MODAL_BRIDGE_URL_ADVANCE_STAGE` | `app/api/agent-bridge/advance-stage` | `bridge-advance-stage` endpoint |
| `MODAL_BRIDGE_URL_GET_MISSION` | `app/api/agent-bridge/get-mission` | `bridge-get-mission` endpoint |
| `MODAL_BRIDGE_URL_UPDATE_CORE_MEMORY` | `app/api/agent-bridge/update-core-memory` | `bridge-update-core-memory` endpoint |
| `MODAL_BRIDGE_SECRET` | bridge auth | Shared secret. `openssl rand -hex 32`. **Sensitive** |
| `AGENT_INTERNAL_SECRET` | `app/api/agent/*`, `agent/config.py` | Shared secret for cross-system calls. `openssl rand -hex 32`. **Sensitive** |
| `ENCRYPTION_KEY` | stored-credential encryption | `openssl rand -hex 32`. **Sensitive** |
| `NEXT_PUBLIC_CONVEX_URL` | live-state client | From `npx convex deploy` |
| `CONVEX_DEPLOYMENT` | Convex CLI | From `npx convex deploy` |
| `CONVEX_SERVICE_SECRET` | privileged Convex mutations | `openssl rand -hex 32`. **Sensitive** |
| `CONVEX_SERVICE_JWT` | Convex service auth | `openssl rand -hex 32`. **Sensitive** |
| `DATABASE_URL` | `agent/config.py` (Modal only) | Direct Postgres URL for async bulk reads. Supabase → Settings → Database → Connection string. **Sensitive** |

The agent models default to `gpt-5-mini` (`agent/config.py`). Override with
`orchestrator_model` / `worker_model` in `charles-secrets` only if you want a
different model.

---

## 3. Tier 2 — feature-specific (app boots without them; the feature doesn't)

| Variable | Powers | Failure if missing |
|---|---|---|
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Upstash Redis: rate limiting, pending-approval state, token budgets | Rate limiting + agent approval gating break |
| `COMPOSIO_API_KEY` | Loading a founder's connected toolkits as agent tools | Integrations show "connected" but aren't usable as tools. Must be in **both** Vercel and `charles-secrets` |
| `CRON_SECRET` | Authorizing Vercel cron endpoints | Cron jobs return 401 |
| `MCP_JWT_SECRET` | MCP server auth | MCP key issuance / OAuth fails |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + `STRIPE_PRICE_ID` | Billing checkout / portal / webhook | Billing flow fails. Skip entirely if v1 has no paid plan |
| `RESEND_API_KEY` + `RESEND_FROM_EMAIL` (or `FROM_EMAIL`) | Transactional + admin-broadcast email | Emails silently skipped |
| `POSTHOG_API_KEY` + `POSTHOG_HOST` + `POSTHOG_PROJECT_ID` | Workspace analytics page | Analytics page shows no data |
| `NEXT_PUBLIC_APP_URL` / `APP_URL` | Link construction in emails + agent → API calls | Falls back to `http://localhost:3000` |
| `NEXT_PUBLIC_ROOT_DOMAIN` | Public URL/domain construction | Falls back to a default domain |
| `LOG_LEVEL` | Server log verbosity | Defaults to `info` |
| `CHARLES_CHAT_RUNTIME` | Set to `ts` to use the in-process TS chat fallback instead of Modal | Defaults to Modal — leave unset in production |

### Agent-trigger tuning knobs (optional, sane defaults)

`AGENT_IMMEDIATE_EVENTS`, `AGENT_TRIGGER_DEDUPE_WINDOW_S`,
`AGENT_TRIGGER_OPS_ENABLED`, `AGENT_TRIGGER_OPS_SECRET`,
`CRON_PAUSED_RUNS_DISABLED` — leave unset unless you're tuning the
autonomous trigger pipeline.

---

## 4. Tier 3 — department integration adapters

Each Charles department agent can call out to third-party tools. These are
only needed if you want that department's tools live. All read in
`lib/integrations/adapters/*`.

| Variable | Department | Tool |
|---|---|---|
| `GITHUB_TOKEN` | Engineering | GitHub repo / PR actions |
| `CLOUDFLARE_API_TOKEN` | Engineering | DNS management |
| `VERCEL_TOKEN` | Engineering | Deploy actions |
| `LINKEDIN_ACCESS_TOKEN` | Marketing | LinkedIn posting |
| `TWITTER_BEARER_TOKEN` | Marketing | Twitter/X posting |
| `LOOPS_API_KEY` | Marketing | Loops email campaigns |
| `REPLICATE_API_TOKEN` | Design | Image generation |
| `SUPABASE_TARGET_URL` + `SUPABASE_TARGET_SERVICE_KEY` | Engineering | Operating on a *founder's own* Supabase project (not Charles's DB) |

---

## 5. The Modal `charles-secrets` secret

`agent/modal_app.py` loads a single Modal secret named `charles-secrets`.
It must contain everything `agent/config.py` reads plus anything the agent
tools touch:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`
- `OPENAI_API_KEY`
- `KV_REST_API_URL` + `KV_REST_API_TOKEN`
- `NEXT_PUBLIC_APP_URL`
- `AGENT_INTERNAL_SECRET`
- `MODAL_BRIDGE_SECRET`
- `ENCRYPTION_KEY`
- `NEXT_PUBLIC_CONVEX_URL` + `CONVEX_SERVICE_SECRET`
- `COMPOSIO_API_KEY` (if integrations are in use)
- Any Tier 3 adapter tokens for departments you've enabled

---

## 6. Local vs production

| Aspect | Local | Production |
|---|---|---|
| Protocol | `http` (from `NODE_ENV`) | `https` |
| Build | `pnpm dev` (Turbopack) | `pnpm build` |
| Agent runtime | Modal (or `CHARLES_CHAT_RUNTIME=ts` fallback) | Modal |
| `.env` files | `.env.local`, gitignored | Vercel env + Modal `charles-secrets` |

---

## 7. Third-party services map

| Service | Role in Charles | Package |
|---|---|---|
| **Clerk** | Auth, sessions, route protection | `@clerk/nextjs` |
| **Supabase** | Source-of-truth DB + pgvector + file storage | `@supabase/supabase-js` |
| **OpenAI** | Model inference + embeddings | `openai` |
| **Modal** | The agent runtime — `CharlesManager`, departments, swarm | (Python, `agent/`) |
| **Convex** | Live state — presence, live messages, canvas activity | `convex` |
| **Upstash Redis** | Rate limiting, pending-approval state, token budgets | `@upstash/redis` |
| **Composio** | Loading a founder's connected toolkits as agent tools | `@composio/*` |
| **Stripe** | Billing (optional for v1) | `stripe` |
| **Resend** | Transactional + broadcast email | `resend` |
| **Vercel** | Hosting + analytics | `@vercel/*` |

---

## 8. Supabase setup checklist

1. **Create the project** — pick a region near your Vercel region.
2. **Enable pgvector** — Dashboard → Database → Extensions → enable `vector`.
3. **Apply the schema** — `npx supabase link --project-ref <ref>` then
   `npx supabase db push`. The whole schema is one file:
   `supabase/migrations/00000000000000_charles_baseline.sql` — every table,
   RLS policy, index, and RPC, including `DocumentEmbedding` + `match_documents`.
4. Charles embeds and indexes workspace content automatically as it's created.
