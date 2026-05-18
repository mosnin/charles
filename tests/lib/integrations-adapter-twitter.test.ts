/**
 * Twitter adapter tests — auth resolution, happy paths, error propagation.
 *
 * Mutating tweet operations get a real test here because the adapter is the
 * last layer below the agent's approval gate; if the body shape regresses
 * we want to catch it without booting the agent.
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
  twitterPostTweet,
  twitterGetRecentTweets,
  twitterGetAccountMetrics,
} from '@/lib/integrations/adapters/twitter';

const fetchMock = vi.fn<typeof fetch>();
global.fetch = fetchMock as unknown as typeof fetch;

function jsonRes(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
  });
}

const ORIG_KEY = process.env.TWITTER_BEARER_TOKEN;

beforeEach(() => {
  fetchMock.mockReset();
  maybeSingleMock.mockReset();
  maybeSingleMock.mockResolvedValue({ data: null, error: null });
  delete process.env.TWITTER_BEARER_TOKEN;
});

afterEach(() => {
  if (ORIG_KEY === undefined) delete process.env.TWITTER_BEARER_TOKEN;
  else process.env.TWITTER_BEARER_TOKEN = ORIG_KEY;
});

describe('Twitter adapter — auth resolution', () => {
  it('uses the IntegrationConnection accessToken when present', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { accessToken: 'twitter_db_token' },
      error: null,
    });
    fetchMock.mockResolvedValue(jsonRes({ data: { id: '123' } }));

    await twitterPostTweet('space_1', { text: 'hello' });

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer twitter_db_token');
  });

  it('falls back to TWITTER_BEARER_TOKEN env when no DB row', async () => {
    process.env.TWITTER_BEARER_TOKEN = 'twitter_env_token';
    fetchMock.mockResolvedValue(jsonRes({ data: { id: '123' } }));

    await twitterPostTweet('space_1', { text: 'hello' });

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer twitter_env_token');
  });

  it('throws when neither DB row nor env var is set', async () => {
    await expect(twitterPostTweet('s', { text: 'x' })).rejects.toThrow(/no access token/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Twitter adapter — happy paths', () => {
  beforeEach(() => {
    process.env.TWITTER_BEARER_TOKEN = 'tw_test';
  });

  it('postTweet returns id + url', async () => {
    fetchMock.mockResolvedValue(jsonRes({ data: { id: '1789' } }));
    const r = await twitterPostTweet('s', { text: 'hello world' });
    expect(r.id).toBe('1789');
    expect(r.url).toBe('https://x.com/i/web/status/1789');

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ text: 'hello world' });
  });

  it('postTweet wires reply target when replyToTweetId is passed', async () => {
    fetchMock.mockResolvedValue(jsonRes({ data: { id: '99' } }));
    await twitterPostTweet('s', { text: 'reply!', replyToTweetId: '42' });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.reply).toEqual({ in_reply_to_tweet_id: '42' });
  });

  it('getRecentTweets resolves user then lists tweets', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ data: { id: 'me_id', username: 'founder' } }))
      .mockResolvedValueOnce(
        jsonRes({
          data: [
            { id: 't1', text: 'first', created_at: '2026-01-01T00:00:00Z' },
            { id: 't2', text: 'second', created_at: '2026-01-02T00:00:00Z' },
          ],
        }),
      );

    const r = await twitterGetRecentTweets('s', { limit: 10 });
    expect(r.tweets).toHaveLength(2);
    expect(r.tweets[0]).toEqual({ id: 't1', text: 'first', createdAt: '2026-01-01T00:00:00Z' });
    expect(fetchMock.mock.calls[1]![0]).toContain('/users/me_id/tweets');
    expect(fetchMock.mock.calls[1]![0]).toContain('max_results=10');
  });

  it('getRecentTweets clamps limit to the API-allowed 5..100 range', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ data: { id: 'me_id', username: 'founder' } }))
      .mockResolvedValueOnce(jsonRes({ data: [] }));

    await twitterGetRecentTweets('s', { limit: 1 });
    expect(fetchMock.mock.calls[1]![0]).toContain('max_results=5');
  });

  it('getAccountMetrics maps public_metrics + handle', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({
        data: {
          id: 'u1',
          username: 'founder',
          public_metrics: {
            followers_count: 1200,
            following_count: 300,
            tweet_count: 42,
          },
        },
      }),
    );

    const m = await twitterGetAccountMetrics('s');
    expect(m).toEqual({ followers: 1200, following: 300, tweetCount: 42, handle: 'founder' });
  });
});

describe('Twitter adapter — error handling', () => {
  beforeEach(() => {
    process.env.TWITTER_BEARER_TOKEN = 'tw_test';
  });

  it('surfaces detail message from X error body', async () => {
    fetchMock.mockResolvedValue(jsonRes({ detail: 'Could not authenticate you' }, 401));
    await expect(twitterPostTweet('s', { text: 'x' })).rejects.toThrow(
      /401.*Could not authenticate you/,
    );
  });

  it('throws when /users/me does not return an id', async () => {
    fetchMock.mockResolvedValue(jsonRes({ data: {} }));
    await expect(twitterGetAccountMetrics('s')).rejects.toThrow(/missing user id/i);
  });

  it('non-2xx on tweet list propagates with action label', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ data: { id: 'me_id', username: 'founder' } }))
      .mockResolvedValueOnce(jsonRes({ title: 'rate limit' }, 429));

    await expect(twitterGetRecentTweets('s')).rejects.toThrow(/getRecentTweets failed: 429/);
  });
});
