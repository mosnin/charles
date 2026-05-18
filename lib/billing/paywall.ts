/**
 * Charles platform paywall — used in the workspace layout to decide whether
 * to surface a billing banner. We do NOT hard-lock routes yet — Phase 5
 * goal is to make the bill visible. Hard-lock can come in a future phase
 * once the billing UX has been tested with real founders.
 */
import { getSubscriptionStatus, type SpaceSubscriptionStatus } from '@/lib/billing/stripe-platform';

export type PaywallReason = 'no_subscription' | 'past_due' | 'canceled' | null;

export interface PaywallResult {
  allowed: boolean;
  reason: PaywallReason;
  status: SpaceSubscriptionStatus;
}

export async function checkPaywall(spaceId: string): Promise<PaywallResult> {
  const status = await getSubscriptionStatus(spaceId);

  // TODO: tighten when paywall is announced to founders; currently lets ungated spaces through to avoid breaking dev/test
  if (status.status === 'none') {
    return { allowed: true, reason: null, status };
  }

  if (status.status === 'active' || status.status === 'trialing') {
    return { allowed: true, reason: null, status };
  }

  if (status.status === 'past_due' || status.status === 'unpaid') {
    return { allowed: false, reason: 'past_due', status };
  }

  if (status.status === 'canceled') {
    return { allowed: false, reason: 'canceled', status };
  }

  return { allowed: true, reason: null, status };
}
