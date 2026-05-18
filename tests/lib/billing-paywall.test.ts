/**
 * Paywall matrix — for each Stripe subscription status, what does the
 * banner decide?
 *
 * The contract: only past_due/unpaid/canceled produce allowed=false.
 * Ungated spaces (no sub yet) get through — see the TODO in paywall.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getStatusMock } = vi.hoisted(() => ({ getStatusMock: vi.fn() }));

vi.mock('@/lib/billing/stripe-platform', () => ({
  getSubscriptionStatus: getStatusMock,
}));

import { checkPaywall } from '@/lib/billing/paywall';

function status(s: string, planSlug: 'free' | 'founder' | 'team' = 'founder') {
  return {
    planSlug,
    status: s,
    periodEnd: null,
    seatLimit: 1,
  };
}

describe('checkPaywall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows when sub is active', async () => {
    getStatusMock.mockResolvedValue(status('active'));
    const r = await checkPaywall('space_1');
    expect(r.allowed).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('allows when sub is trialing', async () => {
    getStatusMock.mockResolvedValue(status('trialing'));
    const r = await checkPaywall('space_1');
    expect(r.allowed).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('blocks with past_due reason when sub is past_due', async () => {
    getStatusMock.mockResolvedValue(status('past_due'));
    const r = await checkPaywall('space_1');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('past_due');
  });

  it('blocks with past_due reason when sub is unpaid', async () => {
    getStatusMock.mockResolvedValue(status('unpaid'));
    const r = await checkPaywall('space_1');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('past_due');
  });

  it('blocks with canceled reason when sub is canceled', async () => {
    getStatusMock.mockResolvedValue(status('canceled'));
    const r = await checkPaywall('space_1');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('canceled');
  });

  it('lets ungated spaces (status=none) through — explicit TODO contract', async () => {
    getStatusMock.mockResolvedValue(status('none', 'free'));
    const r = await checkPaywall('space_1');
    expect(r.allowed).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('returns the full status object on every call (for downstream UI)', async () => {
    const s = status('active');
    getStatusMock.mockResolvedValue(s);
    const r = await checkPaywall('space_1');
    expect(r.status).toEqual(s);
  });
});
