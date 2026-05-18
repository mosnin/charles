/**
 * Faint 16px dotted grid. The substrate every canvas surface sits on.
 *
 * Uses the `.bg-grid` utility defined in app/globals.css. Absolutely
 * positioned so it fills its nearest positioned ancestor. The dots are
 * purely decorative — they carry no meaning, they just give the eye a
 * frame of reference when the founder pans.
 */

import { cn } from '@/lib/utils';

interface Props {
  /** Use 0.10 alpha dots (`.bg-grid-strong`) instead of 0.06 for surfaces
   *  where the grid carries more structural weight (the kanban). */
  strong?: boolean;
  className?: string;
}

export function GridBackground({ strong = false, className }: Props) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0',
        strong ? 'bg-grid-strong' : 'bg-grid',
        className,
      )}
    />
  );
}
