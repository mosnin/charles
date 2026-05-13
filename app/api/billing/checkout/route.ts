/**
 * POST /api/billing/checkout
 *
 * Charles platform billing — creates a Stripe Checkout session for the
 * founder's workspace and returns the hosted URL. The client redirects
 * the browser to it.
 *
 * Body: { planSlug: 'founder' | 'team' }
 *
 * NOTE: This route replaces the legacy realtor checkout that lived here
 * before the pivot. Per AGENTS.md we rename legacy code toward Charles
 * rather than build alongside it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { PLANS, isPaidPlan, type PlanSlug } from '@/lib/billing/plans';
import { createCheckoutSession } from '@/lib/billing/stripe-platform';

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'No workspace' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const planSlug = body?.planSlug as PlanSlug | undefined;

  if (!planSlug || !(planSlug in PLANS)) {
    return NextResponse.json({ error: 'Unknown plan' }, { status: 400 });
  }
  if (!isPaidPlan(planSlug)) {
    return NextResponse.json({ error: 'The free plan does not require checkout' }, { status: 400 });
  }

  try {
    const url = await createCheckoutSession(space.id, planSlug);
    return NextResponse.json({ url });
  } catch (err: any) {
    console.error('[billing/checkout] failed:', err?.message);
    return NextResponse.json(
      { error: 'Checkout is unavailable right now. Try again in a moment.' },
      { status: 500 },
    );
  }
}
