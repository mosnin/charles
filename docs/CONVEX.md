# Convex

Charles uses Convex as its **live-state layer**. Supabase remains the system of record for everything durable. This is a hard split — see the "Data split: Convex vs Supabase" rule in `AGENTS.md`.

## What Convex does for Charles

Three tables only, all collaborative and ephemeral:

- `presence` — who's looking at which surface in this space right now, plus cursor coordinates
- `liveMessages` — chat messages in flight, before they're audit-backfilled into Supabase `TaskConversation`
- `canvasActivity` — transient "Engineering is building a prospect list" status pings, TTL 5 minutes

Everything else — Mission, Tasks, Documents, Audit, Billing, Memory, Person, PipelineObject — stays in Supabase.

## When to use Convex vs Supabase

Decision tree:

1. **Does it need to survive the user closing the tab?**
   - Yes → Supabase.
   - No → Convex.
2. **Is it a side effect on the founder's external accounts (email sent, contact upserted, invoice issued)?**
   - Yes → Supabase + the approval gate.
   - No → continue.
3. **Does every connected surface need to see the change within a frame, without a poll?**
   - Yes → Convex (reactive query).
   - No → Supabase (Server Component or server action).
4. **Is it auditable founder data?**
   - Yes → Supabase (every external action emits a `TelemetryEvent`).
   - No → Convex is fine.

If a Convex row crosses the durability line (a live chat message becomes audit-worthy because the founder approved a draft from it), backfill it to Supabase via the existing TS APIs and flip `persistedToSupabase = true` on the Convex row. That's the bridge — there is no other.

## Setup (founder/dev, one time)

1. Sign up at [convex.dev](https://convex.dev) and create a project named `charles`.
2. From the repo root, run `npx convex dev`. This:
   - Logs you in via the browser
   - Creates a deployment
   - Writes `NEXT_PUBLIC_CONVEX_URL` and `CONVEX_DEPLOYMENT` into `.env.local`
   - Generates real types into `convex/_generated/` (replacing the shipped stubs)
3. In the Clerk dashboard, **JWT Templates → New template → Convex**:
   - Name the template exactly `convex`
   - Note the **Issuer** URL (`https://your-instance.clerk.accounts.dev`)
4. Add `CLERK_JWT_ISSUER_DOMAIN` to `.env.local`, pointing at that issuer URL.
5. Locally, run `npx convex dev` in one terminal and `pnpm dev` in another. The Convex CLI watches `convex/*.ts` and re-deploys functions on save.

## Required env vars

```
NEXT_PUBLIC_CONVEX_URL=https://<deployment>.convex.cloud
CONVEX_DEPLOYMENT=<deployment-id>
CLERK_JWT_ISSUER_DOMAIN=https://<your-instance>.clerk.accounts.dev
```

`NEXT_PUBLIC_CONVEX_URL` is the only one the browser sees; the other two are deploy-time only.

## File layout

```
convex/
  _generated/        Stub now, generated types after `npx convex dev`
  auth.config.ts     Clerk JWT bridge — provider config only
  schema.ts          The 3 tables, with indexes
  presence.ts        heartbeat / listActive / clear
  liveMessages.ts    send / forConversation / markPersisted
  canvasActivity.ts  emit / forSpace / cleanup
```

Every function calls `ctx.auth.getUserIdentity()` first and rejects if missing — Convex is never callable without a valid Clerk JWT.

## What not to do

- Do not put durable data in Convex. Supabase is the system of record.
- Do not call Convex mutations from server-side code that already has Supabase access — write to Supabase directly.
- Do not add tables to Convex without a "this dies when the tab closes" justification. The point of the split is that adding a table here is cheap precisely because it doesn't need a migration, RLS policy, or audit trail. The moment it does need those, it belongs in Supabase.
