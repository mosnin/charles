/**
 * Charles platform billing — plan catalog.
 *
 * Three tiers, no annual/monthly toggle, no enterprise tier. Pricing is the
 * default in USD/month; the Stripe price IDs are read from env vars so the
 * founder can tune the catalog without a code change. Free has no Stripe
 * price — its presence in DB is implicit (absence of stripeSubscriptionId).
 *
 * If env vars are missing, stripePriceId resolves to empty string instead of
 * throwing — other code paths (e.g. dev runs without billing configured)
 * must keep working. The checkout route is the only thing that needs to
 * fail loudly when the price is empty.
 */
export type PlanSlug = 'free' | 'founder' | 'team';

export interface Plan {
  slug: PlanSlug;
  name: string;
  blurb: string;
  priceUsdMonth: number;
  seatLimit: number;
  /** Empty string when not configured or when slug='free'. */
  stripePriceId: string;
}

function envPrice(name: string): string {
  return process.env[name] ?? '';
}

export const PLANS: Record<PlanSlug, Plan> = {
  free: {
    slug: 'free',
    name: 'Free',
    blurb: 'Read-only. See what Charles would do, but he holds his hands.',
    priceUsdMonth: 0,
    seatLimit: 1,
    stripePriceId: '',
  },
  founder: {
    slug: 'founder',
    name: 'Founder',
    blurb: 'One seat. Full access. Every department, every integration.',
    priceUsdMonth: 39,
    seatLimit: 1,
    get stripePriceId() {
      return envPrice('STRIPE_PRICE_FOUNDER');
    },
  },
  team: {
    slug: 'team',
    name: 'Team',
    blurb: 'Up to five seats. Same Charles, more hands at the table.',
    priceUsdMonth: 99,
    seatLimit: 5,
    get stripePriceId() {
      return envPrice('STRIPE_PRICE_TEAM');
    },
  },
};

/** Reverse lookup: Stripe price id → plan slug. Returns null on miss. */
export function planFromPriceId(priceId: string): PlanSlug | null {
  if (!priceId) return null;
  for (const plan of Object.values(PLANS)) {
    if (plan.stripePriceId && plan.stripePriceId === priceId) {
      return plan.slug;
    }
  }
  return null;
}

export function isPaidPlan(slug: PlanSlug): boolean {
  return slug !== 'free';
}
