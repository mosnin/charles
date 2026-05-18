/**
 * Stages-kanban view helpers.
 *
 * Pure functions the canvas page uses to turn a flat list of StageGate rows
 * + the catalog into something the layout can render: columns grouped by
 * stage, a coarse "kind" classifier for each gate, and the cross-stage
 * connector pair list.
 *
 * Kept side-effect-free so they can be unit-tested without a DOM or DB.
 */

import { STAGE_ORDER, STAGES, type Stage } from '@/lib/stages/catalog';

/** Minimal shape the canvas needs from a StageGate row. */
export interface CanvasGate {
  id: string;
  stage: Stage;
  title: string;
  isComplete: boolean;
  /** Optional ordering hint from the DB (`order` column). */
  order?: number | null;
  /**
   * Optional metadata bag. We look at `kind` / `requiresApproval` if present
   * to classify the task. Everything is optional so the type stays loose for
   * v1 — gate rows in the DB don't carry these fields today.
   */
  metadata?: Record<string, unknown> | null;
}

/** What kind of task this gate represents. Drives the subtitle text. */
export type GateTaskKind = 'user' | 'agent' | 'agent-approval';

/**
 * Group gates by stage. Returns a record keyed by every stage slug in the
 * catalog, so callers can iterate `STAGE_ORDER` without missing-key checks.
 *
 * Within each stage the gates are sorted by `order` ascending (nulls last),
 * then by title for determinism.
 */
export function groupGatesByStage<T extends CanvasGate>(
  gates: readonly T[],
  stages: readonly Stage[] = STAGE_ORDER,
): Record<Stage, T[]> {
  const out = {} as Record<Stage, T[]>;
  for (const s of stages) out[s] = [];

  for (const g of gates) {
    if (!out[g.stage]) continue; // unknown stage slug — drop
    out[g.stage].push(g);
  }

  for (const s of stages) {
    out[s].sort((a, b) => {
      const ao = a.order ?? Number.POSITIVE_INFINITY;
      const bo = b.order ?? Number.POSITIVE_INFINITY;
      if (ao !== bo) return ao - bo;
      return a.title.localeCompare(b.title);
    });
  }

  return out;
}

/**
 * Coarse task-kind classifier for v1.
 *
 * Reads optional `kind` / `requiresApproval` metadata if present, otherwise
 * defaults to `'user'`. The contract: every gate produces exactly one of
 * three subtitle bands ("User task" / "Agent task" / "Agent requires
 * approval"). When the DB schema grows real fields, this is the one place
 * to update.
 */
export function taskKindFor(gate: CanvasGate): GateTaskKind {
  const meta = gate.metadata ?? {};
  const kind = (meta as { kind?: unknown }).kind;
  if (kind === 'agent-approval') return 'agent-approval';
  if (kind === 'agent') {
    return (meta as { requiresApproval?: unknown }).requiresApproval
      ? 'agent-approval'
      : 'agent';
  }
  if (kind === 'user') return 'user';
  return 'user';
}

/** Human-readable subtitle string for a task kind. */
export function subtitleFor(kind: GateTaskKind): string {
  switch (kind) {
    case 'user':
      return 'User task';
    case 'agent':
      return 'Agent task';
    case 'agent-approval':
      return 'Agent requires approval';
  }
}

/** A single connector between two stage columns. */
export interface StagePair {
  from: Stage;
  to: Stage;
  fromIndex: number;
  toIndex: number;
}

/**
 * The 5 cross-stage connectors for the kanban: each adjacent pair of stages
 * in catalog order. For a 6-stage catalog returns 5 pairs.
 */
export function nextStagePairs(
  stages: readonly Stage[] = STAGE_ORDER,
): StagePair[] {
  const pairs: StagePair[] = [];
  for (let i = 0; i < stages.length - 1; i++) {
    pairs.push({
      from: stages[i],
      to: stages[i + 1],
      fromIndex: i,
      toIndex: i + 1,
    });
  }
  return pairs;
}

/**
 * Column-header label as the visible string ("idea stage", "initial
 * stage"…). Lowercase + " stage" suffix.
 */
export function columnLabelFor(stage: Stage): string {
  return `${STAGES[stage].label.toLowerCase()} stage`;
}

/** Render the completion count for a column ("1/3", "0/0"). */
export function completionFor<T extends CanvasGate>(
  gatesInColumn: readonly T[],
): { complete: number; total: number; label: string } {
  const total = gatesInColumn.length;
  const complete = gatesInColumn.filter((g) => g.isComplete).length;
  return { complete, total, label: `${complete}/${total}` };
}

/**
 * For a stage that has no DB rows yet, build placeholder gates from the
 * catalog so the column still renders. Placeholder ids are stable (the
 * gate title) so React keys don't churn between renders.
 */
export function placeholderGatesFor(stage: Stage): CanvasGate[] {
  return STAGES[stage].gates.map((title, i) => ({
    id: `placeholder:${stage}:${i}`,
    stage,
    title,
    isComplete: false,
    order: i,
    metadata: null,
  }));
}
