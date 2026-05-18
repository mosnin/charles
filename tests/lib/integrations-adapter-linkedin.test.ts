/**
 * LinkedIn adapter tests — auth resolution, URN-prefixed post body, error
 * propagation. The URN-on-every-call decision is exercised here so a regression
 * to caching/columns trips the test instead of production.
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
  linkedinPost,
  linkedinGetRecentPosts,
} from '@/lib/integrations/adapters/linkedin';

const fetchMock = vi.fn<typeof fetch>();
global.fetch = fetchMock as unknown as typeof fetch;

function jsonRes(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
  });
}

const ORIG_KEY = process.env.LINKEDIN_ACCESS_TOKEN;

beforeEach(() => {
  fetchMock.mockReset();
  maybeSingleMock.mockReset();
  maybeSingleMock.mockResolvedValue({ data: null, error: null });
  delete process.env.LINKEDIN_ACCESS_TOKEN;
});

afterEach(() => {
  if (ORIG_KEY === undefined) delete process.env.LINKEDIN_ACCESS_TOKEN;
  else process.env.LINKEDIN_ACCESS_TOKEN = ORIG_KEY;
});

describe('LinkedIn adapter — auth resolution', () => {
  it('uses the IntegrationConnection accessToken when present', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { accessToken: 'li_db_token' },
      error: null,
    });
    fetchMock
      .mockResolvedValueOnce(jsonRes({ id: 'abc123' }))
      .mockResolvedValueOnce(jsonRes({ id: 'urn:li:share:xyz' }));

    await linkedinPost('space_1', { text: 'hello' });

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer li_db_token');
  });

  it('falls back to LINKEDIN_ACCESS_TOKEN env when no DB row', async () => {
    process.env.LINKEDIN_ACCESS_TOKEN = 'li_env_token';
    fetchMock
      .mockResolvedValueOnce(jsonRes({ id: 'abc123' }))
      .mockResolvedValueOnce(jsonRes({ id: 'urn:li:share:xyz' }));

    await linkedinPost('space_1', { text: 'hello' });

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer li_env_token');
  });

  it('throws when neither DB row nor env var is set', async () => {
    await expect(linkedinPost('s', { text: 'x' })).rejects.toThrow(/no access token/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('LinkedIn adapter — happy paths', () => {
  beforeEach(() => {
    process.env.LINKEDIN_ACCESS_TOKEN = 'li_test';
  });

  it('post resolves member URN then submits ugcPost with PUBLIC visibility default', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ id: 'member_42' }))
      .mockResolvedValueOnce(jsonRes({ id: 'urn:li:share:99' }));

    const r = await linkedinPost('s', { text: 'shipped phase 4' });

    expect(r.id).toBe('urn:li:share:99');
    expect(r.url).toBe('https://www.linkedin.com/feed/update/urn:li:share:99/');

    const postInit = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(postInit.method).toBe('POST');
    const body = JSON.parse(postInit.body as string);
    expect(body.author).toBe('urn:li:person:member_42');
    expect(body.lifecycleState).toBe('PUBLISHED');
    expect(body.visibility['com.linkedin.ugc.MemberNetworkVisibility']).toBe('PUBLIC');
    expect(body.specificContent['com.linkedin.ugc.ShareContent'].shareCommentary.text).toBe(
      'shipped phase 4',
    );
  });

  it('post honors CONNECTIONS visibility and rejects unknown values', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ id: 'm1' }))
      .mockResolvedValueOnce(jsonRes({ id: 'urn:li:share:1' }));
    await linkedinPost('s', { text: 'hi', visibility: 'connections' });
    const body1 = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string);
    expect(body1.visibility['com.linkedin.ugc.MemberNetworkVisibility']).toBe('CONNECTIONS');

    fetchMock
      .mockResolvedValueOnce(jsonRes({ id: 'm1' }))
      .mockResolvedValueOnce(jsonRes({ id: 'urn:li:share:2' }));
    await linkedinPost('s', { text: 'hi', visibility: 'lol-not-a-thing' });
    const body2 = JSON.parse((fetchMock.mock.calls[3]![1] as RequestInit).body as string);
    expect(body2.visibility['com.linkedin.ugc.MemberNetworkVisibility']).toBe('PUBLIC');
  });

  it('post falls back to x-restli-id header when body omits id', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ id: 'm1' }))
      .mockResolvedValueOnce(jsonRes({}, 201, { 'x-restli-id': 'urn:li:share:from-header' }));

    const r = await linkedinPost('s', { text: 'header path' });
    expect(r.id).toBe('urn:li:share:from-header');
  });

  it('getRecentPosts queries authors=List(urn) and maps elements', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ id: 'm1' }))
      .mockResolvedValueOnce(
        jsonRes({
          elements: [
            {
              id: 'urn:li:share:1',
              created: { time: 1_700_000_000_000 },
              specificContent: {
                'com.linkedin.ugc.ShareContent': {
                  shareCommentary: { text: 'first' },
                },
              },
            },
            {
              id: 'urn:li:share:2',
              created: { time: 1_700_000_100_000 },
              specificContent: {
                'com.linkedin.ugc.ShareContent': {
                  shareCommentary: { text: 'second' },
                },
              },
            },
          ],
        }),
      );

    const r = await linkedinGetRecentPosts('s', { limit: 5 });
    expect(r.posts).toHaveLength(2);
    expect(r.posts[0]).toEqual({
      id: 'urn:li:share:1',
      text: 'first',
      createdAt: 1_700_000_000_000,
    });

    const listCall = fetchMock.mock.calls[1]![0] as string;
    expect(listCall).toContain('q=authors');
    expect(listCall).toContain(encodeURIComponent('urn:li:person:m1'));
    expect(listCall).toContain('count=5');
  });

  it('getRecentPosts clamps limit to 1..50', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ id: 'm1' }))
      .mockResolvedValueOnce(jsonRes({ elements: [] }));

    await linkedinGetRecentPosts('s', { limit: 9999 });
    expect(fetchMock.mock.calls[1]![0]).toContain('count=50');
  });
});

describe('LinkedIn adapter — error handling', () => {
  beforeEach(() => {
    process.env.LINKEDIN_ACCESS_TOKEN = 'li_test';
  });

  it('surfaces LinkedIn error message on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ message: 'Invalid token' }, 401));
    await expect(linkedinPost('s', { text: 'x' })).rejects.toThrow(/401.*Invalid token/);
  });

  it('throws when /v2/me lacks an id', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({}));
    await expect(linkedinPost('s', { text: 'x' })).rejects.toThrow(/missing member id/i);
  });
});
