/**
 * Stripe adapter tests — auth resolution, happy path, error propagation.
 *
 * Charge / refund / subscription mutations are intentionally not covered
 * because the adapter does not implement them. If they ever appear, they
 * need their own approval-gate tests before this file grows to match.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { maybeSingleMock } = vi.hoisted(() => ({
  maybeSingleMock: vi.fn<() => Promise<{ data: unknown; error: null }>>(),
}));

vi.mock('@/lib/supabase', () => {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: maybeSingleMock,
  };
  return { supabase: { from: vi.fn(() => chain) } };
});

import {
  stripeGetBalance,
  stripeListSubscriptions,
  stripeListRecentCharges,
  stripeGetRevenueSummary,
} from '@/lib/integrations/adapters/stripe';

const fetchMock = vi.fn<typeof fetch>();
global.fetch = fetchMock as unknown as typeof fetch;

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ORIG_KEY = process.env.STRIPE_SECRET_KEY;

beforeEach(() => {
  fetchMock.mockReset();
  maybeSingleMock.mockReset();
  maybeSingleMock.mockResolvedValue({ data: null, error: null });
  delete process.env.STRIPE_SECRET_KEY;
});

afterEach(() => {
  if (ORIG_KEY === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = ORIG_KEY;
});

describe('Stripe adapter — auth resolution', () => {
  it('uses the IntegrationConnection accessToken when present', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { accessToken: 'sk_test_from_db' },
      error: null,
    });
    fetchMock.mockResolvedValue(jsonRes({ available: [], pending: [] }));

    await stripeGetBalance('space_1');

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk_test_from_db');
  });

  it('falls back to STRIPE_SECRET_KEY env when no DB row', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_env';
    fetchMock.mockResolvedValue(jsonRes({ available: [], pending: [] }));

    await stripeGetBalance('space_1');

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk_test_env');
  });

  it('throws when neither DB row nor env var is set', async () => {
    await expect(stripeGetBalance('space_1')).rejects.toThrow(/no API key/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Stripe adapter — happy paths', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test';
  });

  it('getBalance returns parsed available + pending', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({
        available: [{ amount: 1234, currency: 'usd' }],
        pending: [{ amount: 56, currency: 'usd' }],
      }),
    );
    const r = await stripeGetBalance('s');
    expect(r.available[0]).toEqual({ amount: 1234, currency: 'usd' });
    expect(r.pending[0]).toEqual({ amount: 56, currency: 'usd' });
  });

  it('listSubscriptions parses items + price + interval', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({
        data: [
          {
            id: 'sub_1',
            customer: 'cus_1',
            status: 'active',
            items: {
              data: [
                {
                  price: { unit_amount: 5000, currency: 'usd', recurring: { interval: 'month' } },
                  quantity: 1,
                },
              ],
            },
          },
        ],
      }),
    );
    const r = await stripeListSubscriptions('s');
    expect(r).toEqual([
      {
        id: 'sub_1',
        customer: 'cus_1',
        status: 'active',
        amount: 5000,
        currency: 'usd',
        interval: 'month',
      },
    ]);
    expect(fetchMock.mock.calls[0]![0]).toContain('status=active');
  });

  it('listRecentCharges returns mapped charges', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({
        data: [
          { id: 'ch_1', amount: 999, currency: 'usd', status: 'succeeded', customer: 'cus_1', created: 1 },
        ],
      }),
    );
    const r = await stripeListRecentCharges('s');
    expect(r[0]!.id).toBe('ch_1');
    expect(r[0]!.status).toBe('succeeded');
  });

  it('getRevenueSummary computes MRR and 30d revenue', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonRes({
          data: [
            {
              items: {
                data: [
                  { price: { unit_amount: 10000, currency: 'usd', recurring: { interval: 'month' } }, quantity: 1 },
                ],
              },
            },
            {
              items: {
                data: [
                  { price: { unit_amount: 120000, currency: 'usd', recurring: { interval: 'year' } }, quantity: 1 },
                ],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonRes({
          data: [
            { amount: 5000, currency: 'usd', status: 'succeeded' },
            { amount: 1, currency: 'usd', status: 'failed' },
          ],
        }),
      );

    const r = await stripeGetRevenueSummary('s');
    expect(r.activeSubscriptions).toBe(2);
    // 10000/mo + 120000/12 = 20000
    expect(r.mrrByCurrency.usd).toBe(20000);
    expect(r.last30dRevenueByCurrency.usd).toBe(5000);
  });
});

describe('Stripe adapter — error handling', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test';
  });

  it('throws with status + Stripe error message on non-2xx', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({ error: { message: 'Invalid API Key provided' } }, 401),
    );
    await expect(stripeGetBalance('s')).rejects.toThrow(/401.*Invalid API Key/);
  });
});
