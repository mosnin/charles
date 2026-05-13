/**
 * PostHog adapter tests — auth resolution, happy paths, error surfacing.
 *
 * The adapter exclusively uses POST /api/projects/:id/query/ with HogQL.
 * Tests mock fetch responses and assert against the request URL + body.
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
  posthogGetConfig,
  posthogEventCount,
  posthogTopEvents,
  posthogActiveUsers,
  posthogSignupsTrend,
  posthogFunnel,
} from '@/lib/integrations/adapters/posthog';

const fetchMock = vi.fn<typeof fetch>();
global.fetch = fetchMock as unknown as typeof fetch;

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ORIG_KEY = process.env.POSTHOG_API_KEY;
const ORIG_PROJECT = process.env.POSTHOG_PROJECT_ID;
const ORIG_HOST = process.env.POSTHOG_HOST;

beforeEach(() => {
  fetchMock.mockReset();
  maybeSingleMock.mockReset();
  maybeSingleMock.mockResolvedValue({ data: null, error: null });
  delete process.env.POSTHOG_API_KEY;
  delete process.env.POSTHOG_PROJECT_ID;
  delete process.env.POSTHOG_HOST;
});

afterEach(() => {
  if (ORIG_KEY === undefined) delete process.env.POSTHOG_API_KEY;
  else process.env.POSTHOG_API_KEY = ORIG_KEY;
  if (ORIG_PROJECT === undefined) delete process.env.POSTHOG_PROJECT_ID;
  else process.env.POSTHOG_PROJECT_ID = ORIG_PROJECT;
  if (ORIG_HOST === undefined) delete process.env.POSTHOG_HOST;
  else process.env.POSTHOG_HOST = ORIG_HOST;
});

describe('posthogGetConfig — auth resolution', () => {
  it('uses IntegrationConnection accessToken + accessKey + metadata.host when present', async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        accessToken: 'phx_db',
        accessKey: '42',
        metadata: { host: 'https://eu.posthog.com' },
      },
      error: null,
    });

    const cfg = await posthogGetConfig('space_1');
    expect(cfg).toEqual({
      host: 'https://eu.posthog.com',
      apiKey: 'phx_db',
      projectId: '42',
    });
  });

  it('falls back to env vars when no DB row', async () => {
    process.env.POSTHOG_API_KEY = 'phx_env';
    process.env.POSTHOG_PROJECT_ID = '99';
    const cfg = await posthogGetConfig('space_1');
    expect(cfg.apiKey).toBe('phx_env');
    expect(cfg.projectId).toBe('99');
    expect(cfg.host).toBe('https://us.posthog.com');
  });

  it('throws when neither DB nor env provides credentials', async () => {
    await expect(posthogGetConfig('space_1')).rejects.toThrow(/no API key or project id/i);
  });

  it('throws when only the project id is set', async () => {
    process.env.POSTHOG_PROJECT_ID = '7';
    await expect(posthogGetConfig('space_x')).rejects.toThrow(/no API key/i);
  });
});

describe('posthogEventCount', () => {
  beforeEach(() => {
    process.env.POSTHOG_API_KEY = 'k';
    process.env.POSTHOG_PROJECT_ID = '1';
  });

  it('returns the scalar count from the first row', async () => {
    fetchMock.mockResolvedValue(jsonRes({ results: [[123]] }));
    const n = await posthogEventCount('s', 'user signed up', 7);
    expect(n).toBe(123);

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toBe('https://us.posthog.com/api/projects/1/query/');
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.query.kind).toBe('HogQLQuery');
    expect(body.query.query).toContain("event = 'user signed up'");
    expect(body.query.query).toContain('INTERVAL 7 DAY');
  });

  it('clamps days above 365', async () => {
    fetchMock.mockResolvedValue(jsonRes({ results: [[0]] }));
    await posthogEventCount('s', 'x', 9999);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.query.query).toContain('INTERVAL 365 DAY');
  });

  it('surfaces 4xx as a thrown error', async () => {
    fetchMock.mockResolvedValue(jsonRes({ detail: 'bad key' }, 401));
    await expect(posthogEventCount('s', 'x', 30)).rejects.toThrow(/401.*bad key/);
  });
});

describe('posthogTopEvents', () => {
  beforeEach(() => {
    process.env.POSTHOG_API_KEY = 'k';
    process.env.POSTHOG_PROJECT_ID = '1';
  });

  it('returns event/count pairs ordered as the API returned them', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({
        results: [
          ['pageview', 500],
          ['user signed up', 12],
        ],
      }),
    );

    const out = await posthogTopEvents('s', { days: 30, limit: 5 });
    expect(out).toEqual([
      { event: 'pageview', count: 500 },
      { event: 'user signed up', count: 12 },
    ]);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.query.query).toContain('LIMIT 5');
    expect(body.query.query).toContain('GROUP BY event');
  });

  it('clamps limit above 50', async () => {
    fetchMock.mockResolvedValue(jsonRes({ results: [] }));
    await posthogTopEvents('s', { limit: 999 });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.query.query).toContain('LIMIT 50');
  });
});

describe('posthogActiveUsers', () => {
  beforeEach(() => {
    process.env.POSTHOG_API_KEY = 'k';
    process.env.POSTHOG_PROJECT_ID = '1';
  });

  it('returns the unique-user count', async () => {
    fetchMock.mockResolvedValue(jsonRes({ results: [[42]] }));
    const n = await posthogActiveUsers('s', 30);
    expect(n).toBe(42);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.query.query).toContain('count(DISTINCT distinct_id)');
  });

  it('returns 0 when results are empty', async () => {
    fetchMock.mockResolvedValue(jsonRes({ results: [] }));
    expect(await posthogActiveUsers('s')).toBe(0);
  });
});

describe('posthogSignupsTrend', () => {
  beforeEach(() => {
    process.env.POSTHOG_API_KEY = 'k';
    process.env.POSTHOG_PROJECT_ID = '1';
  });

  it('returns day/count points in API order', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({
        results: [
          ['2026-05-10', 3],
          ['2026-05-11', 5],
        ],
      }),
    );

    const out = await posthogSignupsTrend('s', 14);
    expect(out).toEqual([
      { day: '2026-05-10', count: 3 },
      { day: '2026-05-11', count: 5 },
    ]);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.query.query).toContain("event = 'user signed up'");
    expect(body.query.query).toContain('toDate(timestamp)');
  });
});

describe('posthogFunnel', () => {
  beforeEach(() => {
    process.env.POSTHOG_API_KEY = 'k';
    process.env.POSTHOG_PROJECT_ID = '1';
  });

  it('computes conversion from previous step', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ results: [[100]] }))
      .mockResolvedValueOnce(jsonRes({ results: [[40]] }))
      .mockResolvedValueOnce(jsonRes({ results: [[10]] }));

    const out = await posthogFunnel('s', ['pageview', 'signup_started', 'signup_finished'], 30);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      event: 'pageview',
      count: 100,
      conversionFromPrevious: 1,
    });
    expect(out[1]?.count).toBe(40);
    expect(out[1]?.conversionFromPrevious).toBeCloseTo(0.4);
    expect(out[2]?.conversionFromPrevious).toBeCloseTo(0.25);
  });

  it('returns [] for an empty step list', async () => {
    const out = await posthogFunnel('s', [], 30);
    expect(out).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a 4xx mid-funnel as a thrown error', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ results: [[10]] }))
      .mockResolvedValueOnce(jsonRes({ detail: 'rate' }, 429));

    await expect(posthogFunnel('s', ['a', 'b'], 30)).rejects.toThrow(/429/);
  });
});

describe('posthog adapter — auth header', () => {
  beforeEach(() => {
    process.env.POSTHOG_API_KEY = 'phx_env';
    process.env.POSTHOG_PROJECT_ID = '7';
  });

  it('sends Authorization: Bearer <key>', async () => {
    fetchMock.mockResolvedValue(jsonRes({ results: [[0]] }));
    await posthogEventCount('s', 'x', 1);
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer phx_env');
  });
});
