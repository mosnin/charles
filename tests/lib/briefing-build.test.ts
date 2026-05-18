/**
 * Unit tests for `buildDailyBriefing` and its internal helpers.
 *
 * Strategy: mock `@/lib/observability/audit-feed` and `@/lib/supabase` so the
 * builder runs against in-memory fixtures. Supabase mock uses a thenable
 * chain that takes its terminal value from a queue, mirroring the pattern
 * used in `tests/api/agent-sweep.test.ts`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Audit-feed mock ─────────────────────────────────────────────────────────
type AuditEvt = {
  id: string;
  type: string;
  occurredAt: string;
  actor: 'agent' | 'founder' | 'system';
  department?: string;
  summary: string;
  ref?: { kind: string; id: string };
};
let auditEvents: AuditEvt[] = [];

vi.mock('@/lib/observability/audit-feed', () => ({
  loadAuditFeed: vi.fn(async () => auditEvents.slice()),
}));

// ── Supabase mock ───────────────────────────────────────────────────────────
type Terminal = { data?: unknown; error?: unknown; count?: number | null };
let supabaseQueue: Terminal[] = [];

vi.mock('@/lib/supabase', () => {
  function makeChain(): Record<string, unknown> {
    const terminal = supabaseQueue.shift() ?? { data: null, error: null };
    const chain: Record<string, unknown> = {};
    const passthrough = ['select', 'eq', 'in', 'is', 'not', 'gte', 'lt', 'order', 'limit', 'contains'];
    for (const m of passthrough) chain[m] = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(() => Promise.resolve(terminal));
    chain.single = vi.fn(() => Promise.resolve(terminal));
    chain.then = (resolve: (v: Terminal) => unknown, reject?: (e: unknown) => unknown) => {
      try {
        return Promise.resolve(terminal).then(resolve, reject);
      } catch (e) {
        return reject ? reject(e) : Promise.reject(e);
      }
    };
    return chain;
  }
  return { supabase: { from: vi.fn(() => makeChain()) } };
});

// Mocks first — import after.
import {
  buildDailyBriefing,
  _internals,
} from '@/lib/briefing/build-daily-briefing';

const NOW = new Date('2026-05-13T10:00:00Z');
const YESTERDAY = new Date('2026-05-12T15:00:00Z').toISOString();

/**
 * Queue the six supabase reads that buildDailyBriefing performs in order:
 *   1. Space lookup
 *   2. User (owner) lookup
 *   3. AgentDraft pending count
 *   4. AgentPausedRun pending count
 *   5. AgentTask stalled count
 *   6. WorkspaceStage current stage
 */
function queueAll(opts: {
  space?: { id: string; name: string; slug: string; ownerId: string } | null;
  owner?: { id: string; email: string; name: string | null } | null;
  pendingDrafts?: number;
  pausedRuns?: number;
  stalledTasks?: number;
  stage?: string | null;
}) {
  const space = opts.space === undefined
    ? { id: 'space-1', name: 'Acme', slug: 'acme', ownerId: 'user-1' }
    : opts.space;
  const owner = opts.owner === undefined
    ? { id: 'user-1', email: 'jane@acme.test', name: 'Jane Doe' }
    : opts.owner;
  supabaseQueue = [
    { data: space, error: null },
    { data: owner, error: null },
    { data: null, error: null, count: opts.pendingDrafts ?? 0 },
    { data: null, error: null, count: opts.pausedRuns ?? 0 },
    { data: null, error: null, count: opts.stalledTasks ?? 0 },
    { data: opts.stage === null ? null : { stage: opts.stage ?? 'building' }, error: null },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  auditEvents = [];
  supabaseQueue = [];
});

describe('firstNameOf', () => {
  it('takes the first whitespace-separated token', () => {
    expect(_internals.firstNameOf('Jane Doe')).toBe('Jane');
    expect(_internals.firstNameOf('  Alex   Park ')).toBe('Alex');
  });
  it('returns null for empty / null', () => {
    expect(_internals.firstNameOf(null)).toBeNull();
    expect(_internals.firstNameOf('')).toBeNull();
    expect(_internals.firstNameOf('   ')).toBeNull();
  });
});

describe('summarizeHighlights', () => {
  it('returns empty when no interesting events', () => {
    const out = _internals.summarizeHighlights([
      { id: 'a', type: 'agent_run_started', occurredAt: YESTERDAY, actor: 'agent', summary: 'x' },
    ] as never);
    expect(out).toEqual([]);
  });

  it('rolls up draft acceptances into a single line', () => {
    const evts = Array.from({ length: 3 }, (_, i) => ({
      id: `d${i}`,
      type: 'draft_accepted' as const,
      occurredAt: YESTERDAY,
      actor: 'founder' as const,
      summary: 'You approved the email.',
    }));
    const out = _internals.summarizeHighlights(evts as never);
    expect(out).toContain('You approved 3 drafts.');
  });

  it('groups agent_run_completed by department', () => {
    const out = _internals.summarizeHighlights([
      { id: '1', type: 'agent_run_completed', occurredAt: YESTERDAY, actor: 'agent', department: 'Engineering', summary: 'x' },
      { id: '2', type: 'agent_run_completed', occurredAt: YESTERDAY, actor: 'agent', department: 'Engineering', summary: 'y' },
      { id: '3', type: 'agent_run_completed', occurredAt: YESTERDAY, actor: 'agent', department: 'Marketing', summary: 'z' },
    ] as never);
    expect(out.some((s) => s.includes('Engineering completed 2 runs.'))).toBe(true);
    expect(out.some((s) => s.includes('Marketing completed 1 run.'))).toBe(true);
  });

  it('caps the highlight list at 5', () => {
    const evts = [
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `r${i}`,
        type: 'agent_run_completed' as const,
        occurredAt: YESTERDAY,
        actor: 'agent' as const,
        department: `Dept${i}`,
        summary: 'x',
      })),
    ];
    const out = _internals.summarizeHighlights(evts as never);
    expect(out.length).toBeLessThanOrEqual(5);
  });

  it('passes through stage_advanced and gate_completed verbatim', () => {
    const out = _internals.summarizeHighlights([
      { id: 's1', type: 'stage_advanced', occurredAt: YESTERDAY, actor: 'agent', summary: 'Workspace advanced to building.' },
      { id: 'g1', type: 'gate_completed', occurredAt: YESTERDAY, actor: 'agent', summary: 'Gate completed: ship MVP.' },
    ] as never);
    expect(out).toContain('Workspace advanced to building.');
    expect(out).toContain('Gate completed: ship MVP.');
  });
});

describe('buildActions', () => {
  it('returns empty when nothing pending', () => {
    expect(_internals.buildActions('acme', 0, 0, 0)).toEqual([]);
  });
  it('singular vs plural copy', () => {
    expect(_internals.buildActions('acme', 1, 0, 0)[0].label).toBe('Approve 1 draft waiting for you.');
    expect(_internals.buildActions('acme', 2, 0, 0)[0].label).toBe('Approve 2 drafts waiting for you.');
  });
  it('links drafts + paused runs to approvals, stalled tasks to the task list', () => {
    expect(_internals.buildActions('acme', 1, 0, 0)[0].href).toBe('/s/acme/chat/approvals');
    expect(_internals.buildActions('acme', 0, 1, 0)[0].href).toBe('/s/acme/chat/approvals');
    expect(_internals.buildActions('acme', 0, 0, 1)[0].href).toBe('/s/acme/tasks');
  });
  it('caps at 3 actions', () => {
    const out = _internals.buildActions('acme', 5, 5, 5);
    expect(out.length).toBe(3);
  });
});

describe('buildDailyBriefing', () => {
  it('returns rest-day payload when audit feed empty and no backlog', async () => {
    auditEvents = [];
    queueAll({ pendingDrafts: 0, pausedRuns: 0, stalledTasks: 0 });
    const out = await buildDailyBriefing('space-1', NOW);
    expect(out).not.toBeNull();
    expect(out!.isRestDay).toBe(true);
    expect(out!.yesterdayHighlights).toEqual([]);
    expect(out!.needsYouToday).toEqual([]);
  });

  it('builds highlights from mixed events in the last 24h', async () => {
    auditEvents = [
      { id: '1', type: 'agent_run_completed', occurredAt: YESTERDAY, actor: 'agent', department: 'Engineering', summary: 'x' },
      { id: '2', type: 'draft_accepted', occurredAt: YESTERDAY, actor: 'founder', summary: 'y' },
      // Stale event — older than 24h, should be filtered out.
      { id: '3', type: 'draft_accepted', occurredAt: '2026-04-01T10:00:00Z', actor: 'founder', summary: 'old' },
    ];
    queueAll({ pendingDrafts: 0, pausedRuns: 0, stalledTasks: 0 });
    const out = await buildDailyBriefing('space-1', NOW);
    expect(out).not.toBeNull();
    expect(out!.isRestDay).toBe(false);
    expect(out!.yesterdayHighlights.some((s) => s.includes('Engineering completed 1 run.'))).toBe(true);
    expect(out!.yesterdayHighlights.some((s) => s.includes('approved 1 draft'))).toBe(true);
  });

  it('surfaces pending drafts in needsYouToday', async () => {
    queueAll({ pendingDrafts: 3, pausedRuns: 0, stalledTasks: 0 });
    const out = await buildDailyBriefing('space-1', NOW);
    expect(out!.pendingApprovalsCount).toBe(3);
    expect(
      out!.needsYouToday.some((a) => a.label === 'Approve 3 drafts waiting for you.'),
    ).toBe(true);
    expect(out!.needsYouToday[0].href).toBe('/s/acme/chat/approvals');
  });

  it('caps highlights at 5 even with many events', async () => {
    auditEvents = Array.from({ length: 12 }, (_, i) => ({
      id: `r${i}`,
      type: 'agent_run_completed',
      occurredAt: YESTERDAY,
      actor: 'agent' as const,
      department: `Dept${i}`,
      summary: 'x',
    }));
    queueAll({ pendingDrafts: 0, pausedRuns: 0, stalledTasks: 0 });
    const out = await buildDailyBriefing('space-1', NOW);
    expect(out!.yesterdayHighlights.length).toBeLessThanOrEqual(5);
  });

  it('returns null when the Space row is missing', async () => {
    queueAll({ space: null });
    const out = await buildDailyBriefing('missing', NOW);
    expect(out).toBeNull();
  });

  it('extracts founder first name from User.name', async () => {
    queueAll({ owner: { id: 'u', email: 'a@b.c', name: 'Charles Darwin' }, pendingDrafts: 1 });
    const out = await buildDailyBriefing('space-1', NOW);
    expect(out!.founderFirstName).toBe('Charles');
  });

  it('falls back to default stage when WorkspaceStage row absent', async () => {
    queueAll({ stage: null, pendingDrafts: 1 });
    const out = await buildDailyBriefing('space-1', NOW);
    expect(out!.currentStage).toBe('idea');
  });
});
