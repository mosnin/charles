'use client';

/**
 * One plan card. Click → POST /api/billing/checkout → redirect to Stripe.
 * The "Current" pill is rendered server-side; this component owns nothing
 * but the action.
 */
import { useState } from 'react';
import type { Plan, PlanSlug } from '@/lib/billing/plans';
import { BODY, BODY_MUTED, H3, PRIMARY_PILL } from '@/lib/typography';

export function PlanCard({
  plan,
  isCurrent,
}: {
  plan: Plan;
  isCurrent: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose() {
    if (busy || plan.slug === 'free' || isCurrent) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planSlug: plan.slug as PlanSlug }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.url) {
        setError(body?.error ?? 'Could not start checkout.');
        setBusy(false);
        return;
      }
      window.location.href = body.url;
    } catch {
      setError('Could not start checkout.');
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border p-5 flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className={H3}>{plan.name}</h3>
        {isCurrent && (
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Current
          </span>
        )}
      </div>
      <p className={BODY_MUTED}>{plan.blurb}</p>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl tabular-nums">
          {plan.priceUsdMonth === 0 ? 'Free' : `$${plan.priceUsdMonth}`}
        </span>
        {plan.priceUsdMonth > 0 && <span className={BODY_MUTED}>/ month</span>}
      </div>
      <p className={BODY_MUTED}>
        {plan.seatLimit === 1 ? '1 seat' : `${plan.seatLimit} seats`}
      </p>
      <div className="pt-2">
        {plan.slug === 'free' ? (
          <p className={BODY_MUTED}>Read-only.</p>
        ) : isCurrent ? (
          <p className={BODY_MUTED}>Active plan.</p>
        ) : (
          <button onClick={choose} disabled={busy} className={PRIMARY_PILL}>
            {busy ? 'Opening Stripe…' : `Choose ${plan.name}`}
          </button>
        )}
        {error && <p className={`${BODY} text-destructive mt-2`}>{error}</p>}
      </div>
    </div>
  );
}
