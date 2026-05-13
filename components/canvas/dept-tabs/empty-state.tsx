/**
 * Empty-state card for tabs that don't have data yet.
 *
 * One verb-first sentence, an optional link. No emoji, no fluff. The card
 * itself is a quiet neutral surface — it should read as "this place is
 * intentionally empty," not "something broke."
 */

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { BODY, BODY_MUTED } from '@/lib/typography';

interface Props {
  title: string;
  hint?: string;
  cta?: { label: string; href: string };
  className?: string;
}

export function EmptyState({ title, hint, cta, className }: Props) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center space-y-3',
        className,
      )}
      data-testid="dept-tab-empty"
    >
      <p className={BODY}>{title}</p>
      {hint && <p className={BODY_MUTED}>{hint}</p>}
      {cta && (
        <p>
          <Link
            href={cta.href}
            className="text-[13px] underline underline-offset-4 text-slate-700 hover:text-slate-900"
          >
            {cta.label}
          </Link>
        </p>
      )}
    </section>
  );
}
