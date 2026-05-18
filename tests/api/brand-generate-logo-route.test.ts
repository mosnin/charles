/**
 * Route tests for POST /api/brand/generate-logo.
 *
 * Locks down: auth gate, body validation, rate cap (3 / hour / space), and
 * graceful 502 when the image adapter throws.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/space', () => ({
  getSpaceForUser: vi.fn(),
}));

vi.mock('@/lib/integrations/adapters/openai-images', () => ({
  openaiGenerateImage: vi.fn(),
}));

import { POST } from '@/app/api/brand/generate-logo/route';
import { __resetBuckets } from '@/app/api/brand/generate-logo/_buckets';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { openaiGenerateImage } from '@/lib/integrations/adapters/openai-images';

const mockAuth = vi.mocked(requireAuth);
const mockGetSpace = vi.mocked(getSpaceForUser);
const mockGen = vi.mocked(openaiGenerateImage);

const SPACE = {
  id: 'space_1',
  slug: 'jane',
  name: 'Jane Co',
  emoji: null,
  ownerId: 'user_db_1',
  brokerageId: null,
  createdAt: '2026-04-01T00:00:00.000Z',
} as unknown as NonNullable<Awaited<ReturnType<typeof getSpaceForUser>>>;

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/brand/generate-logo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetBuckets();
  mockAuth.mockResolvedValue({ userId: 'user_clerk_1' });
  mockGetSpace.mockResolvedValue(SPACE);
  mockGen.mockResolvedValue({ urls: ['https://img/logo.png'] });
});

describe('POST /api/brand/generate-logo', () => {
  it('401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await POST(makeReq({ prompt: 'hi' }) as never);
    expect(res.status).toBe(401);
    expect(mockGen).not.toHaveBeenCalled();
  });

  it('400 when body is not JSON', async () => {
    const res = await POST(makeReq('{nope') as never);
    expect(res.status).toBe(400);
  });

  it('400 when prompt is missing', async () => {
    const res = await POST(makeReq({}) as never);
    expect(res.status).toBe(400);
  });

  it('400 when prompt is empty', async () => {
    const res = await POST(makeReq({ prompt: '   ' }) as never);
    expect(res.status).toBe(400);
  });

  it('400 when prompt is too long', async () => {
    const res = await POST(makeReq({ prompt: 'x'.repeat(2001) }) as never);
    expect(res.status).toBe(400);
  });

  it('403 when caller has no workspace', async () => {
    mockGetSpace.mockResolvedValue(null);
    const res = await POST(makeReq({ prompt: 'hi' }) as never);
    expect(res.status).toBe(403);
    expect(mockGen).not.toHaveBeenCalled();
  });

  it('200 returns the URL from the adapter', async () => {
    const res = await POST(makeReq({ prompt: 'A minimal mark.' }) as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.url).toBe('https://img/logo.png');
    expect(mockGen).toHaveBeenCalledWith(SPACE.id, {
      prompt: 'A minimal mark.',
      size: '1024x1024',
      n: 1,
    });
  });

  it('429 after 3 generations in the same hour', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await POST(makeReq({ prompt: 'x' }) as never);
      expect(res.status).toBe(200);
    }
    const fourth = await POST(makeReq({ prompt: 'x' }) as never);
    expect(fourth.status).toBe(429);
    const data = await fourth.json();
    expect(data.error).toMatch(/Too many generations/);
    // Only the first 3 were forwarded
    expect(mockGen).toHaveBeenCalledTimes(3);
  });

  it('counts caps per-space (a different space gets its own bucket)', async () => {
    for (let i = 0; i < 3; i++) {
      await POST(makeReq({ prompt: 'x' }) as never);
    }
    mockGetSpace.mockResolvedValue({ ...SPACE, id: 'space_2' });
    const res = await POST(makeReq({ prompt: 'x' }) as never);
    expect(res.status).toBe(200);
  });

  it('502 when the image adapter throws', async () => {
    mockGen.mockRejectedValueOnce(new Error('OpenAI generateImage failed: 500'));
    const res = await POST(makeReq({ prompt: 'hi' }) as never);
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toMatch(/OpenAI|generate|failed/i);
  });

  it('502 when the adapter returns no urls', async () => {
    mockGen.mockResolvedValueOnce({ urls: [] });
    const res = await POST(makeReq({ prompt: 'hi' }) as never);
    expect(res.status).toBe(502);
  });
});
