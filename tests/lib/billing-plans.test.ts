/**
 * Plan catalog — shape, paid/free split, price-id roundtrip.
 *
 * The catalog is the contract every other billing code path reads from.
 * If a plan shape changes, this file should be the first thing to flinch.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PLANS, planFromPriceId, isPaidPlan } from '@/lib/billing/plans';

describe('PLANS catalog', () => {
  it('has exactly three plans: free, founder, team', () => {
    expect(Object.keys(PLANS).sort()).toEqual(['founder', 'free', 'team']);
  });

  it('each plan carries the required fields', () => {
    for (const plan of Object.values(PLANS)) {
      expect(plan.slug).toBeTruthy();
      expect(plan.name).toBeTruthy();
      expect(plan.blurb).toBeTruthy();
      expect(typeof plan.priceUsdMonth).toBe('number');
      expect(typeof plan.seatLimit).toBe('number');
      expect(typeof plan.stripePriceId).toBe('string');
    }
  });

  it('free is $0, 1 seat, no Stripe price', () => {
    expect(PLANS.free.priceUsdMonth).toBe(0);
    expect(PLANS.free.seatLimit).toBe(1);
    expect(PLANS.free.stripePriceId).toBe('');
  });

  it('founder is paid, 1 seat', () => {
    expect(PLANS.founder.priceUsdMonth).toBeGreaterThan(0);
    expect(PLANS.founder.seatLimit).toBe(1);
  });

  it('team is paid, 5 seats', () => {
    expect(PLANS.team.priceUsdMonth).toBeGreaterThan(0);
    expect(PLANS.team.seatLimit).toBe(5);
  });

  it('team is priced above founder', () => {
    expect(PLANS.team.priceUsdMonth).toBeGreaterThan(PLANS.founder.priceUsdMonth);
  });
});

describe('isPaidPlan', () => {
  it('free is not paid', () => {
    expect(isPaidPlan('free')).toBe(false);
  });

  it('founder is paid', () => {
    expect(isPaidPlan('founder')).toBe(true);
  });

  it('team is paid', () => {
    expect(isPaidPlan('team')).toBe(true);
  });
});

describe('planFromPriceId', () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    process.env.STRIPE_PRICE_FOUNDER = 'price_F_TEST';
    process.env.STRIPE_PRICE_TEAM = 'price_T_TEST';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it('resolves the founder price id to the founder slug', () => {
    expect(planFromPriceId('price_F_TEST')).toBe('founder');
  });

  it('resolves the team price id to the team slug', () => {
    expect(planFromPriceId('price_T_TEST')).toBe('team');
  });

  it('returns null on an unknown price id', () => {
    expect(planFromPriceId('price_made_up')).toBeNull();
  });

  it('returns null on empty string (never matches the free plan)', () => {
    expect(planFromPriceId('')).toBeNull();
  });

  it('does not throw when env vars are missing — just returns null', () => {
    delete process.env.STRIPE_PRICE_FOUNDER;
    delete process.env.STRIPE_PRICE_TEAM;
    expect(planFromPriceId('price_F_TEST')).toBeNull();
  });
});
