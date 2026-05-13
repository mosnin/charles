/**
 * Thin Twitter (X) v2 API adapter.
 *
 * Auth: IntegrationConnection (toolkit='twitter', status='active').
 * accessToken → OAuth 2.0 user-context bearer. Env fallback for dev/CI:
 * TWITTER_BEARER_TOKEN. Throws when neither is set.
 *
 * Read + write endpoints both use the same bearer header. We do not run
 * an OAuth dance here — that's handled upstream by the connect flow.
 */

import { supabase } from '@/lib/supabase';

const X_API = 'https://api.twitter.com/2';

async function getTwitterToken(spaceId: string): Promise<string> {
  const { data } = await supabase
    .from('IntegrationConnection')
    .select('accessToken')
    .eq('spaceId', spaceId)
    .eq('toolkit', 'twitter')
    .eq('status', 'active')
    .maybeSingle();

  const token = (data as { accessToken?: string } | null)?.accessToken;
  if (token) return token;

  const env = process.env.TWITTER_BEARER_TOKEN;
  if (env) return env;

  throw new Error(
    `Twitter: no access token found for space ${spaceId}. ` +
      `Connect X in Settings → Integrations, or set TWITTER_BEARER_TOKEN.`,
  );
}

async function xFetch(
  token: string,
  path: string,
  options?: RequestInit,
): Promise<Response> {
  return fetch(`${X_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
}

async function readOrThrow(res: Response, action: string): Promise<unknown> {
  if (!res.ok) {
    let body: { detail?: string; title?: string } = {};
    try {
      body = (await res.json()) as { detail?: string; title?: string };
    } catch {
      // ignore
    }
    const msg = body.detail ?? body.title ?? (await res.text().catch(() => ''));
    throw new Error(`Twitter ${action} failed: ${res.status} — ${msg}`);
  }
  return res.json();
}

interface MeResponse {
  data?: {
    id: string;
    username: string;
    public_metrics?: {
      followers_count?: number;
      following_count?: number;
      tweet_count?: number;
    };
  };
}

async function getMe(token: string): Promise<MeResponse['data']> {
  const res = await xFetch(token, '/users/me?user.fields=public_metrics,username');
  const data = (await readOrThrow(res, 'getMe')) as MeResponse;
  if (!data.data?.id) {
    throw new Error('Twitter getMe failed: response missing user id');
  }
  return data.data;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface TweetResult {
  id: string;
  url: string;
}

export interface RecentTweet {
  id: string;
  text: string;
  createdAt: string;
}

export interface AccountMetrics {
  followers: number;
  following: number;
  tweetCount: number;
  handle: string;
}

// ── Operations ───────────────────────────────────────────────────────────────

export async function twitterPostTweet(
  spaceId: string,
  opts: { text: string; replyToTweetId?: string },
): Promise<TweetResult> {
  const token = await getTwitterToken(spaceId);
  const body: Record<string, unknown> = { text: opts.text };
  if (opts.replyToTweetId) {
    body.reply = { in_reply_to_tweet_id: opts.replyToTweetId };
  }

  const res = await xFetch(token, '/tweets', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const data = (await readOrThrow(res, 'postTweet')) as { data?: { id: string } };
  const id = data.data?.id ?? '';
  return { id, url: id ? `https://x.com/i/web/status/${id}` : '' };
}

export async function twitterGetRecentTweets(
  spaceId: string,
  opts?: { limit?: number },
): Promise<{ tweets: RecentTweet[] }> {
  const token = await getTwitterToken(spaceId);
  // X API requires 5..100 for max_results.
  const limit = Math.min(Math.max(opts?.limit ?? 10, 5), 100);

  const me = await getMe(token);
  const res = await xFetch(
    token,
    `/users/${me!.id}/tweets?max_results=${limit}&tweet.fields=created_at`,
  );
  const data = (await readOrThrow(res, 'getRecentTweets')) as {
    data?: Array<{ id: string; text: string; created_at?: string }>;
  };
  const tweets = (data.data ?? []).map((t) => ({
    id: t.id,
    text: t.text,
    createdAt: t.created_at ?? '',
  }));
  return { tweets };
}

export async function twitterGetAccountMetrics(
  spaceId: string,
): Promise<AccountMetrics> {
  const token = await getTwitterToken(spaceId);
  const me = await getMe(token);
  const m = me!.public_metrics ?? {};
  return {
    followers: m.followers_count ?? 0,
    following: m.following_count ?? 0,
    tweetCount: m.tweet_count ?? 0,
    handle: me!.username,
  };
}
