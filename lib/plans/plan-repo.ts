/**
 * Plan View repo — reads plan executions back out of SwarmRun +
 * SwarmMember and shapes them into the PlanRun contract the UI
 * consumes.
 *
 * The data lives in two tables (no schema duplication):
 *   - SwarmRun: id, goal, plan (jsonb of the structured Plan),
 *     status, overallSatisfied, verifierSummary, createdAt,
 *     completedAt.
 *   - SwarmMember: per-step rows linked by swarmRunId. We join by
 *     stepIndex back into SwarmRun.plan.steps[i] to recover the
 *     planner-time fields (expectedOutcome, dependsOn) that don't
 *     have their own columns.
 *
 * The Python planner (agent/manager/charles.py:plan_and_execute) is
 * the only writer. The Plan View read path tolerates non-plan
 * SwarmRuns (no plan jsonb, status='completed' from the legacy
 * swarm orchestrator) by filtering them out at query time — they
 * appear on /swarm/, not /plans/.
 */

import { supabase } from '@/lib/supabase';
import type {
  PlanRun,
  PlanRunStatus,
  PlanStepRow,
  PlanStepStatus,
  PlanStepVerdict,
} from '@/lib/plans/types';

interface SwarmRunRow {
  id: string;
  spaceId: string;
  goal: string;
  plan: PlanJson | null;
  status: PlanRunStatus | string;
  overallSatisfied: boolean | null;
  verifierSummary: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface SwarmMemberRow {
  id: string;
  swarmRunId: string;
  role: string | null;
  task: string;
  stepIndex: number | null;
  status: PlanStepStatus | string;
  output: string | null;
  verifierVerdict: PlanStepVerdict | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface PlanJson {
  goal?: string;
  summary?: string;
  steps?: Array<{
    department?: string;
    task?: string;
    expected_outcome?: string;
    depends_on?: number[];
    context?: string;
  }>;
}

/**
 * Load a single plan run + its steps for the detail page. Returns
 * null when the row doesn't exist or doesn't belong to the space
 * — both surface to the page as a 404 (caller's job).
 */
export async function loadPlanForRun(
  spaceId: string,
  runId: string,
): Promise<PlanRun | null> {
  const { data: runRow, error: runErr } = await supabase
    .from('SwarmRun')
    .select(
      'id, spaceId, goal, plan, status, overallSatisfied, verifierSummary, createdAt, completedAt',
    )
    .eq('id', runId)
    .eq('spaceId', spaceId)
    .maybeSingle();

  if (runErr || !runRow) return null;
  // Skip non-plan SwarmRuns (legacy swarm orchestrator entries). The
  // distinguishing mark is `plan` jsonb present + at least one step.
  const planJson = (runRow as SwarmRunRow).plan;
  if (!planJson || !Array.isArray(planJson.steps) || planJson.steps.length === 0) {
    return null;
  }

  const { data: memberRows, error: memberErr } = await supabase
    .from('SwarmMember')
    .select(
      'id, swarmRunId, role, task, stepIndex, status, output, verifierVerdict, startedAt, completedAt',
    )
    .eq('swarmRunId', runId)
    .not('stepIndex', 'is', null)
    .order('stepIndex', { ascending: true });

  if (memberErr) {
    throw new Error(`loadPlanForRun members: ${memberErr.message}`);
  }

  return composePlanRun(runRow as SwarmRunRow, (memberRows ?? []) as SwarmMemberRow[]);
}

/**
 * Recent plan runs for the index page. Filters out non-plan SwarmRuns
 * (those without a plan jsonb) so the legacy swarm orchestrator runs
 * don't appear here.
 */
export async function listRecentPlans(
  spaceId: string,
  limit = 20,
): Promise<PlanRun[]> {
  const { data, error } = await supabase
    .from('SwarmRun')
    .select(
      'id, spaceId, goal, plan, status, overallSatisfied, verifierSummary, createdAt, completedAt',
    )
    .eq('spaceId', spaceId)
    .not('plan', 'is', null)
    .order('createdAt', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`listRecentPlans: ${error.message}`);

  const runs = (data ?? []) as SwarmRunRow[];
  const planRuns = runs.filter(
    (r) => r.plan && Array.isArray(r.plan.steps) && r.plan.steps.length > 0,
  );

  // No member rows on the index — the cards only show goal, status,
  // step counts (from plan.steps.length), and timestamps. Saves a
  // second query per row.
  return planRuns.map((r) => composePlanRun(r, []));
}

/** Pure shaper: SwarmRun + SwarmMember[] → PlanRun. Exported for tests. */
export function composePlanRun(
  run: SwarmRunRow,
  members: SwarmMemberRow[],
): PlanRun {
  const planSteps = run.plan?.steps ?? [];
  const totalSteps = planSteps.length;

  // Index member rows by stepIndex for the join. Null stepIndex
  // shouldn't appear (query filter), but defence-in-depth.
  const byIndex = new Map<number, SwarmMemberRow>();
  for (const m of members) {
    if (typeof m.stepIndex === 'number') byIndex.set(m.stepIndex, m);
  }

  const steps: PlanStepRow[] = planSteps.map((s, i) => {
    const m = byIndex.get(i);
    // Status: take the SwarmMember status when present (live state);
    // otherwise fall back to 'queued' (step not yet started). 'blocked'
    // is a planner-internal status the SwarmMember enum doesn't carry,
    // so we don't try to reconstruct it from this read; the verifier
    // verdict still surfaces the reason.
    const status: PlanStepStatus = m
      ? (m.status as PlanStepStatus)
      : 'queued';
    return {
      id: m?.id ?? `step-${i}-pending`,
      stepIndex: i,
      department: (s.department ?? m?.role ?? 'engineering') as PlanStepRow['department'],
      task: s.task ?? m?.task ?? '',
      expectedOutcome: s.expected_outcome ?? '',
      dependsOn: Array.isArray(s.depends_on) ? s.depends_on : [],
      status,
      output: m?.output ?? null,
      verifierVerdict: m?.verifierVerdict ?? null,
      startedAt: m?.startedAt ?? null,
      completedAt: m?.completedAt ?? null,
    };
  });

  const completedSteps = steps.filter(
    (s) => s.status === 'completed' || s.status === 'failed' || s.status === 'blocked',
  ).length;

  return {
    id: run.id,
    spaceId: run.spaceId,
    goal: run.goal,
    planSummary: run.plan?.summary ?? '',
    status: (run.status as PlanRunStatus) ?? 'running',
    overallSatisfied: run.overallSatisfied,
    verifierSummary: run.verifierSummary,
    totalSteps,
    completedSteps,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    steps,
  };
}
