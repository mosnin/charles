/**
 * Billing settings — Charles platform billing.
 *
 * One page. Top: the current plan, next renewal date, "Manage billing".
 * Below: three plan cards. No annual toggle, no discounts shouted in
 * orange. Calm and honest.
 */
import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug } from '@/lib/space';
import { getSubscriptionStatus } from '@/lib/billing/stripe-platform';
import { PLANS, type PlanSlug } from '@/lib/billing/plans';
import { PlanCard } from './plan-card';
import { ManageBillingButton } from './manage-button';
import {
  H1,
  H2,
  TITLE_FONT,
  BODY,
  BODY_MUTED,
  SECTION_LABEL,
  SECTION_RHYTHM,
  READING_MAX,
} from '@/lib/typography';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function statusLabel(status: string): string {
  switch (status) {
    case 'active':
      return 'Active.';
    case 'trialing':
      return 'In trial.';
    case 'past_due':
      return 'Payment failed.';
    case 'canceled':
      return 'Canceled.';
    case 'unpaid':
      return 'Unpaid.';
    case 'none':
    default:
      return 'No plan yet.';
  }
}

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const status = await getSubscriptionStatus(space.id);
  const isPaid = status.status === 'active' || status.status === 'trialing';
  const currentPlanSlug: PlanSlug = isPaid ? status.planSlug : 'free';

  const checkoutFlash =
    sp.status === 'success'
      ? 'Your plan is set. Welcome aboard.'
      : sp.status === 'canceled'
        ? 'Checkout canceled. No charge.'
        : null;

  return (
    <div className={`${SECTION_RHYTHM} ${READING_MAX}`}>
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Settings / Billing.</p>
        <h1 className={H1} style={TITLE_FONT}>
          Billing
        </h1>
        <p className={BODY_MUTED}>
          {statusLabel(status.status)}
          {status.periodEnd && isPaid && (
            <> Next renewal {formatDate(status.periodEnd)}.</>
          )}
        </p>
        {checkoutFlash && (
          <p className={`${BODY} pt-2`}>{checkoutFlash}</p>
        )}
      </header>

      <section className="space-y-5 pt-4">
        <p className={SECTION_LABEL}>Manage</p>
        <div className="flex items-center justify-between gap-6 rounded-2xl border border-border p-5">
          <div className="min-w-0">
            <p className={BODY}>
              Current plan: <span className="font-medium">{PLANS[currentPlanSlug].name}</span>
            </p>
            <p className={BODY_MUTED}>
              Open the Stripe portal to update card, cancel, or download invoices.
            </p>
          </div>
          <ManageBillingButton disabled={status.status === 'none'} />
        </div>
      </section>

      <section className="space-y-5 pt-10 border-t border-border/60">
        <p className={SECTION_LABEL}>Plans</p>
        <h2 className={H2}>Choose what fits.</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {(['free', 'founder', 'team'] as PlanSlug[]).map((slug) => (
            <PlanCard
              key={slug}
              plan={PLANS[slug]}
              isCurrent={slug === currentPlanSlug}
            />
          ))}
        </div>
        <p className={BODY_MUTED}>
          Prices in USD. Cancel anytime from the Stripe portal.
        </p>
      </section>
    </div>
  );
}
