'use client';

/**
 * Carousel chip — a tiny "label · n/total" pager with prev / next arrows.
 *
 * Lives at the bottom of department tab cards (Email Preview, etc.). The
 * surrounding tab component owns the index state and passes it in; this
 * component is dumb on purpose.
 */

import { cn } from '@/lib/utils';
import { MONO_META } from '@/lib/typography';

interface Props {
  label: string;
  index: number;
  total: number;
  onPrev?: () => void;
  onNext?: () => void;
  className?: string;
}

export function CarouselChip({
  label,
  index,
  total,
  onPrev,
  onNext,
  className,
}: Props) {
  const safeTotal = Math.max(1, total);
  const safeIndex = ((index % safeTotal) + safeTotal) % safeTotal;
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1',
        className,
      )}
      data-testid="carousel-chip"
    >
      <button
        type="button"
        aria-label="Previous"
        onClick={onPrev}
        className="text-slate-500 hover:text-slate-900 transition-colors duration-150"
      >
        {'<'}
      </button>
      <span className="text-[12px] font-medium text-slate-700">{label}</span>
      <span className={cn(MONO_META, 'tabular-nums')}>
        {safeIndex + 1}/{safeTotal}
      </span>
      <button
        type="button"
        aria-label="Next"
        onClick={onNext}
        className="text-slate-500 hover:text-slate-900 transition-colors duration-150"
      >
        {'>'}
      </button>
    </div>
  );
}
