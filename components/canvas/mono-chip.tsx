/**
 * Tiny monospace chip — for `Z 100%`, repo paths, status pills.
 *
 * A flat surface with a hairline border. No background colour by default;
 * the `tone` prop tints the text.
 */

import { cn } from '@/lib/utils';
import { MONO_CHIP } from '@/lib/typography';

export type ChipTone = 'neutral' | 'running' | 'queued' | 'done' | 'warning';

const TONE_TEXT: Record<ChipTone, string> = {
  neutral: 'text-muted-foreground',
  running: 'text-amber-700',
  queued: 'text-violet-700',
  done: 'text-emerald-700',
  warning: 'text-amber-700',
};

interface Props {
  children: React.ReactNode;
  tone?: ChipTone;
  className?: string;
}

export function MonoChip({ children, tone = 'neutral', className }: Props) {
  return (
    <span
      className={cn(
        MONO_CHIP,
        'inline-flex items-center rounded-md border border-slate-200 bg-white px-1.5 py-0.5 leading-none',
        TONE_TEXT[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
