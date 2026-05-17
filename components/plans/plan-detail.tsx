'use client';

/**
 * PlanDetail — the per-run founder surface.
 *
 * One screen, top to bottom: the goal, what Charles intends to do about it,
 * the verifier's after-the-fact read (when the run is far enough along to
 * have one), and a vertical list of steps in their planned order.
 *
 * No headers between sections — the spacing carries the rhythm. Each step
 * card shows what was asked for (`expectedOutcome`), what (if anything) the
 * step produced (`output`), and what the verifier thought (`verifierVerdict`
 * + an optional follow-up the founder can act on). When a step is still
 * queued or running, the card stays quiet.
 *
 * Server-state stays read-only here — polling is the wrapper's job
 * (PlanDetailPoll). This component is pure data → DOM.
 */

import { Check, X, Clock, CircleDot, Hourglass, Ban, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  H2,
  BODY,
  BODY_MUTED,
  CAPTION,
  MONO_CHIP,
  SECTION_RHYTHM,
} from '@/lib/typography';
import type {
  PlanRun,
  PlanStepRow,
  PlanStepStatus,
  PlanRunStatus,
} from '@/lib/plans/types';

interface Props {
  run: PlanRun;
}

export function PlanDetail({ run }: Props) {
  // Defensive sort — backend should already return stepIndex order, but a
  // mis-ordered fixture or a race in the poller shouldn't break the visual.
  const steps = [...run.steps].sort((a, b) => a.stepIndex - b.stepIndex);

  return (
    <div className={cn(SECTION_RHYTHM)}>
      {/* Header — goal + summary + status chip */}
      <header className="flex items-start justify-between gap-6">
        <div className="min-w-0 space-y-1.5">
          <h2 className={H2}>{run.goal}</h2>
          <p className={BODY_MUTED}>{run.planSummary}</p>
        </div>
        <RunStatusChip
          status={run.status}
          overallSatisfied={run.overallSatisfied}
          completedSteps={run.completedSteps}
          totalSteps={run.totalSteps}
        />
      </header>

      {/* Verifier summary — only renders when the verifier has spoken */}
      {run.verifierSummary && (
        <div
          data-testid="verifier-summary"
          className="rounded-xl bg-muted/40 p-4"
        >
          <div className="flex items-start gap-3">
            <VerdictMark satisfied={run.overallSatisfied ?? false} />
            <p className={cn(BODY, 'min-w-0 flex-1 leading-relaxed')}>
              {run.verifierSummary}
            </p>
          </div>
        </div>
      )}

      {/* Steps list */}
      <ol className="space-y-3">
        {steps.map((step) => (
          <li key={step.id}>
            <StepCard step={step} />
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ─── Step card ────────────────────────────────────────────────────────── */

function StepCard({ step }: { step: PlanStepRow }) {
  return (
    <article
      data-testid="step-card"
      data-step-index={step.stepIndex}
      className="rounded-xl border border-border bg-background p-4"
    >
      {/* Top row: dept chip, task, status */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn(MONO_CHIP, 'shrink-0 text-muted-foreground')}>
            {step.department.replace('_', ' ')}
          </span>
          <span className={cn(BODY, 'font-medium')}>{step.task}</span>
        </div>
        <StepStatusChip status={step.status} />
      </div>

      {/* Expected outcome */}
      <p className={cn(CAPTION, 'mt-2 leading-relaxed')}>
        <span className="text-muted-foreground/70">Expected: </span>
        {step.expectedOutcome}
      </p>

      {/* Dependencies — quiet, only when present */}
      {step.dependsOn.length > 0 && (
        <p className={cn(CAPTION, 'mt-1 tabular-nums')}>
          <span className="text-muted-foreground/70">Depends on: </span>
          {step.dependsOn.map((i) => `#${i + 1}`).join(', ')}
        </p>
      )}

      {/* Output — only on completed steps */}
      {step.status === 'completed' && step.output && (
        <div className="mt-3 max-h-40 overflow-y-auto rounded-lg bg-muted/30 p-3">
          <p className={cn(BODY, 'whitespace-pre-wrap leading-relaxed text-foreground/90')}>
            {step.output}
          </p>
        </div>
      )}

      {/* Verifier verdict */}
      {step.verifierVerdict && (
        <div className="mt-3 space-y-2">
          <div className="flex items-start gap-2">
            <VerdictMark satisfied={step.verifierVerdict.satisfied} />
            <p className={cn(CAPTION, 'min-w-0 flex-1 leading-relaxed text-foreground/80')}>
              {step.verifierVerdict.reason}
            </p>
          </div>

          {step.verifierVerdict.suggested_follow_up && (
            <div
              data-testid="follow-up"
              className="rounded-md border border-dashed border-border/70 bg-muted/10 px-3 py-2"
            >
              <p className={cn(CAPTION, 'leading-relaxed')}>
                <span className="text-muted-foreground/70">Follow-up: </span>
                {step.verifierVerdict.suggested_follow_up}
              </p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/* ─── Status chips ─────────────────────────────────────────────────────── */

function RunStatusChip({
  status,
  overallSatisfied,
  completedSteps,
  totalSteps,
}: {
  status: PlanRunStatus;
  overallSatisfied: boolean | null;
  completedSteps: number;
  totalSteps: number;
}) {
  const isTerminal = status === 'completed' || status === 'failed' || status === 'cancelled';
  const mark =
    isTerminal && status === 'completed' ? (
      overallSatisfied ? (
        <Check size={12} strokeWidth={2.5} className="text-[#1F6E3A]" />
      ) : (
        <X size={12} strokeWidth={2.5} className="text-[#8B1A1A]" />
      )
    ) : null;

  return (
    <span
      data-testid="run-status-chip"
      className={cn(
        MONO_CHIP,
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-muted-foreground',
      )}
    >
      {mark}
      <span>{status}</span>
      <span className="text-muted-foreground/60">·</span>
      <span className="tabular-nums">
        {completedSteps}/{totalSteps}
      </span>
    </span>
  );
}

interface StepStatusVisual {
  label: string;
  Icon: typeof Check;
  iconClass: string;
}

function stepStatusVisual(status: PlanStepStatus): StepStatusVisual {
  switch (status) {
    case 'completed':
      return { label: 'completed', Icon: Check, iconClass: 'text-[#1F6E3A]' };
    case 'running':
      return { label: 'running', Icon: CircleDot, iconClass: 'text-[#B7791F]' };
    case 'queued':
      return { label: 'queued', Icon: Hourglass, iconClass: 'text-muted-foreground' };
    case 'failed':
      return { label: 'failed', Icon: AlertTriangle, iconClass: 'text-[#8B1A1A]' };
    case 'blocked':
      return { label: 'blocked', Icon: Ban, iconClass: 'text-muted-foreground' };
    default:
      return { label: status, Icon: Clock, iconClass: 'text-muted-foreground' };
  }
}

function StepStatusChip({ status }: { status: PlanStepStatus }) {
  const { label, Icon, iconClass } = stepStatusVisual(status);
  return (
    <span
      data-testid="step-status-chip"
      data-status={status}
      className={cn(
        MONO_CHIP,
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-muted-foreground',
      )}
    >
      <Icon size={11} strokeWidth={2.5} className={iconClass} />
      {label}
    </span>
  );
}

function VerdictMark({ satisfied }: { satisfied: boolean }) {
  return satisfied ? (
    <span
      data-testid="verdict-mark"
      data-satisfied="true"
      className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#1F6E3A]/10"
    >
      <Check size={11} strokeWidth={2.75} className="text-[#1F6E3A]" />
    </span>
  ) : (
    <span
      data-testid="verdict-mark"
      data-satisfied="false"
      className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#8B1A1A]/10"
    >
      <X size={11} strokeWidth={2.75} className="text-[#8B1A1A]" />
    </span>
  );
}
