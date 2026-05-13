/**
 * POST /api/webhooks/stripe-platform — signature gate + event handlers.
 *
 * The Stripe SDK is mocked so we can control constructEvent precisely.
 * Supabase is mocked to a recording fake — we assert which row got
 * which update on each event.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { constructEventMock } = vi.hoisted(() => ({
  constructEventMock: vi.fn(),
}));

vi.mock('@/lib/billing/stripe-platform', () => ({
  getPlatformStripe: () => ({
    webhooks: { constructEvent: constructEventMock },
  }),
}));

const { recordedUpdates } = vi.hoisted(() => ({
  recordedUpdates: [] as Array<{
    table: string;
    update: Record<string, unknown>;
    whereCol: string;
    whereVal: unknown;
  }>,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      update: (update: Record<string, unknown>) => ({
        eq: async (col: string, val: unknown) => {
          recordedUpdates.push({ table, update, whereCol: col, whereVal: val });
          return { error: null };
        },
      }),
    }),
  },
}));

import { POST } from '@/app/api/webhooks/stripe-platform/route';

function req(body: string, sig: string | null = 'sig_test') {
  const headers = new Headers();
  if (sig !== null) headers.set('stripe-signature', sig);
  return new Request('http://localhost/api/webhooks/stripe-platform', {
    method: 'POST',
    headers,
    body,
  }) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  recordedUpdates.length = 0;
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
});

describe('POST /api/webhooks/stripe-platform — signature gate', () => {
  it('returns 400 when stripe-signature header is missing', async () => {
    const res = await POST(req('{}', null));
    expect(res.status).toBe(400);
    expect(constructEventMock).not.toHaveBeenCalled();
  });

  it('returns 400 when STRIPE_WEBHOOK_SECRET is unset', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await POST(req('{}'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when constructEvent throws (bad signature)', async () => {
    constructEventMock.mockImplementation(() => {
      throw new Error('bad sig');
    });
    const res = await POST(req('{}'));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/webhooks/stripe-platform — checkout.session.completed', () => {
  it('persists subscription id, customer id, and status=active', async () => {
    constructEventMock.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          metadata: { spaceId: 'space_1', planSlug: 'founder' },
          subscription: 'sub_123',
          customer: 'cus_123',
        },
      },
    });
    const res = await POST(req('{}'));
    expect(res.status).toBe(200);
    expect(recordedUpdates).toHaveLength(1);
    expect(recordedUpdates[0].table).toBe('Space');
    expect(recordedUpdates[0].whereCol).toBe('id');
    expect(recordedUpdates[0].whereVal).toBe('space_1');
    expect(recordedUpdates[0].update).toMatchObject({
      stripeSubscriptionId: 'sub_123',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionStatus: 'active',
    });
  });

  it('no-op when spaceId metadata is missing (don\'t write a half-row)', async () => {
    constructEventMock.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: { metadata: {}, subscription: 'sub_123', customer: 'cus_123' } },
    });
    const res = await POST(req('{}'));
    expect(res.status).toBe(200);
    expect(recordedUpdates).toHaveLength(0);
  });
});

describe('POST /api/webhooks/stripe-platform — customer.subscription.updated', () => {
  it('updates status and periodEnd by spaceId metadata', async () => {
    constructEventMock.mockReturnValue({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_123',
          status: 'active',
          metadata: { spaceId: 'space_1' },
          items: { data: [{ current_period_end: 1900000000 }] },
        },
      },
    });
    const res = await POST(req('{}'));
    expect(res.status).toBe(200);
    expect(recordedUpdates).toHaveLength(1);
    expect(recordedUpdates[0].whereCol).toBe('id');
    expect(recordedUpdates[0].update.stripeSubscriptionStatus).toBe('active');
    expect(recordedUpdates[0].update.stripePeriodEnd).toBe(
      new Date(1900000000 * 1000).toISOString(),
    );
  });

  it('falls back to subscription id when spaceId metadata is missing', async () => {
    constructEventMock.mockReturnValue({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_999',
          status: 'past_due',
          metadata: {},
          items: { data: [{ current_period_end: 1900000000 }] },
        },
      },
    });
    const res = await POST(req('{}'));
    expect(res.status).toBe(200);
    expect(recordedUpdates[0].whereCol).toBe('stripeSubscriptionId');
    expect(recordedUpdates[0].whereVal).toBe('sub_999');
    expect(recordedUpdates[0].update.stripeSubscriptionStatus).toBe('past_due');
  });
});

describe('POST /api/webhooks/stripe-platform — customer.subscription.deleted', () => {
  it('marks status as canceled', async () => {
    constructEventMock.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_123', metadata: { spaceId: 'space_1' } } },
    });
    const res = await POST(req('{}'));
    expect(res.status).toBe(200);
    expect(recordedUpdates[0].update).toEqual({ stripeSubscriptionStatus: 'canceled' });
    expect(recordedUpdates[0].whereVal).toBe('space_1');
  });

  it('falls back to subscription id when no spaceId metadata', async () => {
    constructEventMock.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_555', metadata: {} } },
    });
    const res = await POST(req('{}'));
    expect(res.status).toBe(200);
    expect(recordedUpdates[0].whereCol).toBe('stripeSubscriptionId');
    expect(recordedUpdates[0].whereVal).toBe('sub_555');
  });
});

describe('POST /api/webhooks/stripe-platform — invoice.payment_failed', () => {
  it('marks the matching subscription past_due', async () => {
    constructEventMock.mockReturnValue({
      type: 'invoice.payment_failed',
      data: { object: { subscription: 'sub_pf' } },
    });
    const res = await POST(req('{}'));
    expect(res.status).toBe(200);
    expect(recordedUpdates[0].whereCol).toBe('stripeSubscriptionId');
    expect(recordedUpdates[0].whereVal).toBe('sub_pf');
    expect(recordedUpdates[0].update.stripeSubscriptionStatus).toBe('past_due');
  });

  it('no-op when invoice has no linked subscription', async () => {
    constructEventMock.mockReturnValue({
      type: 'invoice.payment_failed',
      data: { object: {} },
    });
    const res = await POST(req('{}'));
    expect(res.status).toBe(200);
    expect(recordedUpdates).toHaveLength(0);
  });
});

describe('POST /api/webhooks/stripe-platform — unhandled events', () => {
  it('returns 200 without writing anything', async () => {
    constructEventMock.mockReturnValue({
      type: 'price.created',
      data: { object: {} },
    });
    const res = await POST(req('{}'));
    expect(res.status).toBe(200);
    expect(recordedUpdates).toHaveLength(0);
  });
});
