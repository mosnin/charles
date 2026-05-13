'use client';

/**
 * NumberedOptionList — a vertical stack of pill buttons.
 *
 * Each option carries a two-digit zero-padded index, a hairline divider, then
 * the label. Selected state is signaled by a darker border, not a fill change,
 * so the surface stays calm. Used as the body of single-choice questions.
 */

import { cn } from '@/lib/utils';

export interface NumberedOption {
  id: string;
  label: string;
}

interface NumberedOptionListProps {
  options: readonly NumberedOption[];
  value: string | null;
  onChange: (id: string) => void;
}

/** Pure helper: 0 → "01", 9 → "10", 99 → "100". */
export function formatOptionNumber(index: number): string {
  return String(index + 1).padStart(2, '0');
}

export function NumberedOptionList({
  options,
  value,
  onChange,
}: NumberedOptionListProps) {
  return (
    <div className="space-y-2">
      {options.map((option, index) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={cn(
              'group flex w-full items-center px-5 py-4 rounded-lg',
              'border bg-background/40 text-left text-sm',
              'transition-transform hover:bg-muted/30',
              selected
                ? 'border-foreground/60 scale-[1.01]'
                : 'border-border/70',
            )}
          >
            <span className="font-mono text-sm text-muted-foreground">
              {formatOptionNumber(index)}
            </span>
            <span className="w-px h-4 bg-border mx-4" />
            <span className="text-foreground">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
