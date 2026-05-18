# DB_CONVENTIONS.md

Database naming conventions, query patterns, and migration safety rules for Chippi.

Prevents issues like the `subdomain` vs `slug` column mismatch that broke the app after the Prisma migration.

---

## 1. Naming conventions

### Tables: PascalCase

```
User, Space, SpaceSetting, Contact, Deal, DealStage, DealContact, DealActivity
Tour, TourPropertyProfile, TourAvailabilityOverride, TourWaitlist, TourFeedback
Conversation, Message, DocumentEmbedding
Brokerage, BrokerageMembership, Invitation
GoogleCalendarToken, BrokerNotification, AuditLog, ContactDocument
```

### Columns: camelCase

```
clerkId, spaceId, ownerId, createdAt, updatedAt, leadScore, scoreLabel,
applicationData, lastContactedAt, onboardingCurrentStep, platformRole
```

### Indexes: snake_case with prefix

```
idx_user_clerk_id, idx_space_owner_id, contact_space_created_idx,
deal_space_position_idx, audit_actor_created_idx
```

### CHECK constraint values: mixed case by domain

- Contact types: UPPERCASE — `'QUALIFICATION'`, `'TOUR'`, `'APPLICATION'`
- Deal priority: UPPERCASE — `'LOW'`, `'MEDIUM'`, `'HIGH'`
- Deal status: lowercase — `'active'`, `'won'`, `'lost'`, `'on_hold'`
- Roles: lowercase — `'user'`, `'admin'`, `'broker_owner'`, `'broker_admin'`, `'realtor_member'`
- Brokerage status: lowercase — `'active'`, `'suspended'`

**Rule**: Follow the existing convention for the domain. Don't mix UPPERCASE and lowercase within the same enum column.

---

## 2. Column rules

### Primary keys

- Type: `text`
- Default: application-generated CUID or `gen_random_uuid()::text`
- Never use `serial`/`bigserial` — all IDs are text UUIDs

### Timestamps

- Type: `timestamptz` (NOT `timestamp`)
- Default: `now()`
- Naming: `createdAt`, `updatedAt`, `expiresAt`, `startsAt`, `endsAt`

### Foreign keys

- Always use `ON DELETE CASCADE` for child records scoped to a parent
- Use `ON DELETE SET NULL` for optional links (e.g., `Tour.contactId`)
- Use `ON DELETE RESTRICT` for ownership that must be reassigned first (e.g., `Brokerage.ownerId`)

### Multi-tenant scoping

- **Every tenant-scoped table MUST have a `spaceId` column** with FK to `Space.id`
- This is the primary isolation mechanism — all queries must filter by `spaceId`
- Tables without `spaceId`: `User`, `Brokerage`, `BrokerageMembership`, `Invitation`, `AuditLog`

---

## 3. Critical column reference

These columns have caused bugs in the past. Use the correct names.

| Table | Column | Correct name | NOT this | Notes |
|-------|--------|-------------|----------|-------|
| Space | workspace identifier | `slug` | ~~subdomain~~ | Legacy Prisma `@map("subdomain")` was wrong. Column is `slug`. |
| User | onboarding flag | `onboard` | ~~onboardingCompleted~~ | Boolean, not timestamp. `onboardingCompletedAt` is audit-only. |
| Space | owner | `ownerId` | ~~userId~~ | UNIQUE constraint — one space per user |
| SpaceSetting | space link | `spaceId` | ~~settingsId~~ | UNIQUE constraint — one settings row per space |

---

## 4. Query patterns

### Use the Supabase PostgREST query builder (preferred)

```typescript
// Good — parameterized, safe
const { data, error } = await supabase
  .from('Contact')
  .select('*')
  .eq('spaceId', space.id)
  .order('createdAt', { ascending: false });
```

### Never use string interpolation for user input

```typescript
// BAD — SQL injection risk
const { data } = await supabase.rpc('some_function', {
  p_name: `'${userInput}'`  // NEVER do this
});

// GOOD — parameterized
const { data } = await supabase.rpc('some_function', {
  p_name: userInput  // Supabase handles escaping
});
```

### ILIKE search escaping

When building search filters with user input, always escape special characters:

```typescript
const escaped = q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
const sanitized = escaped.replace(/[,()]/g, '');  // Remove PostgREST syntax chars
const term = `%${sanitized}%`;

query.or(`name.ilike.${term},email.ilike.${term}`);
```

### Atomic operations: use RPC functions

For operations that need transaction isolation (concurrent writes, multi-table updates):

```typescript
// Good — atomic, handles race conditions
const { error } = await supabase.rpc('reorder_deal', {
  p_deal_id: dealId,
  p_new_stage_id: newStageId,
  p_new_position: newPosition,
});

// Good — prevents double-booking
const { data: bookedId } = await supabase.rpc('book_tour_atomic', { ... });

// Good — creates space + settings + stages in one transaction
const { data: spaceId } = await supabase.rpc('create_space_with_defaults', { ... });
```

### Single row queries

```typescript
.single();       // Throws if 0 or >1 rows
.maybeSingle();  // Returns null if not found (preferred for lookups)
```

### Pagination

```typescript
.range(offset, offset + limit - 1);  // 0-indexed, inclusive end
```

---

## 5. RPC functions (stored procedures)

| Function | Purpose | When to use |
|----------|---------|-------------|
| `match_documents` | Cosine similarity search over `DocumentEmbedding` | AI assistant RAG context |
| `match_agent_memory` | Cosine similarity search over `AgentMemory` with filters | Agent memory recall |
| `increment_agent_task_cost` | Atomic token+cost rollup on `AgentTask` | After each ExecutionStep |
| `rollup_cost_by_day` | Per-day totals over `CostEvent` grouped by dept+model | Usage dashboard |
| `cleanup_agent_data` | Daily retention sweep (capped per table) | Cron `/api/cron/cleanup` |
| `search_knowledge_docs` | Full-text search over `AppKnowledgeDoc` | Chippi knowledge recall |
| `seed_charles_workspace` | Bootstrap a new Charles space (Mission, CoreMemory, Departments, gates) | Onboarding complete |
| `seed_stage_gates` | Install canonical gate rows for one stage | Manager agent stage entry |
| `seed_workspace_documents` | Insert the nine canonical Charles document shells | Onboarding complete |

**Rule**: If an operation touches multiple tables or needs concurrency safety, create an RPC function. Don't do multi-step inserts in application code.

---

## 6. Migration safety

### Single canonical baseline

The fresh-install schema lives in **`supabase/migrations/00000000000000_charles_baseline.sql`**.
It is the single source of truth — there is no separate `schema.sql`, `setup.sql`, or
`combined_migration_v2.sql`. `npx supabase db push` against a fresh project
applies this file plus every later timestamped migration in order.

### Before writing a migration

1. Read the baseline file to confirm the current shape of the affected tables
2. Check existing migrations in `supabase/migrations/` (chronologically ordered after the baseline)
3. Verify column names against this doc

### Migration rules

1. **Never edit the baseline file** once it has been applied to any environment — stack new timestamped migrations on top
2. **Never rename columns** without an expand/contract plan (add new → migrate data → drop old)
3. **Always use `IF NOT EXISTS`** / `IF EXISTS` for idempotent migrations
4. **Always add defaults** for new NOT NULL columns on existing tables
5. **Never use `CREATE INDEX CONCURRENTLY`** — Supabase wraps each migration in a transaction and CONCURRENTLY is rejected inside transactions
6. **Never drop tables** without explicit instruction
7. **Test migrations** against a fresh database AND an existing database

### Migration naming

Format: `YYYYMMDDHHMMSS_description.sql`

Example: `20260314000003_org_system.sql`

---

## 7. RLS strategy

- RLS is **enabled on all tables** (defense-in-depth)
- Application uses **service_role key** which bypasses RLS
- Policies exist as a safety net if anon/authenticated keys are ever used
- All policies use the `current_user_internal_id()` helper function
- **Application-level tenant isolation is still required** — RLS is not the primary access control

---

## 8. Common mistakes to avoid

| Mistake | Why it's wrong | Correct approach |
|---------|---------------|-----------------|
| Using `"subdomain"` in SQL | Column was renamed to `slug` | Always use `"slug"` |
| Checking `onboardingCompletedAt` for routing | It's audit-only, can be null for legacy users | Check `User.onboard` boolean |
| Multi-step inserts without transaction | Race conditions, partial state | Use an RPC function |
| Forgetting `spaceId` filter | Cross-tenant data leakage | Always filter by `spaceId` |
| Using `timestamp` instead of `timestamptz` | Timezone bugs | Always use `timestamptz` |
| Using `.single()` for lookups | Throws on not-found | Use `.maybeSingle()` |
| Skipping ILIKE escaping | PostgREST filter injection | Escape `%`, `_`, `\`, `,`, `(`, `)` |
