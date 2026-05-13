/**
 * POST /api/billing/portal — auth, no-customer 400, happy path.
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
  })),
}));

const { stripeCustomerHolder, createPortalMock } = vi.hoisted(() => ({
  stripeCustomerHolder: { value: 'cus_123' as string | null },
  createPortalMock: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          single: async () => ({
            data: { stripeCustomerId: stripeCustomerHolder.value },
            error: null,
          }),
        }),
      }),
    }),
  },
}));

vi.mock('@/lib/billing/stripe-platform', () => ({
  createBillingPortalSession: createPortalMock,
}));

import { POST } from '@/app/api/billing/portal/route';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';

const mockAuth = vi.mocked(requireAuth);
const mockSpace = vi.mocked(getSpaceForUser);

function req() {
  return new Request('http://localhost/api/billing/portal', {
    method: 'POST',
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
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: null,
    stripeSubscriptionStatus: 'active',
    stripePeriodEnd: null,
  } as any);
  stripeCustomerHolder.value = 'cus_123';
  createPortalMock.mockResolvedValue('https://billing.stripe.com/portal_abc');
});

describe('POST /api/billing/portal', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(createPortalMock).not.toHaveBeenCalled();
  });

  it('returns 403 when the user has no workspace', async () => {
    mockSpace.mockResolvedValue(null);
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(createPortalMock).not.toHaveBeenCalled();
  });

  it('returns 400 when there is no Stripe customer on file yet', async () => {
    stripeCustomerHolder.value = null;
    const res = await POST(req());
    expect(res.status).toBe(400);
    expect(createPortalMock).not.toHaveBeenCalled();
  });

  it('returns 200 with the portal url on success', async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe('https://billing.stripe.com/portal_abc');
    expect(createPortalMock).toHaveBeenCalledWith('space_1');
  });

  it('returns 500 when Stripe portal call fails', async () => {
    createPortalMock.mockRejectedValue(new Error('boom'));
    const res = await POST(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toContain('boom');
  });
});
