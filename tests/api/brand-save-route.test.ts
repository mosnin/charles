/**
 * Route tests for POST /api/brand/save.
 *
 * Locks down: auth gate, body validation, workspace gate, and the actual
 * upsert into the Document table on (spaceId, slug='brand-kit') with the
 * canonical markdown content shape from the builder.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/space', () => ({
  getSpaceForUser: vi.fn(),
}));

const { upsertSpy } = vi.hoisted(() => ({
  upsertSpy: vi.fn(),
}));

vi.mock('@/lib/supabase', () => {
  function chain() {
    const obj: Record<string, unknown> = {};
    obj.upsert = vi.fn((payload: Record<string, unknown>, opts?: unknown) => {
      upsertSpy(payload, opts);
      const up: Record<string, unknown> = {};
      up.select = vi.fn(() => up);
      up.single = vi.fn(() =>
        Promise.resolve({
          data: { updatedAt: payload.updatedAt ?? new Date().toISOString() },
          error: null,
        }),
      );
      return up;
    });
    return obj;
  }
  return { supabase: { from: vi.fn(() => chain()) } };
});

import { POST } from '@/app/api/brand/save/route';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';

const mockAuth = vi.mocked(requireAuth);
const mockGetSpace = vi.mocked(getSpaceForUser);

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
  return new Request('http://localhost/api/brand/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function fullBody() {
  return {
    voice: { descriptors: ['Confident', 'Calm'], loved: 'We ship.', banned: 'We unleash.' },
    palette: {
      primary: '#0A0A0F',
      mood: 'editorial',
      neutrals: [
        { name: 'White', hex: '#ffffff' },
        { name: 'Black', hex: '#000000' },
      ],
    },
    typography: { preset: 'Editorial', heading: 'Tiempos Headline', body: 'Inter' },
    logo: { prompt: 'A minimal mark.' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  upsertSpy.mockClear();
  mockAuth.mockResolvedValue({ userId: 'user_clerk_1' });
  mockGetSpace.mockResolvedValue(SPACE);
});

describe('POST /api/brand/save', () => {
  it('401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await POST(makeReq(fullBody()) as never);
    expect(res.status).toBe(401);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('400 when body is not JSON', async () => {
    const res = await POST(makeReq('{not-json') as never);
    expect(res.status).toBe(400);
  });

  it('400 when voice descriptors are missing', async () => {
    const body = fullBody();
    body.voice = { descriptors: [], loved: '', banned: '' };
    const res = await POST(makeReq(body) as never);
    expect(res.status).toBe(400);
  });

  it('400 when palette primary is not a hex', async () => {
    const body = fullBody();
    body.palette.primary = 'red';
    const res = await POST(makeReq(body) as never);
    expect(res.status).toBe(400);
  });

  it('400 when mood is unknown', async () => {
    const body = fullBody();
    (body.palette as { mood: string }).mood = 'loud';
    const res = await POST(makeReq(body) as never);
    expect(res.status).toBe(400);
  });

  it('403 when caller has no workspace', async () => {
    mockGetSpace.mockResolvedValue(null);
    const res = await POST(makeReq(fullBody()) as never);
    expect(res.status).toBe(403);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('200 upserts the brand kit document with canonical markdown', async () => {
    const res = await POST(makeReq(fullBody()) as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.redirectTo).toBe('/s/jane/documents/brand-kit?mode=edit');
    expect(data.updatedAt).toBeTruthy();

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const [payload, opts] = upsertSpy.mock.calls[0];
    const p = payload as Record<string, unknown>;
    expect(p.spaceId).toBe(SPACE.id);
    expect(p.slug).toBe('brand-kit');
    expect(p.title).toBe('Brand kit');
    expect(typeof p.content).toBe('string');
    const content = p.content as string;
    expect(content).toContain('# Brand kit');
    expect(content).toContain('## Voice');
    expect(content).toContain('## Palette');
    expect(content).toContain('## Typography');
    expect(content).toContain('## Logo');
    expect(content).toContain('Confident, Calm');
    expect((opts as { onConflict?: string }).onConflict).toBe('spaceId,slug');
  });

  it('drops optional voice strings when blank', async () => {
    const body = fullBody();
    body.voice.loved = '';
    body.voice.banned = '';
    const res = await POST(makeReq(body) as never);
    expect(res.status).toBe(200);
    const content = (upsertSpy.mock.calls[0]![0] as { content: string }).content;
    expect(content).not.toContain('A sentence we love');
    expect(content).not.toContain('never write');
  });

  it('embeds the logo URL when one is provided', async () => {
    const body = fullBody() as ReturnType<typeof fullBody> & {
      logo: { prompt: string; url?: string };
    };
    body.logo.url = 'https://img/x.png';
    const res = await POST(makeReq(body) as never);
    expect(res.status).toBe(200);
    const content = (upsertSpy.mock.calls[0]![0] as { content: string }).content;
    expect(content).toContain('![Logo preview](https://img/x.png)');
  });
});
