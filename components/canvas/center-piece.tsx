/**
 * Canvas centerpiece — sapling above the mission title.
 *
 * The heart of the orbit. Small white card, hairline border, no shadow.
 * Mission name in serif so it reads as the headline, not as chrome.
 */

import { cn } from '@/lib/utils';
import { SERIF_CARD, SERIF_FONT_STYLE } from '@/lib/typography';
import { Sapling } from './sapling';

interface Props {
  title: string;
  className?: string;
}

export function CenterPiece({ title, className }: Props) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3',
        'min-w-[140px] max-w-[200px]',
        className,
      )}
    >
      <Sapling size={32} />
      <div
        className={cn(SERIF_CARD, 'text-center text-slate-900 leading-tight')}
        style={SERIF_FONT_STYLE}
      >
        {title}
      </div>
    </div>
  );
}
