/**
 * Thin Stripe REST API adapter — read-only.
 *
 * Charge / refund / subscription mutations are deliberately absent. Money
 * movement belongs behind a separate, gated flow; this adapter is for the
 * agent to *observe* (balance, subscriptions, recent charges, summary).
 *
 * Auth: IntegrationConnection (toolkit='stripe', status='active') →
 * STRIPE_SECRET_KEY env. Throws when neither is set.
 */

import { supabase } from '@/lib/supabase';

const STRIPE_API = 'https://api.stripe.com/v1';

async function getStripeKey(spaceId: string): Promise<string> {
  const { data } = await supabase
    .from('IntegrationConnection')
    .select('accessToken')
    .eq('spaceId', spaceId)
    .eq('toolkit', 'stripe')
    .eq('status', 'active')
    .maybeSingle();

  const token = (data as { accessToken?: string } | null)?.accessToken;
  if (token) return token;

  const env = process.env.STRIPE_SECRET_KEY;
  if (env) return env;

  throw new Error(
    `Stripe: no API key found for space ${spaceId}. ` +
      `Connect Stripe in Settings → Integrations, or set STRIPE_SECRET_KEY.`,
  );
}

async function stripeFetch(
  key: string,
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<Response> {
  const url = new URL(`${STRIPE_API}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return fetch(url.toString(), {
    headers: { Authorization: `Bearer ${key}` },
  });
}

async function readOrThrow(res: Response, action: string): Promise<unknown> {
  if (!res.ok) {
    let body: { error?: { message?: string } } = {};
    try {
      body = (await res.json()) as { error?: { message?: string } };
    } catch {
      // ignore
    }
    const msg = body.error?.message ?? (await res.text().catch(() => ''));
    throw new Error(`Stripe ${action} failed: ${res.status} — ${msg}`);
  }
  return res.json();
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface BalanceEntry {
  amount: number;
  currency: string;
}

export interface BalanceResult {
  available: BalanceEntry[];
  pending: BalanceEntry[];
}

export interface SubscriptionSummary {
  id: string;
  customer: string | null;
  status: string;
  amount: number | null;
  currency: string | null;
  interval: string | null;
}

export interface ChargeSummary {
  id: string;
  amount: number;
  currency: string;
  status: string;
  customer: string | null;
  created: number;
}

export interface RevenueSummary {
  activeSubscriptions: number;
  mrrByCurrency: Record<string, number>;
  last30dRevenueByCurrency: Record<string, number>;
}

// ── Operations ───────────────────────────────────────────────────────────────

export async function stripeGetBalance(spaceId: string): Promise<BalanceResult> {
  const key = await getStripeKey(spaceId);
  const res = await stripeFetch(key, '/balance');
  const data = (await readOrThrow(res, 'getBalance')) as {
    available?: BalanceEntry[];
    pending?: BalanceEntry[];
  };
  return { available: data.available ?? [], pending: data.pending ?? [] };
}

export async function stripeListSubscriptions(
  spaceId: string,
  opts?: { limit?: number },
): Promise<SubscriptionSummary[]> {
  const key = await getStripeKey(spaceId);
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 100);
  const res = await stripeFetch(key, '/subscriptions', { status: 'active', limit });
  const data = (await readOrThrow(res, 'listSubscriptions')) as {
    data?: Array<Record<string, unknown>>;
  };
  return (data.data ?? []).map((s) => {
    const items = ((s.items as { data?: Array<Record<string, unknown>> } | undefined)?.data ?? [])[0] ?? {};
    const price = (items as { price?: Record<string, unknown> }).price ?? {};
    const recurring = (price as { recurring?: { interval?: string } }).recurring ?? {};
    return {
      id: s.id as string,
      customer: (s.customer as string | null) ?? null,
      status: s.status as string,
      amount: (price as { unit_amount?: number | null }).unit_amount ?? null,
      currency: (price as { currency?: string | null }).currency ?? null,
      interval: recurring.interval ?? null,
    };
  });
}

export async function stripeListRecentCharges(
  spaceId: string,
  opts?: { limit?: number },
): Promise<ChargeSummary[]> {
  const key = await getStripeKey(spaceId);
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 100);
  const res = await stripeFetch(key, '/charges', { limit });
  const data = (await readOrThrow(res, 'listRecentCharges')) as {
    data?: Array<Record<string, unknown>>;
  };
  return (data.data ?? []).map((c) => ({
    id: c.id as string,
    amount: (c.amount as number) ?? 0,
    currency: (c.currency as string) ?? 'usd',
    status: (c.status as string) ?? 'unknown',
    customer: (c.customer as string | null) ?? null,
    created: (c.created as number) ?? 0,
  }));
}

export async function stripeGetRevenueSummary(
  spaceId: string,
): Promise<RevenueSummary> {
  const key = await getStripeKey(spaceId);
  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 86_400;

  const [subRes, chargeRes] = await Promise.all([
    stripeFetch(key, '/subscriptions', { status: 'active', limit: 100 }),
    stripeFetch(key, '/charges', { limit: 100, 'created[gte]': thirtyDaysAgo }),
  ]);

  const subs = (await readOrThrow(subRes, 'revenueSummary subscriptions')) as {
    data?: Array<Record<string, unknown>>;
  };
  const charges = (await readOrThrow(chargeRes, 'revenueSummary charges')) as {
    data?: Array<Record<string, unknown>>;
  };

  const mrr: Record<string, number> = {};
  for (const s of subs.data ?? []) {
    const items = ((s.items as { data?: Array<Record<string, unknown>> } | undefined)?.data) ?? [];
    for (const item of items) {
      const price = (item.price as Record<string, unknown> | undefined) ?? {};
      const amount = (price.unit_amount as number | null) ?? 0;
      const currency = ((price.currency as string | null) ?? 'usd').toLowerCase();
      const interval = ((price.recurring as { interval?: string } | undefined)?.interval) ?? 'month';
      const qty = (item.quantity as number | undefined) ?? 1;
      const monthly =
        interval === 'year' ? Math.floor((amount * qty) / 12) : amount * qty;
      mrr[currency] = (mrr[currency] ?? 0) + monthly;
    }
  }

  const rev: Record<string, number> = {};
  for (const c of charges.data ?? []) {
    if ((c.status as string) === 'succeeded') {
      const cur = ((c.currency as string | null) ?? 'usd').toLowerCase();
      rev[cur] = (rev[cur] ?? 0) + ((c.amount as number) ?? 0);
    }
  }

  return {
    activeSubscriptions: (subs.data ?? []).length,
    mrrByCurrency: mrr,
    last30dRevenueByCurrency: rev,
  };
}
