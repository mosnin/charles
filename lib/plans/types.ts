/**
 * Plan run data contract.
 *
 * This is the shape the founder-facing /plans surface reads. It mirrors what
 * the backend persistence layer (built in parallel) returns, and is the only
 * file UI components import for plan typing — invent no new fields here,
 * grow this file when the contract grows.
 *
 * A PlanRun is one goal handed to Charles. It decomposes into ordered
 * PlanStepRows (one SwarmMember per step); a step records its expected
 * outcome, its dependencies, what it actually produced, and the verifier's
 * post-hoc check. Top-level `overallSatisfied` summarises whether the run
 * cleared every step's verifier.
 */
export type PlanStepStatus = 'queued' | 'running' | 'completed' | 'failed' | 'blocked';
export type PlanRunStatus = 'planning' | 'running' | 'auditing' | 'completed' | 'failed' | 'cancelled';

export interface PlanStepVerdict {
  satisfied: boolean;
  reason: string;
  suggested_follow_up: string;
}

export interface PlanStepRow {
  id: string;            // SwarmMember.id
  stepIndex: number;
  department: 'engineering' | 'sales' | 'marketing' | 'design' | 'support' | 'ops_finance';
  task: string;
  expectedOutcome: string;
  dependsOn: number[];
  status: PlanStepStatus;
  output: string | null;
  verifierVerdict: PlanStepVerdict | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface PlanRun {
  id: string;
  spaceId: string;
  goal: string;
  planSummary: string;
  status: PlanRunStatus;
  overallSatisfied: boolean | null;
  verifierSummary: string | null;
  totalSteps: number;
  completedSteps: number;
  createdAt: string;
  completedAt: string | null;
  steps: PlanStepRow[];
}
