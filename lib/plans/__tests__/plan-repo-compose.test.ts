/**
 * Tests for `composePlanRun` — the pure shaper that joins a SwarmRun
 * row + its SwarmMember rows into the PlanRun contract the UI reads.
 *
 * The join's tricky bit: planner-time fields (expected_outcome,
 * depends_on) live on SwarmRun.plan.steps[i], while live state
 * (status, output, verifierVerdict) lives on the SwarmMember row
 * with matching stepIndex. composePlanRun reconciles them and
 * tolerates partially-run plans (some members not yet inserted).
 *
 * Mock-free: composePlanRun is pure — no supabase calls. Just shape.
 */
import { describe, it, expect } from 'vitest';
import { composePlanRun } from '@/lib/plans/plan-repo';

function makeRun(overrides: Partial<Parameters<typeof composePlanRun>[0]> = {}) {
  return {
    id: 'run_1',
    spaceId: 'sp_1',
    goal: 'Ship the pricing page',
    plan: {
      goal: 'Ship the pricing page',
      summary: 'three parallel tracks, then a merge+deploy',
      steps: [
        {
          department: 'engineering',
          task: 'Open a PR adding /pricing route',
          expected_outcome: 'PR URL returned',
          depends_on: [],
        },
        {
          department: 'marketing',
          task: 'Draft 3 headlines',
          expected_outcome: '3 headlines drafted',
          depends_on: [],
        },
        {
          department: 'engineering',
          task: 'Merge and deploy',
          expected_outcome: '200 from prod URL',
          depends_on: [0, 1],
        },
      ],
    },
    status: 'running',
    overallSatisfied: null,
    verifierSummary: null,
    createdAt: '2026-05-17T10:00:00Z',
    completedAt: null,
    ...overrides,
  } as Parameters<typeof composePlanRun>[0];
}

describe('composePlanRun()', () => {
  it('zips plan.steps with SwarmMembers by stepIndex', () => {
    const members = [
      {
        id: 'm_1',
        swarmRunId: 'run_1',
        role: 'engineering',
        task: 'Open a PR adding /pricing route',
        stepIndex: 0,
        status: 'completed',
        output: 'PR #42 opened at github.com/x/y/pull/42',
        verifierVerdict: { satisfied: true, reason: 'PR URL present', suggested_follow_up: '' },
        startedAt: '2026-05-17T10:01:00Z',
        completedAt: '2026-05-17T10:02:00Z',
      },
      {
        id: 'm_2',
        swarmRunId: 'run_1',
        role: 'marketing',
        task: 'Draft 3 headlines',
        stepIndex: 1,
        status: 'running',
        output: null,
        verifierVerdict: null,
        startedAt: '2026-05-17T10:01:00Z',
        completedAt: null,
      },
    ];
    const run = composePlanRun(makeRun(), members);

    expect(run.steps).toHaveLength(3);
    expect(run.steps[0].id).toBe('m_1');
    expect(run.steps[0].status).toBe('completed');
    expect(run.steps[0].output).toContain('PR #42');
    expect(run.steps[0].verifierVerdict?.satisfied).toBe(true);
    expect(run.steps[0].expectedOutcome).toBe('PR URL returned');
    expect(run.steps[0].dependsOn).toEqual([]);

    expect(run.steps[1].id).toBe('m_2');
    expect(run.steps[1].status).toBe('running');
    expect(run.steps[1].verifierVerdict).toBeNull();

    // Step 2 has no SwarmMember yet (not started) — synthesised.
    expect(run.steps[2].status).toBe('queued');
    expect(run.steps[2].output).toBeNull();
    expect(run.steps[2].dependsOn).toEqual([0, 1]);
  });

  it('counts completed/failed/blocked toward completedSteps', () => {
    const members = [
      { id: 'a', swarmRunId: 'run_1', role: 'engineering', task: 't1', stepIndex: 0, status: 'completed', output: 'ok', verifierVerdict: null, startedAt: null, completedAt: null },
      { id: 'b', swarmRunId: 'run_1', role: 'marketing', task: 't2', stepIndex: 1, status: 'failed', output: 'err', verifierVerdict: null, startedAt: null, completedAt: null },
    ];
    const run = composePlanRun(makeRun(), members);
    expect(run.completedSteps).toBe(2);
    expect(run.totalSteps).toBe(3);
  });

  it('preserves order by stepIndex even when members arrive out of order', () => {
    const members = [
      { id: 'c', swarmRunId: 'run_1', role: 'engineering', task: 't3', stepIndex: 2, status: 'completed', output: 'ok', verifierVerdict: null, startedAt: null, completedAt: null },
      { id: 'a', swarmRunId: 'run_1', role: 'engineering', task: 't1', stepIndex: 0, status: 'completed', output: 'ok', verifierVerdict: null, startedAt: null, completedAt: null },
      { id: 'b', swarmRunId: 'run_1', role: 'marketing', task: 't2', stepIndex: 1, status: 'completed', output: 'ok', verifierVerdict: null, startedAt: null, completedAt: null },
    ];
    const run = composePlanRun(makeRun(), members);
    expect(run.steps.map((s) => s.stepIndex)).toEqual([0, 1, 2]);
    expect(run.steps[0].id).toBe('a');
    expect(run.steps[1].id).toBe('b');
    expect(run.steps[2].id).toBe('c');
  });

  it('returns 0 steps gracefully when plan jsonb is empty', () => {
    const run = composePlanRun(
      makeRun({ plan: { goal: 'g', summary: 's', steps: [] } }),
      [],
    );
    expect(run.steps).toEqual([]);
    expect(run.totalSteps).toBe(0);
    expect(run.completedSteps).toBe(0);
  });

  it('falls back to defaults when plan jsonb is null', () => {
    const run = composePlanRun(makeRun({ plan: null }), []);
    expect(run.steps).toEqual([]);
    expect(run.planSummary).toBe('');
  });

  it('propagates the verifier summary + overall verdict', () => {
    const run = composePlanRun(
      makeRun({
        status: 'failed',
        overallSatisfied: false,
        verifierSummary: 'Two of three steps verified. Deploy step waiting on a propagation check.',
        completedAt: '2026-05-17T10:30:00Z',
      }),
      [],
    );
    expect(run.status).toBe('failed');
    expect(run.overallSatisfied).toBe(false);
    expect(run.verifierSummary).toMatch(/Two of three/);
    expect(run.completedAt).toBe('2026-05-17T10:30:00Z');
  });
});
