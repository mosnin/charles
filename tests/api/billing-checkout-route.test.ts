/**
 * POST /api/billing/checkout — auth gate, plan validation, happy path,
 * error surface. Stripe + Supabase mocked end to end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(async () => ({ userId: 'user_clerk_1' })),
}));

vi.mock('@/lib/space', () => ({
  getSpaceForUser: vi.fn(async () => ({
    id: 'space_1',
    slug: 'jane',
    name: 'Jane',
    ownerId: 'u_1',
  })),
}));

const { createCheckoutMock } = vi.hoisted(() => ({
  createCheckoutMock: vi.fn(),
}));

vi.mock('@/lib/billing/stripe-platform', () => ({
  createCheckoutSession: createCheckoutMock,
}));

import { POST } from '@/app/api/billing/checkout/route';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';

const mockAuth = vi.mocked(requireAuth);
const mockSpace = vi.mocked(getSpaceForUser);

function req(body: unknown) {
  return new Request('http://localhost/api/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: 'user_clerk_1' });
  mockSpace.mockResolvedValue({
    id: 'space_1',
    slug: 'jane',
    name: 'Jane',
    emoji: '',
    ownerId: 'u_1',
    brokerageId: null,
    createdAt: new Date('2026-04-01'),
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeSubscriptionStatus: 'inactive',
    stripePeriodEnd: null,
  } as any);
  createCheckoutMock.mockResolvedValue('https://checkout.stripe.com/test_session_123');
});

describe('POST /api/billing/checkout', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await POST(req({ planSlug: 'founder' }));
    expect(res.status).toBe(401);
    expect(createCheckoutMock).not.toHaveBeenCalled();
  });

  it('returns 403 when the user has no workspace', async () => {
    mockSpace.mockResolvedValue(null);
    const res = await POST(req({ planSlug: 'founder' }));
    expect(res.status).toBe(403);
    expect(createCheckoutMock).not.toHaveBeenCalled();
  });

  it('returns 400 when planSlug is missing', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(createCheckoutMock).not.toHaveBeenCalled();
  });

  it('returns 400 when planSlug is unknown', async () => {
    const res = await POST(req({ planSlug: 'enterprise' }));
    expect(res.status).toBe(400);
    expect(createCheckoutMock).not.toHaveBeenCalled();
  });

  it('returns 400 when planSlug is "free" (not chargeable)', async () => {
    const res = await POST(req({ planSlug: 'free' }));
    expect(res.status).toBe(400);
    expect(createCheckoutMock).not.toHaveBeenCalled();
  });

  it('returns 200 with checkout url for founder plan', async () => {
    const res = await POST(req({ planSlug: 'founder' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe('https://checkout.stripe.com/test_session_123');
    expect(createCheckoutMock).toHaveBeenCalledWith('space_1', 'founder');
  });

  it('returns 200 with checkout url for team plan', async () => {
    createCheckoutMock.mockResolvedValue('https://checkout.stripe.com/team_session');
    const res = await POST(req({ planSlug: 'team' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe('https://checkout.stripe.com/team_session');
    expect(createCheckoutMock).toHaveBeenCalledWith('space_1', 'team');
  });

  it('returns 500 with a friendly error when Stripe blows up', async () => {
    createCheckoutMock.mockRejectedValue(new Error('Stripe down'));
    const res = await POST(req({ planSlug: 'founder' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    // Vendor error must not leak to the founder.
    expect(body.error).not.toContain('Stripe down');
  });
});
