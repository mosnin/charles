/**
 * Pure-function tests for the stages-kanban view helpers.
 *
 * These functions decide column membership, task subtitle, completion
 * count, and the connector list — i.e. every layout-affecting decision
 * the canvas makes outside of React. Keep them mechanical and fast.
 */

import { describe, it, expect } from 'vitest';
import {
  groupGatesByStage,
  taskKindFor,
  subtitleFor,
  nextStagePairs,
  columnLabelFor,
  completionFor,
  placeholderGatesFor,
  type CanvasGate,
} from '@/lib/stages/canvas-helpers';
import { STAGE_ORDER, STAGES } from '@/lib/stages/catalog';

function gate(partial: Partial<CanvasGate> & { id: string; stage: CanvasGate['stage']; title: string }): CanvasGate {
  return { isComplete: false, order: 0, metadata: null, ...partial };
}

describe('groupGatesByStage', () => {
  it('returns an entry for every stage even when empty', () => {
    const out = groupGatesByStage([]);
    for (const s of STAGE_ORDER) {
      expect(out[s], `column ${s}`).toEqual([]);
    }
  });

  it('groups gates into their column', () => {
    const gates = [
      gate({ id: '1', stage: 'idea', title: 'A' }),
      gate({ id: '2', stage: 'idea', title: 'B' }),
      gate({ id: '3', stage: 'building', title: 'C' }),
    ];
    const out = groupGatesByStage(gates);
    expect(out.idea.map((g) => g.id)).toEqual(['1', '2']);
    expect(out.building.map((g) => g.id)).toEqual(['3']);
    expect(out.scaling).toEqual([]);
  });

  it('sorts within a column by order ascending, nulls last, title tiebreak', () => {
    const gates = [
      gate({ id: 'a', stage: 'idea', title: 'Zeta', order: 2 }),
      gate({ id: 'b', stage: 'idea', title: 'Alpha', order: null }),
      gate({ id: 'c', stage: 'idea', title: 'Beta', order: 0 }),
      gate({ id: 'd', stage: 'idea', title: 'Gamma', order: 1 }),
    ];
    const out = groupGatesByStage(gates);
    expect(out.idea.map((g) => g.id)).toEqual(['c', 'd', 'a', 'b']);
  });

  it('drops rows with an unknown stage slug', () => {
    const gates = [
      gate({ id: '1', stage: 'idea', title: 'A' }),
      // Cast through unknown — simulates a stray row from a future stage.
      gate({ id: '2', stage: 'mystery' as CanvasGate['stage'], title: 'B' }),
    ];
    const out = groupGatesByStage(gates);
    expect(out.idea).toHaveLength(1);
    // The mystery row is silently dropped, not crashing the layout.
    const totalRendered = STAGE_ORDER.reduce((n, s) => n + out[s].length, 0);
    expect(totalRendered).toBe(1);
  });
});

describe('taskKindFor', () => {
  it('defaults to user for v1 gates with no metadata', () => {
    expect(taskKindFor(gate({ id: '1', stage: 'idea', title: 'T' }))).toBe('user');
  });

  it('reads kind=agent from metadata', () => {
    expect(
      taskKindFor(gate({ id: '1', stage: 'idea', title: 'T', metadata: { kind: 'agent' } })),
    ).toBe('agent');
  });

  it('promotes agent + requiresApproval → agent-approval', () => {
    expect(
      taskKindFor(
        gate({
          id: '1',
          stage: 'idea',
          title: 'T',
          metadata: { kind: 'agent', requiresApproval: true },
        }),
      ),
    ).toBe('agent-approval');
  });

  it('honours explicit kind=agent-approval', () => {
    expect(
      taskKindFor(
        gate({ id: '1', stage: 'idea', title: 'T', metadata: { kind: 'agent-approval' } }),
      ),
    ).toBe('agent-approval');
  });
});

describe('subtitleFor', () => {
  it('renders the three subtitle bands', () => {
    expect(subtitleFor('user')).toBe('User task');
    expect(subtitleFor('agent')).toBe('Agent task');
    expect(subtitleFor('agent-approval')).toBe('Agent requires approval');
  });
});

describe('nextStagePairs', () => {
  it('returns exactly 5 adjacent pairs for the 6-stage catalog', () => {
    const pairs = nextStagePairs();
    expect(pairs).toHaveLength(5);
    expect(pairs[0]).toMatchObject({ from: 'idea', to: 'initial', fromIndex: 0, toIndex: 1 });
    expect(pairs[4]).toMatchObject({ from: 'selling', to: 'scaling', fromIndex: 4, toIndex: 5 });
  });

  it('returns N-1 pairs for any stage list', () => {
    expect(nextStagePairs(['idea'])).toHaveLength(0);
    expect(nextStagePairs(['idea', 'initial', 'identity'])).toHaveLength(2);
  });
});

describe('columnLabelFor', () => {
  it('renders lowercase stage label + " stage"', () => {
    expect(columnLabelFor('idea')).toBe('idea stage');
    expect(columnLabelFor('initial')).toBe('initial stage');
    expect(columnLabelFor('scaling')).toBe('scaling stage');
  });
});

describe('completionFor', () => {
  it('returns 0/0 for an empty column', () => {
    expect(completionFor([])).toEqual({ complete: 0, total: 0, label: '0/0' });
  });

  it('counts complete rows', () => {
    const rows: CanvasGate[] = [
      gate({ id: '1', stage: 'idea', title: 'A', isComplete: true }),
      gate({ id: '2', stage: 'idea', title: 'B', isComplete: false }),
      gate({ id: '3', stage: 'idea', title: 'C', isComplete: true }),
    ];
    expect(completionFor(rows)).toEqual({ complete: 2, total: 3, label: '2/3' });
  });
});

describe('placeholderGatesFor', () => {
  it('produces one placeholder per catalog gate', () => {
    for (const s of STAGE_ORDER) {
      const ph = placeholderGatesFor(s);
      expect(ph).toHaveLength(STAGES[s].gates.length);
      expect(ph.every((g) => !g.isComplete)).toBe(true);
      expect(ph.every((g) => g.stage === s)).toBe(true);
      expect(ph.every((g) => g.id.startsWith(`placeholder:${s}:`))).toBe(true);
    }
  });

  it('preserves catalog title + order', () => {
    const ph = placeholderGatesFor('idea');
    expect(ph.map((g) => g.title)).toEqual([...STAGES.idea.gates]);
    expect(ph.map((g) => g.order)).toEqual(ph.map((_, i) => i));
  });
});
