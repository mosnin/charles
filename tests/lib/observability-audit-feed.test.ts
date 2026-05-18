/**
 * Tests for `loadAuditFeed` — the unified audit projection. The supabase
 * mock follows the `mockByTable` pattern in `personalized-prompt.test.ts`:
 * each table can return its own row array, throw, or be left silent
 * (defaults to empty).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

interface TableMock {
  rows?: unknown[];
  throws?: Error;
}

const mockByTable: Record<string, TableMock> = {};

vi.mock('@/lib/supabase', () => {
  return {
    supabase: {
      from: vi.fn((table: string) => {
        const override = mockByTable[table] ?? {};
        const chain: Record<string, unknown> = {};
        const passthrough = () => chain;
        chain.select = vi.fn(passthrough);
        chain.eq = vi.fn(passthrough);
        chain.is = vi.fn(passthrough);
        chain.lt = vi.fn(passthrough);
        chain.gt = vi.fn(passthrough);
        chain.order = vi.fn(passthrough);
        chain.limit = vi.fn(() => {
          if (override.throws) return Promise.reject(override.throws);
          return Promise.resolve({ data: override.rows ?? [], error: null });
        });
        // `await chain` form — fall back to the same data.
        chain.then = (resolve: (v: unknown) => unknown) => {
          if (override.throws) return resolve({ data: null, error: override.throws });
          return resolve({ data: override.rows ?? [], error: null });
        };
        return chain;
      }),
    },
  };
});

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { loadAuditFeed, type AuditEvent, type AuditEventType } from '@/lib/observability/audit-feed';

beforeEach(() => {
  for (const key of Object.keys(mockByTable)) delete mockByTable[key];
});

function iso(d: string) {
  return new Date(d).toISOString();
}

describe('loadAuditFeed — empty / smoke', () => {
  it('returns empty array when every source is empty', async () => {
    const events = await loadAuditFeed('space_1');
    expect(events).toEqual([]);
  });

  it('caps limit at 200', async () => {
    // Build 250 fake completed SwarmMember rows.
    const rows = Array.from({ length: 250 }, (_, i) => ({
      id: `m${i}`,
      name: 'Engineering',
      role: 'engineering',
      task: `task ${i}`,
      status: 'completed',
      startedAt: iso('2026-05-01T00:00:00Z'),
      completedAt: new Date(Date.UTC(2026, 4, 1) + i * 60_000).toISOString(),
      createdAt: iso('2026-05-01T00:00:00Z'),
    }));
    mockByTable.SwarmMember = { rows };
    const events = await loadAuditFeed('space_1', { limit: 500 });
    expect(events.length).toBeLessThanOrEqual(200);
  });

  it('defaults limit to 50', async () => {
    const rows = Array.from({ length: 80 }, (_, i) => ({
      id: `m${i}`,
      name: 'Engineering',
      role: 'engineering',
      task: 'task',
      status: 'completed',
      startedAt: iso('2026-05-01T00:00:00Z'),
      completedAt: new Date(Date.UTC(2026, 4, 1, 1) + i * 60_000).toISOString(),
      createdAt: iso('2026-05-01T00:00:00Z'),
    }));
    mockByTable.SwarmMember = { rows };
    const events = await loadAuditFeed('space_1');
    // Each row produces 2 events (started + completed) → 160 candidates, cap 50.
    expect(events.length).toBe(50);
  });
});

describe('loadAuditFeed — per-source mapping', () => {
  it('maps SwarmMember.startedAt and .completedAt into started + completed events', async () => {
    mockByTable.SwarmMember = {
      rows: [
        {
          id: 'm1',
          name: 'Engineering',
          role: 'engineering',
          task: 'Ship the feature flag service',
          status: 'completed',
          startedAt: iso('2026-05-01T10:00:00Z'),
          completedAt: iso('2026-05-01T10:05:00Z'),
          createdAt: iso('2026-05-01T09:59:00Z'),
        },
      ],
    };
    const events = await loadAuditFeed('space_1');
    const types = events.map((e) => e.type);
    expect(types).toContain('agent_run_started');
    expect(types).toContain('agent_run_completed');
    const started = events.find((e) => e.type === 'agent_run_started');
    expect(started?.summary).toMatch(/Engineering started:/);
    expect(started?.department).toBe('engineering');
  });

  it('maps failed SwarmMember into agent_run_failed', async () => {
    mockByTable.SwarmMember = {
      rows: [
        {
          id: 'm2',
          name: 'Marketing',
          role: 'marketing',
          task: 'Draft launch tweet',
          status: 'failed',
          startedAt: iso('2026-05-02T09:00:00Z'),
          completedAt: iso('2026-05-02T09:02:00Z'),
          createdAt: iso('2026-05-02T09:00:00Z'),
        },
      ],
    };
    const events = await loadAuditFeed('space_1');
    const failed = events.find((e) => e.type === 'agent_run_failed');
    expect(failed).toBeDefined();
    expect(failed?.summary).toMatch(/Marketing failed:/);
  });

  it('truncates SwarmMember.task at 80 chars in the summary', async () => {
    const longTask = 'x'.repeat(200);
    mockByTable.SwarmMember = {
      rows: [
        {
          id: 'm3',
          name: 'Engineering',
          role: 'engineering',
          task: longTask,
          status: 'completed',
          startedAt: iso('2026-05-01T10:00:00Z'),
          completedAt: iso('2026-05-01T10:05:00Z'),
          createdAt: iso('2026-05-01T09:59:00Z'),
        },
      ],
    };
    const events = await loadAuditFeed('space_1');
    for (const e of events) {
      // Summary should not contain the full 200-char task.
      expect(e.summary.length).toBeLessThan(longTask.length);
    }
  });

  it('maps AgentDraft created and accepted/declined transitions', async () => {
    mockByTable.AgentDraft = {
      rows: [
        {
          id: 'd1',
          channel: 'email',
          subject: 'Re: launch invite',
          status: 'approved',
          createdAt: iso('2026-05-03T10:00:00Z'),
          updatedAt: iso('2026-05-03T10:15:00Z'),
        },
        {
          id: 'd2',
          channel: 'sms',
          subject: null,
          status: 'dismissed',
          createdAt: iso('2026-05-03T11:00:00Z'),
          updatedAt: iso('2026-05-03T11:05:00Z'),
        },
      ],
    };
    const events = await loadAuditFeed('space_1');
    const types = events.map((e) => e.type);
    expect(types).toContain('draft_created');
    expect(types).toContain('draft_accepted');
    expect(types).toContain('draft_declined');
    const accepted = events.find((e) => e.type === 'draft_accepted');
    expect(accepted?.summary).toMatch(/You approved the email/);
    expect(accepted?.actor).toBe('founder');
  });

  it('treats AgentDraft.status="sent" as draft_accepted', async () => {
    mockByTable.AgentDraft = {
      rows: [
        {
          id: 'd3',
          channel: 'email',
          subject: 'Welcome',
          status: 'sent',
          createdAt: iso('2026-05-03T10:00:00Z'),
          updatedAt: iso('2026-05-03T10:15:00Z'),
        },
      ],
    };
    const events = await loadAuditFeed('space_1');
    expect(events.some((e) => e.type === 'draft_accepted')).toBe(true);
  });

  it('maps AgentPausedRun resumed/cancelled to paused_run_approved/declined', async () => {
    mockByTable.AgentPausedRun = {
      rows: [
        {
          id: 'p1',
          status: 'resumed',
          createdAt: iso('2026-05-04T10:00:00Z'),
          updatedAt: iso('2026-05-04T10:30:00Z'),
        },
        {
          id: 'p2',
          status: 'cancelled',
          createdAt: iso('2026-05-04T11:00:00Z'),
          updatedAt: iso('2026-05-04T11:10:00Z'),
        },
      ],
    };
    const events = await loadAuditFeed('space_1');
    const types = events.map((e) => e.type);
    expect(types).toContain('paused_run_approved');
    expect(types).toContain('paused_run_declined');
    const approved = events.find((e) => e.type === 'paused_run_approved');
    expect(approved?.summary).toMatch(/You approved a paused run/);
  });

  it('maps IntegrationConnection creation as integration_connected', async () => {
    mockByTable.IntegrationConnection = {
      rows: [
        {
          id: 'i1',
          toolkit: 'github',
          status: 'active',
          label: 'work@example.com',
          createdAt: iso('2026-05-05T10:00:00Z'),
          updatedAt: iso('2026-05-05T10:00:00Z'),
        },
      ],
    };
    const events = await loadAuditFeed('space_1');
    const connected = events.find((e) => e.type === 'integration_connected');
    expect(connected).toBeDefined();
    expect(connected?.summary).toMatch(/You connected github/);
    expect(connected?.summary).toMatch(/work@example\.com/);
  });

  it('maps revoked IntegrationConnection as integration_disconnected', async () => {
    mockByTable.IntegrationConnection = {
      rows: [
        {
          id: 'i2',
          toolkit: 'slack',
          status: 'revoked',
          label: null,
          createdAt: iso('2026-05-05T10:00:00Z'),
          updatedAt: iso('2026-05-06T10:00:00Z'),
        },
      ],
    };
    const events = await loadAuditFeed('space_1');
    const disconnected = events.find((e) => e.type === 'integration_disconnected');
    expect(disconnected).toBeDefined();
    expect(disconnected?.summary).toMatch(/You disconnected slack/);
  });

  it('maps WorkspaceStage.enteredAt to stage_advanced; founder vs agent actor', async () => {
    mockByTable.WorkspaceStage = {
      rows: [
        {
          id: 's1',
          stage: 'building',
          enteredAt: iso('2026-05-07T10:00:00Z'),
          exitedBy: 'founder',
        },
        {
          id: 's2',
          stage: 'shipping',
          enteredAt: iso('2026-05-08T10:00:00Z'),
          exitedBy: null,
        },
      ],
    };
    const events = await loadAuditFeed('space_1');
    const founderMove = events.find((e) => e.summary.includes('building'));
    const agentMove = events.find((e) => e.summary.includes('shipping'));
    expect(founderMove?.actor).toBe('founder');
    expect(agentMove?.actor).toBe('agent');
    expect(founderMove?.type).toBe('stage_advanced');
  });

  it('maps StageGate completion to gate_completed', async () => {
    mockByTable.StageGate = {
      rows: [
        {
          id: 'g1',
          stage: 'building',
          title: 'Pick a name',
          isComplete: true,
          completedAt: iso('2026-05-09T10:00:00Z'),
        },
      ],
    };
    const events = await loadAuditFeed('space_1');
    const gate = events.find((e) => e.type === 'gate_completed');
    expect(gate).toBeDefined();
    expect(gate?.summary).toMatch(/Pick a name/);
  });
});

describe('loadAuditFeed — sort / filter / pagination', () => {
  it('sorts events by occurredAt descending across sources', async () => {
    mockByTable.SwarmMember = {
      rows: [
        {
          id: 'm1',
          name: 'Engineering',
          role: 'engineering',
          task: 'old run',
          status: 'completed',
          startedAt: iso('2026-04-01T10:00:00Z'),
          completedAt: iso('2026-04-01T10:05:00Z'),
          createdAt: iso('2026-04-01T10:00:00Z'),
        },
      ],
    };
    mockByTable.AgentDraft = {
      rows: [
        {
          id: 'd1',
          channel: 'email',
          subject: 'new',
          status: 'pending',
          createdAt: iso('2026-05-10T10:00:00Z'),
          updatedAt: iso('2026-05-10T10:00:00Z'),
        },
      ],
    };
    mockByTable.StageGate = {
      rows: [
        {
          id: 'g1',
          stage: 'x',
          title: 'middle',
          isComplete: true,
          completedAt: iso('2026-04-15T10:00:00Z'),
        },
      ],
    };
    const events = await loadAuditFeed('space_1');
    expect(events.length).toBeGreaterThan(0);
    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1].occurredAt >= events[i].occurredAt).toBe(true);
    }
    expect(events[0].summary).toMatch(/I drafted a email: new/);
  });

  it('limit slice is applied after sort (newest survives)', async () => {
    mockByTable.AgentDraft = {
      rows: Array.from({ length: 10 }, (_, i) => ({
        id: `d${i}`,
        channel: 'email',
        subject: `s${i}`,
        status: 'pending',
        createdAt: iso(`2026-05-${String(10 + i).padStart(2, '0')}T10:00:00Z`),
        updatedAt: iso(`2026-05-${String(10 + i).padStart(2, '0')}T10:00:00Z`),
      })),
    };
    const events = await loadAuditFeed('space_1', { limit: 3 });
    expect(events).toHaveLength(3);
    // Newest is 2026-05-19.
    expect(events[0].occurredAt).toBe(iso('2026-05-19T10:00:00Z'));
  });

  it('beforeIso strips events at or newer than the cursor', async () => {
    mockByTable.AgentDraft = {
      rows: [
        {
          id: 'd_old',
          channel: 'email',
          subject: 'old',
          status: 'pending',
          createdAt: iso('2026-04-01T10:00:00Z'),
          updatedAt: iso('2026-04-01T10:00:00Z'),
        },
        {
          id: 'd_new',
          channel: 'email',
          subject: 'new',
          status: 'pending',
          createdAt: iso('2026-05-20T10:00:00Z'),
          updatedAt: iso('2026-05-20T10:00:00Z'),
        },
      ],
    };
    const events = await loadAuditFeed('space_1', { beforeIso: iso('2026-05-01T00:00:00Z') });
    expect(events).toHaveLength(1);
    expect(events[0].summary).toMatch(/old/);
  });

  it('type filter strips non-matching events', async () => {
    mockByTable.SwarmMember = {
      rows: [
        {
          id: 'm1',
          name: 'Engineering',
          role: 'engineering',
          task: 'a',
          status: 'completed',
          startedAt: iso('2026-05-01T10:00:00Z'),
          completedAt: iso('2026-05-01T10:05:00Z'),
          createdAt: iso('2026-05-01T10:00:00Z'),
        },
      ],
    };
    mockByTable.AgentDraft = {
      rows: [
        {
          id: 'd1',
          channel: 'email',
          subject: 's',
          status: 'pending',
          createdAt: iso('2026-05-10T10:00:00Z'),
          updatedAt: iso('2026-05-10T10:00:00Z'),
        },
      ],
    };
    const events = await loadAuditFeed('space_1', { type: 'draft_created' });
    expect(events.every((e) => e.type === 'draft_created')).toBe(true);
    expect(events).toHaveLength(1);
  });
});

describe('loadAuditFeed — defensive', () => {
  it('one source throwing does not break the others', async () => {
    mockByTable.SwarmMember = { throws: new Error('relation does not exist') };
    mockByTable.AgentDraft = {
      rows: [
        {
          id: 'd1',
          channel: 'email',
          subject: 'survives',
          status: 'pending',
          createdAt: iso('2026-05-10T10:00:00Z'),
          updatedAt: iso('2026-05-10T10:00:00Z'),
        },
      ],
    };
    const events = await loadAuditFeed('space_1');
    expect(events.some((e) => e.summary.includes('survives'))).toBe(true);
  });

  it('all sources throwing → empty array (no exception)', async () => {
    const err = new Error('boom');
    mockByTable.SwarmMember = { throws: err };
    mockByTable.AgentDraft = { throws: err };
    mockByTable.AgentPausedRun = { throws: err };
    mockByTable.IntegrationConnection = { throws: err };
    mockByTable.WorkspaceStage = { throws: err };
    mockByTable.StageGate = { throws: err };
    const events = await loadAuditFeed('space_1');
    expect(events).toEqual([]);
  });
});

describe('loadAuditFeed — each event type has a sensible summary', () => {
  // Smoke-test every AuditEventType slug — drive each one through the loader
  // with a minimal row and assert the summary is a non-empty sentence.
  it('covers all 12 event types with non-empty summaries', async () => {
    mockByTable.SwarmMember = {
      rows: [
        {
          id: 'm_c',
          name: 'Engineering',
          role: 'engineering',
          task: 'work',
          status: 'completed',
          startedAt: iso('2026-05-01T10:00:00Z'),
          completedAt: iso('2026-05-01T10:05:00Z'),
          createdAt: iso('2026-05-01T10:00:00Z'),
        },
        {
          id: 'm_f',
          name: 'Marketing',
          role: 'marketing',
          task: 'work2',
          status: 'failed',
          startedAt: iso('2026-05-01T11:00:00Z'),
          completedAt: iso('2026-05-01T11:01:00Z'),
          createdAt: iso('2026-05-01T11:00:00Z'),
        },
      ],
    };
    mockByTable.AgentDraft = {
      rows: [
        {
          id: 'd_a',
          channel: 'email',
          subject: 'one',
          status: 'approved',
          createdAt: iso('2026-05-02T10:00:00Z'),
          updatedAt: iso('2026-05-02T10:30:00Z'),
        },
        {
          id: 'd_x',
          channel: 'sms',
          subject: 'two',
          status: 'dismissed',
          createdAt: iso('2026-05-02T11:00:00Z'),
          updatedAt: iso('2026-05-02T11:05:00Z'),
        },
      ],
    };
    mockByTable.AgentPausedRun = {
      rows: [
        {
          id: 'p_r',
          status: 'resumed',
          createdAt: iso('2026-05-03T10:00:00Z'),
          updatedAt: iso('2026-05-03T10:30:00Z'),
        },
        {
          id: 'p_c',
          status: 'cancelled',
          createdAt: iso('2026-05-03T11:00:00Z'),
          updatedAt: iso('2026-05-03T11:05:00Z'),
        },
      ],
    };
    mockByTable.IntegrationConnection = {
      rows: [
        {
          id: 'i_c',
          toolkit: 'github',
          status: 'active',
          label: null,
          createdAt: iso('2026-05-04T10:00:00Z'),
          updatedAt: iso('2026-05-04T10:00:00Z'),
        },
        {
          id: 'i_d',
          toolkit: 'slack',
          status: 'revoked',
          label: null,
          createdAt: iso('2026-05-04T11:00:00Z'),
          updatedAt: iso('2026-05-04T12:00:00Z'),
        },
      ],
    };
    mockByTable.WorkspaceStage = {
      rows: [
        {
          id: 's_a',
          stage: 'shipping',
          enteredAt: iso('2026-05-05T10:00:00Z'),
          exitedBy: 'founder',
        },
      ],
    };
    mockByTable.StageGate = {
      rows: [
        {
          id: 'g_c',
          stage: 'building',
          title: 'Pick a name',
          isComplete: true,
          completedAt: iso('2026-05-06T10:00:00Z'),
        },
      ],
    };
    const events = await loadAuditFeed('space_1', { limit: 200 });

    const required: AuditEventType[] = [
      'agent_run_started',
      'agent_run_completed',
      'agent_run_failed',
      'draft_created',
      'draft_accepted',
      'draft_declined',
      'paused_run_approved',
      'paused_run_declined',
      'integration_connected',
      'integration_disconnected',
      'stage_advanced',
      'gate_completed',
    ];
    for (const t of required) {
      const e = events.find((x: AuditEvent) => x.type === t);
      expect(e, `expected to find ${t}`).toBeDefined();
      expect(e!.summary.length).toBeGreaterThan(0);
      // No raw nulls or "undefined" leaking into the founder-facing string.
      expect(e!.summary).not.toMatch(/undefined|null/i);
    }
  });

  it('summary for agent_run_completed reads naturally', async () => {
    mockByTable.SwarmMember = {
      rows: [
        {
          id: 'm1',
          name: 'Engineering',
          role: 'engineering',
          task: 'Ship the feature flag service',
          status: 'completed',
          startedAt: iso('2026-05-01T10:00:00Z'),
          completedAt: iso('2026-05-01T10:05:00Z'),
          createdAt: iso('2026-05-01T10:00:00Z'),
        },
      ],
    };
    const events = await loadAuditFeed('space_1');
    const e = events.find((x) => x.type === 'agent_run_completed')!;
    expect(e.summary).toBe('Engineering completed: Ship the feature flag service');
  });

  it('summary for draft_created reads naturally', async () => {
    mockByTable.AgentDraft = {
      rows: [
        {
          id: 'd1',
          channel: 'email',
          subject: 'Re: pricing',
          status: 'pending',
          createdAt: iso('2026-05-10T10:00:00Z'),
          updatedAt: iso('2026-05-10T10:00:00Z'),
        },
      ],
    };
    const events = await loadAuditFeed('space_1');
    const e = events.find((x) => x.type === 'draft_created')!;
    expect(e.summary).toBe('I drafted a email: Re: pricing.');
  });

  it('summary for integration_connected reads naturally', async () => {
    mockByTable.IntegrationConnection = {
      rows: [
        {
          id: 'i1',
          toolkit: 'gmail',
          status: 'active',
          label: 'sam@example.com',
          createdAt: iso('2026-05-11T10:00:00Z'),
          updatedAt: iso('2026-05-11T10:00:00Z'),
        },
      ],
    };
    const events = await loadAuditFeed('space_1');
    const e = events.find((x) => x.type === 'integration_connected')!;
    expect(e.summary).toBe('You connected gmail (sam@example.com).');
  });
});
