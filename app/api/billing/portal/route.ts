/**
 * POST /api/billing/portal
 *
 * Returns the Stripe Billing Portal URL for the founder's workspace.
 * 400 if no customer exists yet (they haven't paid at all).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { createBillingPortalSession } from '@/lib/billing/stripe-platform';

export async function POST(_req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'No workspace' }, { status: 403 });

  const { data, error } = await supabase
    .from('Space')
    .select('stripeCustomerId')
    .eq('id', space.id)
    .single();
  if (error) {
    return NextResponse.json({ error: 'Failed to load billing record' }, { status: 500 });
  }
  if (!data?.stripeCustomerId) {
    return NextResponse.json(
      { error: 'No billing account yet. Pick a plan first.' },
      { status: 400 },
    );
  }

  try {
    const url = await createBillingPortalSession(space.id);
    return NextResponse.json({ url });
  } catch (err: any) {
    console.error('[billing/portal] failed:', err?.message);
    return NextResponse.json(
      { error: 'The billing portal is unavailable right now.' },
      { status: 500 },
    );
  }
}
