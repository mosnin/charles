/**
 * Quiet, honest billing banner — shown when the workspace subscription is
 * past_due or canceled. No scare colors, no countdown timer. State the
 * fact, point at the fix.
 */
import Link from 'next/link';
import { BODY, BODY_MUTED, GHOST_PILL } from '@/lib/typography';

export function PaywallBanner({
  slug,
  reason,
}: {
  slug: string;
  reason: 'past_due' | 'canceled';
}) {
  const headline =
    reason === 'past_due'
      ? 'A payment did not go through.'
      : 'Your subscription is canceled.';

  const subline =
    reason === 'past_due'
      ? 'Update your card to keep Charles working.'
      : 'Pick a plan to keep using Charles.';

  return (
    <div className="border-b border-border bg-muted/40">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-2.5">
        <div className="min-w-0">
          <p className={BODY}>{headline}</p>
          <p className={BODY_MUTED}>{subline}</p>
        </div>
        <Link href={`/s/${slug}/settings/billing`} className={GHOST_PILL}>
          Resolve billing
        </Link>
      </div>
    </div>
  );
}
