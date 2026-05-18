/**
 * Charles platform billing — Stripe helpers.
 *
 * "Platform billing" = Charles charging the founder for using Charles.
 * Distinct from `lib/integrations/adapters/stripe.ts`, which talks to the
 * FOUNDER's Stripe account (read-only adapter, Phase 2). Do not confuse
 * the two; they share a vendor but nothing else.
 *
 * No throw at module load if STRIPE_SECRET_KEY is unset — we want dev runs
 * without billing configured to still boot. The helpers below return a
 * thrown Error string the route can translate into 500 + friendly copy.
 */
import Stripe from 'stripe';
import { supabase } from '@/lib/supabase';
import { PLANS, type PlanSlug } from '@/lib/billing/plans';

let _stripe: Stripe | undefined;

/** Lazy singleton. Throws only when called; safe to import. */
export function getPlatformStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  _stripe = new Stripe(key, { apiVersion: '2024-06-20' as Stripe.LatestApiVersion });
  return _stripe;
}

/** Used in tests to reset the singleton. */
export function _resetPlatformStripe() {
  _stripe = undefined;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
}

/**
 * Look up the Space's Stripe customer; create + persist if missing.
 * Concurrency: if two requests race we may make two customers; the loser
 * is abandoned. Stripe doesn't bill until a subscription attaches, so this
 * is harmless and the simpler than a row lock.
 */
export async function createOrGetCustomer(
  spaceId: string,
  email: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('Space')
    .select('stripeCustomerId, name, slug')
    .eq('id', spaceId)
    .single();
  if (error) throw new Error(`Space lookup failed: ${error.message}`);
  if (data?.stripeCustomerId) return data.stripeCustomerId as string;

  const stripe = getPlatformStripe();
  const customer = await stripe.customers.create({
    email,
    metadata: { spaceId, slug: data?.slug ?? '' },
  });

  const { error: updateErr } = await supabase
    .from('Space')
    .update({ stripeCustomerId: customer.id })
    .eq('id', spaceId);
  if (updateErr) throw new Error(`Persist customer failed: ${updateErr.message}`);

  return customer.id;
}

/** Returns the Stripe-hosted checkout URL. Throws on bad plan / no price. */
export async function createCheckoutSession(
  spaceId: string,
  planSlug: PlanSlug,
): Promise<string> {
  const plan = PLANS[planSlug];
  if (!plan) throw new Error(`Unknown plan: ${planSlug}`);
  if (planSlug === 'free') throw new Error('Cannot check out the free plan');
  if (!plan.stripePriceId) {
    throw new Error(`Plan ${planSlug} has no Stripe price configured`);
  }

  const { data: space, error } = await supabase
    .from('Space')
    .select('id, slug, ownerId, stripeCustomerId')
    .eq('id', spaceId)
    .single();
  if (error || !space) throw new Error('Space not found');

  let customerId = space.stripeCustomerId as string | null;
  if (!customerId) {
    const { data: owner } = await supabase
      .from('User')
      .select('email')
      .eq('id', space.ownerId)
      .single();
    customerId = await createOrGetCustomer(spaceId, owner?.email ?? '');
  }

  const stripe = getPlatformStripe();
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: `${appUrl()}/s/${space.slug}/settings/billing?status=success`,
    cancel_url: `${appUrl()}/s/${space.slug}/settings/billing?status=canceled`,
    metadata: { spaceId, planSlug },
    subscription_data: { metadata: { spaceId, planSlug } },
  });

  if (!session.url) throw new Error('Stripe returned no checkout URL');
  return session.url;
}

/** Returns the billing portal URL. Throws if no customer on file. */
export async function createBillingPortalSession(spaceId: string): Promise<string> {
  const { data: space, error } = await supabase
    .from('Space')
    .select('slug, stripeCustomerId')
    .eq('id', spaceId)
    .single();
  if (error || !space) throw new Error('Space not found');
  if (!space.stripeCustomerId) throw new Error('No billing customer on file');

  const stripe = getPlatformStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: space.stripeCustomerId as string,
    return_url: `${appUrl()}/s/${space.slug}/settings/billing`,
  });
  return session.url;
}

export type SubscriptionStatusValue =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'none';

export interface SpaceSubscriptionStatus {
  planSlug: PlanSlug;
  status: SubscriptionStatusValue;
  periodEnd: string | null;
  seatLimit: number;
}

/**
 * Read sub status straight off the Space columns. No round-trip to Stripe —
 * the webhook keeps the columns warm, and rendering shouldn't depend on a
 * remote call. If there's no subscription yet, plan is 'free' and status
 * is 'none'.
 */
export async function getSubscriptionStatus(
  spaceId: string,
): Promise<SpaceSubscriptionStatus> {
  const { data, error } = await supabase
    .from('Space')
    .select('stripeSubscriptionId, stripeSubscriptionStatus, stripePeriodEnd')
    .eq('id', spaceId)
    .single();
  if (error || !data) {
    return { planSlug: 'free', status: 'none', periodEnd: null, seatLimit: PLANS.free.seatLimit };
  }

  if (!data.stripeSubscriptionId) {
    return { planSlug: 'free', status: 'none', periodEnd: null, seatLimit: PLANS.free.seatLimit };
  }

  // We don't store the priceId on Space, so without a hit on the sub we
  // can't reverse to plan slug from the DB alone. The webhook stores the
  // plan via the subscription metadata; for now we infer 'founder' as the
  // default paid tier when we know a sub exists but can't identify it.
  // Future work: persist priceId or planSlug on Space.
  const rawStatus = (data.stripeSubscriptionStatus ?? 'none') as string;
  const status: SubscriptionStatusValue =
    rawStatus === 'inactive' || !rawStatus ? 'none' : (rawStatus as SubscriptionStatusValue);

  // Default paid plan when sub exists; webhook may improve this once we
  // start writing a planSlug column. Seat limit reflects best-known plan.
  const planSlug: PlanSlug = 'founder';

  return {
    planSlug,
    status,
    periodEnd: (data.stripePeriodEnd as string | null) ?? null,
    seatLimit: PLANS[planSlug].seatLimit,
  };
}
