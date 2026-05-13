/**
 * Tests for `eventsToDockRows` — the pure mapper that turns audit events
 * into chat-dock render rows. No supabase, no React, no DOM.
 */

import { describe, it, expect } from 'vitest';
import { eventsToDockRows } from '@/lib/canvas/dock-feed';
import type { AuditEvent } from '@/lib/observability/audit-feed';

function ev(overrides: Partial<AuditEvent>): AuditEvent {
  return {
    id: 'e1',
    type: 'agent_run_started',
    occurredAt: '2026-05-01T10:00:00Z',
    actor: 'agent',
    summary: 'Engineering started: ship the thing',
    department: 'engineering',
    ...overrides,
  } as AuditEvent;
}

describe('eventsToDockRows', () => {
  it('returns an empty array for no events', () => {
    expect(eventsToDockRows([])).toEqual([]);
  });

  it('maps agent_run_started to a Running subagent row', () => {
    const rows = eventsToDockRows([ev({ type: 'agent_run_started' })]);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.kind).toBe('subagent');
    if (row.kind !== 'subagent') return;
    expect(row.status).toBe('running');
    expect(row.department).toBe('engineering');
    expect(row.agentName).toBe('Engineering');
    expect(row.task).toBe('ship the thing');
  });

  it('maps agent_run_completed to a Done subagent row', () => {
    const rows = eventsToDockRows([
      ev({
        id: 'e2',
        type: 'agent_run_completed',
        summary: 'Engineering completed: shipped the thing',
      }),
    ]);
    expect(rows[0].kind).toBe('subagent');
    if (rows[0].kind !== 'subagent') return;
    expect(rows[0].status).toBe('done');
    expect(rows[0].task).toBe('shipped the thing');
  });

  it('falls back to a text row when an agent event has no recognised department', () => {
    const rows = eventsToDockRows([
      ev({ type: 'agent_run_started', department: undefined }),
    ]);
    expect(rows[0].kind).toBe('text');
  });

  it('maps non-agent events to text rows', () => {
    const rows = eventsToDockRows([
      ev({
        id: 'd1',
        type: 'draft_created',
        summary: 'I drafted an email: launch teaser',
        department: undefined,
      }),
    ]);
    expect(rows[0].kind).toBe('text');
    if (rows[0].kind !== 'text') return;
    expect(rows[0].summary).toBe('I drafted an email: launch teaser');
    expect(rows[0].department).toBeUndefined();
  });

  it('preserves department on text rows when present and valid', () => {
    const rows = eventsToDockRows([
      ev({
        id: 'g1',
        type: 'gate_completed',
        summary: 'Gate completed: market sized',
        department: 'marketing',
      }),
    ]);
    expect(rows[0].kind).toBe('text');
    if (rows[0].kind !== 'text') return;
    expect(rows[0].department).toBe('marketing');
  });
});
