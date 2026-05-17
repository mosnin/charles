/**
 * PlanDetail — render assertions.
 *
 * The project runs vitest in a node env (no jsdom, no testing-library), so
 * we render to static markup with react-dom/server and assert against the
 * resulting HTML string. That's enough to pin the structural claims that
 * matter on this surface: every step appears, statuses are mapped, the
 * verdict footer only renders when there's a follow-up, and steps render
 * in stepIndex order regardless of input order.
 *
 * The polling wrapper is out of scope here — that's integration territory.
 */

import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const { createElement } = React;
import { PlanDetail } from '@/components/plans/plan-detail';
import {
  RUNNING_PLAN_FIXTURE,
  COMPLETED_PLAN_FIXTURE,
} from '@/lib/plans/fixtures';
import type { PlanRun } from '@/lib/plans/types';

function render(run: PlanRun): string {
  return renderToStaticMarkup(createElement(PlanDetail, { run }));
}

/** Pull out the step cards in DOM order so we can assert ordering. */
function stepIndicesInOrder(html: string): number[] {
  const re = /data-step-index="(\d+)"/g;
  const indices: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    indices.push(Number(m[1]));
  }
  return indices;
}

/** Count step-status-chip occurrences by status attribute. */
function statusCounts(html: string): Record<string, number> {
  const re = /data-testid="step-status-chip" data-status="([a-z]+)"/g;
  const counts: Record<string, number> = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    counts[m[1]] = (counts[m[1]] ?? 0) + 1;
  }
  return counts;
}

describe('PlanDetail — running plan', () => {
  const html = render(RUNNING_PLAN_FIXTURE);

  it('renders all four steps', () => {
    const cards = html.match(/data-testid="step-card"/g) ?? [];
    expect(cards.length).toBe(4);
  });

  it('maps each step to its status chip', () => {
    const counts = statusCounts(html);
    expect(counts.completed).toBe(1);
    expect(counts.running).toBe(1);
    expect(counts.queued).toBe(2);
  });

  it('shows the run header with the goal and progress', () => {
    expect(html).toContain('Ship the /pricing page by end of day.');
    expect(html).toContain('1/4');
    expect(html).toContain('running');
  });

  it('does not render a verifier summary block while the run is in flight', () => {
    expect(html).not.toContain('data-testid="verifier-summary"');
  });
});

describe('PlanDetail — completed plan with a failed verdict', () => {
  const html = render(COMPLETED_PLAN_FIXTURE);

  it('renders the verifier summary block with an unsatisfied mark', () => {
    expect(html).toContain('data-testid="verifier-summary"');
    // The summary block embeds the overall verdict mark.
    expect(html).toContain('data-satisfied="false"');
  });

  it('renders the failed step verdict mark and its suggested follow-up footer', () => {
    expect(html).toContain('data-testid="follow-up"');
    expect(html).toContain('Verify the deploy is live by hitting the prod URL. Wait 15m.');
  });

  it('does not render a follow-up footer for steps with no suggested follow-up', () => {
    // Three of four completed steps satisfied with empty suggested_follow_up,
    // one failed with a populated follow-up — so exactly one footer.
    const followUps = html.match(/data-testid="follow-up"/g) ?? [];
    expect(followUps.length).toBe(1);
  });

  it('shows the run status chip with an X for an unsatisfied completed run', () => {
    expect(html).toContain('data-testid="run-status-chip"');
    expect(html).toContain('completed');
    expect(html).toContain('4/4');
  });
});

describe('PlanDetail — defensive rendering', () => {
  it('orders steps by stepIndex regardless of input order', () => {
    const shuffled: PlanRun = {
      ...RUNNING_PLAN_FIXTURE,
      steps: [
        RUNNING_PLAN_FIXTURE.steps[3],
        RUNNING_PLAN_FIXTURE.steps[0],
        RUNNING_PLAN_FIXTURE.steps[2],
        RUNNING_PLAN_FIXTURE.steps[1],
      ],
    };
    const html = render(shuffled);
    expect(stepIndicesInOrder(html)).toEqual([0, 1, 2, 3]);
  });

  it('omits the depends-on line when dependsOn is empty', () => {
    // The running fixture has step 3 as the only step with dependencies.
    // Strip it; no card should mention "Depends on:".
    const noDeps: PlanRun = {
      ...RUNNING_PLAN_FIXTURE,
      steps: RUNNING_PLAN_FIXTURE.steps.filter((s) => s.dependsOn.length === 0),
    };
    const html = render(noDeps);
    expect(html).not.toContain('Depends on:');
  });

  it('renders the depends-on line for steps that have dependencies', () => {
    const html = render(RUNNING_PLAN_FIXTURE);
    expect(html).toContain('Depends on:');
    // Step 3 depends on [0, 1, 2] → rendered as 1-indexed #1, #2, #3.
    expect(html).toContain('#1, #2, #3');
  });
});
