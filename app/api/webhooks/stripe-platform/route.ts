/**
 * POST /api/webhooks/stripe-platform
 *
 * Stripe-signed webhook for CHARLES platform billing (our merchant
 * account). The companion `/api/webhooks/stripe` route handles the
 * legacy realtor billing and is unrelated.
 *
 * Never authenticated — the signature header is the credential. We MUST
 * read the raw body string for signature verification; never JSON-parse
 * before constructEvent.
 *
 * Events handled:
 *   checkout.session.completed   → write sub id + customer id + active
 *   customer.subscription.updated → update status + periodEnd
 *   customer.subscription.deleted → mark canceled
 *   invoice.payment_failed       → mark past_due
 *
 * Anything else → 200 (so Stripe doesn't retry forever).
 */
import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getPlatformStripe } from '@/lib/billing/stripe-platform';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

function periodEndFromSub(sub: Stripe.Subscription): string | null {
  const item = sub.items?.data?.[0];
  const ts =
    (item as { current_period_end?: number } | undefined)?.current_period_end ??
    (sub as { current_period_end?: number }).current_period_end ??
    null;
  return typeof ts === 'number' ? new Date(ts * 1000).toISOString() : null;
}

export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !secret) {
    return NextResponse.json({ error: 'Missing signature or secret' }, { status: 400 });
  }

  const payload = await req.text();

  let event: Stripe.Event;
  try {
    const stripe = getPlatformStripe();
    event = stripe.webhooks.constructEvent(payload, sig, secret);
  } catch (err: any) {
    console.error('[stripe-platform] bad signature:', err?.message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const spaceId = (session.metadata?.spaceId ?? '') as string;
        const subId = (typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id) ?? null;
        const customerId =
          (typeof session.customer === 'string'
            ? session.customer
            : session.customer?.id) ?? null;
        if (spaceId && subId) {
          await supabase
            .from('Space')
            .update({
              stripeSubscriptionId: subId,
              stripeCustomerId: customerId,
              stripeSubscriptionStatus: 'active',
            })
            .eq('id', spaceId);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const spaceId = (sub.metadata?.spaceId ?? '') as string;
        const status = sub.status as string;
        const periodEnd = periodEndFromSub(sub);
        const update: Record<string, unknown> = {
          stripeSubscriptionStatus: status,
          stripePeriodEnd: periodEnd,
        };
        if (spaceId) {
          await supabase.from('Space').update(update).eq('id', spaceId);
        } else {
          await supabase
            .from('Space')
            .update(update)
            .eq('stripeSubscriptionId', sub.id);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const spaceId = (sub.metadata?.spaceId ?? '') as string;
        const update = { stripeSubscriptionStatus: 'canceled' as const };
        if (spaceId) {
          await supabase.from('Space').update(update).eq('id', spaceId);
        } else {
          await supabase
            .from('Space')
            .update(update)
            .eq('stripeSubscriptionId', sub.id);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice & {
          subscription?: string | Stripe.Subscription | null;
        };
        const subId =
          typeof invoice.subscription === 'string'
            ? invoice.subscription
            : invoice.subscription?.id ?? null;
        if (subId) {
          await supabase
            .from('Space')
            .update({ stripeSubscriptionStatus: 'past_due' })
            .eq('stripeSubscriptionId', subId);
        }
        break;
      }

      default:
        // Unhandled event types are normal — Stripe sends many. 200 it.
        break;
    }
  } catch (err: any) {
    console.error('[stripe-platform] handler failed:', event.type, err?.message);
    // Return 200 anyway: failing the webhook causes Stripe to retry, and
    // for many DB errors the retry won't help. We've logged the failure.
    return NextResponse.json({ received: true, warning: 'handler error' });
  }

  return NextResponse.json({ received: true });
}
