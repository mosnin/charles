/**
 * Plan run fixtures for component development and tests.
 *
 * The backend isn't wired yet, so the /plans surface renders against these
 * until the repo lands. Two shapes the UI has to handle gracefully:
 *
 *   - RUNNING_PLAN_FIXTURE: an in-flight run with mixed step statuses
 *     (completed, running, queued) and a step that's gated on every other
 *     step finishing before it can start.
 *
 *   - COMPLETED_PLAN_FIXTURE: a finished run where the verifier flagged
 *     one step. `overallSatisfied` is false because of it, the verifier
 *     summary captures the "almost — except this" framing, and the failed
 *     step carries a suggested_follow_up the founder can act on.
 */
import type { PlanRun } from './types';

export const RUNNING_PLAN_FIXTURE: PlanRun = {
  id: 'plan_run_running_demo',
  spaceId: 'space_demo',
  goal: 'Ship the /pricing page by end of day.',
  planSummary:
    'Open a PR for the route, draft three headline candidates, pick a hero, then merge and deploy.',
  status: 'running',
  overallSatisfied: null,
  verifierSummary: null,
  totalSteps: 4,
  completedSteps: 1,
  createdAt: '2026-05-17T09:12:00.000Z',
  completedAt: null,
  steps: [
    {
      id: 'step_eng_open_pr',
      stepIndex: 0,
      department: 'engineering',
      task: 'Open a PR adding /pricing route',
      expectedOutcome: 'A draft PR exists on main with a stub /pricing page and a passing build.',
      dependsOn: [],
      status: 'completed',
      output:
        'Opened PR #482: add /pricing route. Stub page renders headline + three-tier table. CI green.',
      verifierVerdict: {
        satisfied: true,
        reason: 'PR is open, build is green, route renders without errors.',
        suggested_follow_up: '',
      },
      startedAt: '2026-05-17T09:13:00.000Z',
      completedAt: '2026-05-17T09:24:00.000Z',
    },
    {
      id: 'step_mkt_headlines',
      stepIndex: 1,
      department: 'marketing',
      task: 'Draft 3 headlines',
      expectedOutcome: 'Three founder-voice headline candidates, each under 8 words.',
      dependsOn: [],
      status: 'running',
      output: null,
      verifierVerdict: null,
      startedAt: '2026-05-17T09:25:00.000Z',
      completedAt: null,
    },
    {
      id: 'step_design_hero',
      stepIndex: 2,
      department: 'design',
      task: 'Pick hero',
      expectedOutcome: 'A single hero image or arrangement picked from the brand kit.',
      dependsOn: [],
      status: 'queued',
      output: null,
      verifierVerdict: null,
      startedAt: null,
      completedAt: null,
    },
    {
      id: 'step_eng_merge_deploy',
      stepIndex: 3,
      department: 'engineering',
      task: 'Merge PR and deploy',
      expectedOutcome: '/pricing is live on production with the chosen hero and a headline.',
      dependsOn: [0, 1, 2],
      status: 'queued',
      output: null,
      verifierVerdict: null,
      startedAt: null,
      completedAt: null,
    },
  ],
};

export const COMPLETED_PLAN_FIXTURE: PlanRun = {
  id: 'plan_run_completed_demo',
  spaceId: 'space_demo',
  goal: 'Ship the /pricing page by end of day.',
  planSummary:
    'Open a PR for the route, draft three headline candidates, pick a hero, then merge and deploy.',
  status: 'completed',
  overallSatisfied: false,
  verifierSummary:
    'The page is built and the PR is merged. The deploy step ran, but the prod URL hasn\'t been verified — confirm it before claiming this is done.',
  totalSteps: 4,
  completedSteps: 4,
  createdAt: '2026-05-17T09:12:00.000Z',
  completedAt: '2026-05-17T10:48:00.000Z',
  steps: [
    {
      id: 'step_eng_open_pr',
      stepIndex: 0,
      department: 'engineering',
      task: 'Open a PR adding /pricing route',
      expectedOutcome: 'A draft PR exists on main with a stub /pricing page and a passing build.',
      dependsOn: [],
      status: 'completed',
      output:
        'Opened PR #482: add /pricing route. Stub page renders headline + three-tier table. CI green.',
      verifierVerdict: {
        satisfied: true,
        reason: 'PR is open, build is green, route renders without errors.',
        suggested_follow_up: '',
      },
      startedAt: '2026-05-17T09:13:00.000Z',
      completedAt: '2026-05-17T09:24:00.000Z',
    },
    {
      id: 'step_mkt_headlines',
      stepIndex: 1,
      department: 'marketing',
      task: 'Draft 3 headlines',
      expectedOutcome: 'Three founder-voice headline candidates, each under 8 words.',
      dependsOn: [],
      status: 'completed',
      output:
        '1. Pricing that scales with you.\n2. Pay for the parts you use.\n3. One price. Every feature.',
      verifierVerdict: {
        satisfied: true,
        reason: 'Three headlines delivered, all under 8 words and on-voice.',
        suggested_follow_up: '',
      },
      startedAt: '2026-05-17T09:25:00.000Z',
      completedAt: '2026-05-17T09:41:00.000Z',
    },
    {
      id: 'step_design_hero',
      stepIndex: 2,
      department: 'design',
      task: 'Pick hero',
      expectedOutcome: 'A single hero image or arrangement picked from the brand kit.',
      dependsOn: [],
      status: 'completed',
      output: 'Picked hero-monochrome-02 from the brand kit. Crop 16:9.',
      verifierVerdict: {
        satisfied: true,
        reason: 'A single brand-kit hero was chosen and crop spec was noted.',
        suggested_follow_up: '',
      },
      startedAt: '2026-05-17T09:42:00.000Z',
      completedAt: '2026-05-17T09:58:00.000Z',
    },
    {
      id: 'step_eng_merge_deploy',
      stepIndex: 3,
      department: 'engineering',
      task: 'Merge PR and deploy',
      expectedOutcome: '/pricing is live on production with the chosen hero and a headline.',
      dependsOn: [0, 1, 2],
      status: 'completed',
      output: 'Merged PR #482. Triggered prod deploy. Build URL returned 200.',
      verifierVerdict: {
        satisfied: false,
        reason:
          'The deploy job reported success, but no one checked the live URL for the chosen hero and headline.',
        suggested_follow_up:
          'Verify the deploy is live by hitting the prod URL. Wait 15m.',
      },
      startedAt: '2026-05-17T10:24:00.000Z',
      completedAt: '2026-05-17T10:48:00.000Z',
    },
  ],
};
