'use client';

/**
 * Stages kanban canvas.
 *
 * Desktop (md+): six columns flowing left-to-right, dotted grid underneath,
 * dashed connectors between adjacent columns. One column per stage in
 * STAGE_ORDER; each column renders the gates that live in it (DB rows
 * when present, catalog placeholders when not).
 *
 * Mobile (< md): the same six stages stacked vertically as full-width
 * sections. No horizontal scroll, no ConnectorOverlay — the dashed S-curve
 * only makes visual sense horizontally. Each section keeps its MonoChip
 * header and completion count above its task cards.
 *
 * Per-column visual contract:
 *   header → MonoChip with "<stage> stage" + completion count
 *   stack  → vertical list of TaskCards (one per gate)
 *
 * Past stages: every card is checked + line-through but still toggleable.
 * Current stage: full-color cards with interactive arrows + toggles.
 * Future stages: cards rendered at 50% opacity, not interactive.
 */

import { useRef } from 'react';
import { GridBackground } from '@/components/canvas/grid-background';
import { ConnectorOverlay } from '@/components/canvas/connector-overlay';
import { TaskCard, type CardState } from '@/components/canvas/task-card';
import { MonoChip } from '@/components/canvas/mono-chip';
import { cn } from '@/lib/utils';
import {
  STAGE_ORDER,
  type Stage,
} from '@/lib/stages/catalog';
import {
  columnLabelFor,
  completionFor,
  nextStagePairs,
  taskKindFor,
  type CanvasGate,
} from '@/lib/stages/canvas-helpers';

interface Props {
  slug: string;
  currentStage: Stage;
  columns: Record<Stage, CanvasGate[]>;
  /** Mark which columns rendered DB rows vs. catalog placeholders. */
  placeholderStages: ReadonlySet<Stage>;
}

export function StagesCanvas({ slug, currentStage, columns, placeholderStages }: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const pairs = nextStagePairs();

  const currentIndex = STAGE_ORDER.indexOf(currentStage);

  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        className="relative overflow-x-auto overflow-y-visible rounded-2xl border border-zinc-200 bg-white"
      >
        <GridBackground className="bg-grid-strong" />

        {/* Mobile: stacked column. Desktop: horizontal row with min-width. */}
        <div className="relative flex flex-col gap-8 px-5 py-6 md:flex-row md:gap-6 md:px-6 md:py-8 md:min-w-max">
          {STAGE_ORDER.map((stage) => {
            const stageIndex = STAGE_ORDER.indexOf(stage);
            const cards = columns[stage];
            const counts = completionFor(cards);
            const state: CardState =
              stageIndex < currentIndex
                ? 'past'
                : stageIndex === currentIndex
                  ? 'current'
                  : 'future';
            const isPlaceholderColumn = placeholderStages.has(stage);

            return (
              <div
                key={stage}
                className="flex w-full flex-col gap-3 md:w-[280px] md:flex-shrink-0"
                data-stage={stage}
              >
                <ColumnHeader
                  label={columnLabelFor(stage)}
                  count={counts.label}
                  muted={state === 'future'}
                />

                {cards.length === 0 ? (
                  <EmptyColumn />
                ) : (
                  cards.map((g, idx) => {
                    const isFirst = idx === 0;
                    const isLast = idx === cards.length - 1;
                    return (
                      <div
                        key={g.id}
                        data-to-stage={isFirst ? stage : undefined}
                        data-from-stage={isLast ? stage : undefined}
                      >
                        <TaskCard
                          id={g.id}
                          slug={slug}
                          title={g.title}
                          kind={taskKindFor(g)}
                          isComplete={g.isComplete}
                          stage={stage}
                          state={state}
                          isPlaceholder={isPlaceholderColumn}
                        />
                      </div>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>

        {/* Connector overlay — desktop only. The S-curves only resolve
            visually when columns sit side-by-side. */}
        <div className="hidden md:block">
          <ConnectorOverlay pairs={pairs} containerRef={scrollerRef} />
        </div>
      </div>
    </div>
  );
}

function ColumnHeader({
  label,
  count,
  muted,
}: {
  label: string;
  count: string;
  muted: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <MonoChip className={muted ? 'opacity-60' : undefined}>{label}</MonoChip>
      <span
        className={cn(
          'font-mono text-[11px] tabular-nums',
          muted ? 'text-zinc-400' : 'text-zinc-500',
        )}
      >
        {count}
      </span>
    </div>
  );
}

function EmptyColumn() {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-200 bg-white/40 px-3 py-6 text-center">
      <p className="font-mono text-[11px] uppercase tracking-wide text-zinc-400">
        Not yet started
      </p>
    </div>
  );
}
