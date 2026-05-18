/**
 * 6px coloured dot — for dept-node status rows. No labels, no counts here.
 * Colour carries the meaning.
 */

import { cn } from '@/lib/utils';

export type DotTone = 'running' | 'queued' | 'idle' | 'done' | 'failed';

const TONE_CLASS: Record<DotTone, string> = {
  // running = yellow (#FBBF24, amber-400)
  running: 'bg-amber-400',
  // queued = purple (#A78BFA, violet-400)
  queued: 'bg-violet-400',
  // idle = gray (#D1D5DB, slate-300)
  idle: 'bg-slate-300',
  // done = green (#10B981, emerald-500)
  done: 'bg-emerald-500',
  // failed = red (#EF4444, red-500)
  failed: 'bg-red-500',
};

interface Props {
  tone: DotTone;
  className?: string;
}

export function StatusDot({ tone, className }: Props) {
  return (
    <span
      aria-hidden
      className={cn('inline-block h-1.5 w-1.5 rounded-full', TONE_CLASS[tone], className)}
    />
  );
}
