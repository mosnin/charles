'use client';

/**
 * StageScrubber — the marquee component for the "where are you?" question.
 *
 * Top: a horizontal pill row of stage labels (selected one is light-blue).
 * Middle: a 50-tick ruler whose tick range under the selected pill is colored.
 * Below: a small blue dot sitting at the horizontal center of that range.
 * Clicking either a label or a tick changes selection.
 */

import { cn } from '@/lib/utils';

export interface StageOption {
  value: string;
  label: string;
}

interface StageScrubberProps {
  stages: readonly StageOption[];
  value: string;
  onChange: (value: string) => void;
}

const TOTAL_TICKS = 50;

export interface TickRange {
  start: number;
  end: number;
  dotPosition: number;
}

/**
 * Pure helper: given the active stage index and how many stages exist, return
 * the inclusive tick-index range that should be colored, plus the horizontal
 * dot position (0..totalTicks-1, integer at the center of the range).
 */
export function tickRangeForStage(
  stageIndex: number,
  totalStages: number,
  totalTicks: number = TOTAL_TICKS,
): TickRange {
  if (totalStages <= 0) {
    return { start: 0, end: 0, dotPosition: 0 };
  }
  const clamped = Math.max(0, Math.min(stageIndex, totalStages - 1));
  const start = Math.floor((clamped * totalTicks) / totalStages);
  const endExclusive = Math.floor(((clamped + 1) * totalTicks) / totalStages);
  const end = Math.max(start, endExclusive - 1);
  const dotPosition = Math.floor((start + end) / 2);
  return { start, end, dotPosition };
}

export function StageScrubber({ stages, value, onChange }: StageScrubberProps) {
  const activeIndex = Math.max(
    0,
    stages.findIndex((s) => s.value === value),
  );
  const { start, end, dotPosition } = tickRangeForStage(
    activeIndex,
    stages.length,
    TOTAL_TICKS,
  );

  const handleTickClick = (tickIndex: number) => {
    if (stages.length === 0) return;
    const stageIdx = Math.min(
      stages.length - 1,
      Math.floor((tickIndex * stages.length) / TOTAL_TICKS),
    );
    onChange(stages[stageIdx].value);
  };

  return (
    <div className="w-full">
      {/* Labels */}
      <div className="flex items-center justify-between gap-2">
        {stages.map((stage) => {
          const selected = stage.value === value;
          return (
            <button
              key={stage.value}
              type="button"
              onClick={() => onChange(stage.value)}
              className={cn(
                'rounded-full px-3 py-1 text-xs transition-colors',
                selected
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {stage.label}
            </button>
          );
        })}
      </div>

      {/* Tick ruler */}
      <div className="mt-6 flex items-end justify-between gap-px">
        {Array.from({ length: TOTAL_TICKS }).map((_, i) => {
          const active = i >= start && i <= end;
          return (
            <button
              key={i}
              type="button"
              aria-label={`tick ${i + 1}`}
              onClick={() => handleTickClick(i)}
              className={cn(
                'w-px h-3.5 transition-colors',
                active ? 'bg-blue-500' : 'bg-border/40 hover:bg-border',
              )}
            />
          );
        })}
      </div>

      {/* Dot rail */}
      <div className="mt-2 relative h-2">
        <div
          aria-hidden
          className="absolute size-1.5 rounded-full bg-blue-500"
          style={{
            left: `${(dotPosition / (TOTAL_TICKS - 1)) * 100}%`,
            transform: 'translateX(-50%)',
          }}
        />
      </div>
    </div>
  );
}
