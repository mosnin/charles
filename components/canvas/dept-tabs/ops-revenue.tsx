/**
 * Ops/Finance › Revenue — Stripe rollup.
 *
 * Active subs, MRR, last 30 days revenue. Defensive: if Stripe isn't
 * connected (or the call fails) we fall back to a connect-CTA card.
 */

import { stripeGetRevenueSummary } from '@/lib/integrations/adapters/stripe';
import {
  CAPTION,
  SECTION_LABEL,
  STAT_NUMBER_COMPACT,
  TITLE_FONT,
} from '@/lib/typography';
import { EmptyState } from './empty-state';

interface Props {
  spaceId: string;
  spaceSlug: string;
}

function fmtMoney(amountInMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      maximumFractionDigits: 0,
    }).format(amountInMinor / 100);
  } catch {
    return `${(amountInMinor / 100).toFixed(0)} ${currency.toUpperCase()}`;
  }
}

function primaryCurrency(by: Record<string, number>): string {
  const entries = Object.entries(by);
  if (entries.length === 0) return 'usd';
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

export async function OpsRevenue({ spaceId, spaceSlug }: Props) {
  let summary;
  try {
    summary = await stripeGetRevenueSummary(spaceId);
  } catch {
    return (
      <EmptyState
        title="Connect Stripe to see revenue and MRR."
        cta={{ label: 'Open integrations', href: `/s/${spaceSlug}/integrations` }}
      />
    );
  }

  const cur = primaryCurrency({
    ...summary.mrrByCurrency,
    ...summary.last30dRevenueByCurrency,
  });
  const mrr = summary.mrrByCurrency[cur] ?? 0;
  const rev30 = summary.last30dRevenueByCurrency[cur] ?? 0;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white px-6 py-5 space-y-3">
      <p className={SECTION_LABEL}>Stripe</p>
      <div className="grid grid-cols-3 gap-x-8 gap-y-4">
        <div>
          <p className={STAT_NUMBER_COMPACT} style={TITLE_FONT}>
            {fmtMoney(mrr, cur)}
          </p>
          <p className={CAPTION}>MRR</p>
        </div>
        <div>
          <p className={STAT_NUMBER_COMPACT} style={TITLE_FONT}>
            {fmtMoney(rev30, cur)}
          </p>
          <p className={CAPTION}>Last 30 days</p>
        </div>
        <div>
          <p className={STAT_NUMBER_COMPACT} style={TITLE_FONT}>
            {summary.activeSubscriptions.toLocaleString('en-US')}
          </p>
          <p className={CAPTION}>Active subs</p>
        </div>
      </div>
    </section>
  );
}
