/**
 * Thin LinkedIn v2 API adapter.
 *
 * LinkedIn requires a Member URN (urn:li:person:<id>) on every UGC post.
 * We resolve it on demand via /v2/me on each call — simpler than caching
 * on IntegrationConnection, and the call is cheap. Cache in-process later
 * if perf ever matters; not worth a schema column today.
 *
 * Auth: IntegrationConnection (toolkit='linkedin', status='active')
 * → LINKEDIN_ACCESS_TOKEN env. Throws when neither is set.
 */

import { supabase } from '@/lib/supabase';

const LI_API = 'https://api.linkedin.com/v2';

async function getLinkedInToken(spaceId: string): Promise<string> {
  const { data } = await supabase
    .from('IntegrationConnection')
    .select('accessToken')
    .eq('spaceId', spaceId)
    .eq('toolkit', 'linkedin')
    .eq('status', 'active')
    .maybeSingle();

  const token = (data as { accessToken?: string } | null)?.accessToken;
  if (token) return token;

  const env = process.env.LINKEDIN_ACCESS_TOKEN;
  if (env) return env;

  throw new Error(
    `LinkedIn: no access token found for space ${spaceId}. ` +
      `Connect LinkedIn in Settings → Integrations, or set LINKEDIN_ACCESS_TOKEN.`,
  );
}

function liHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Restli-Protocol-Version': '2.0.0',
  };
}

async function liFetch(
  token: string,
  path: string,
  options?: RequestInit,
): Promise<Response> {
  return fetch(`${LI_API}${path}`, {
    ...options,
    headers: { ...liHeaders(token), ...(options?.headers ?? {}) },
  });
}

async function readOrThrow(res: Response, action: string): Promise<unknown> {
  if (!res.ok) {
    let body: { message?: string } = {};
    try {
      body = (await res.json()) as { message?: string };
    } catch {
      // ignore
    }
    const msg = body.message ?? (await res.text().catch(() => ''));
    throw new Error(`LinkedIn ${action} failed: ${res.status} — ${msg}`);
  }
  return res.json();
}

async function getMemberUrn(token: string): Promise<string> {
  const res = await liFetch(token, '/me');
  const data = (await readOrThrow(res, 'getMe')) as { id?: string };
  if (!data.id) {
    throw new Error('LinkedIn getMe failed: response missing member id');
  }
  return `urn:li:person:${data.id}`;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface LinkedInPostResult {
  id: string;
  url: string;
}

export interface RecentLinkedInPost {
  id: string;
  text: string;
  createdAt: number;
}

// ── Operations ───────────────────────────────────────────────────────────────

export async function linkedinPost(
  spaceId: string,
  opts: { text: string; visibility?: string },
): Promise<LinkedInPostResult> {
  const token = await getLinkedInToken(spaceId);
  const visibility =
    opts.visibility?.toUpperCase() === 'CONNECTIONS' ? 'CONNECTIONS' : 'PUBLIC';
  const urn = await getMemberUrn(token);

  const body = {
    author: urn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: opts.text },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': visibility },
  };

  const res = await liFetch(token, '/ugcPosts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const data = (await readOrThrow(res, 'post')) as { id?: string };
  const id = data.id ?? res.headers.get('x-restli-id') ?? '';
  return { id, url: id ? `https://www.linkedin.com/feed/update/${id}/` : '' };
}

export async function linkedinGetRecentPosts(
  spaceId: string,
  opts?: { limit?: number },
): Promise<{ posts: RecentLinkedInPost[] }> {
  const token = await getLinkedInToken(spaceId);
  const limit = Math.min(Math.max(opts?.limit ?? 10, 1), 50);
  const urn = await getMemberUrn(token);

  const res = await liFetch(
    token,
    `/ugcPosts?q=authors&authors=List(${encodeURIComponent(urn)})&count=${limit}`,
  );
  const data = (await readOrThrow(res, 'getRecentPosts')) as {
    elements?: Array<Record<string, unknown>>;
  };

  const posts = (data.elements ?? []).map((p) => {
    const specific =
      (p.specificContent as { 'com.linkedin.ugc.ShareContent'?: { shareCommentary?: { text?: string } } } | undefined)?.[
        'com.linkedin.ugc.ShareContent'
      ] ?? {};
    const text = specific.shareCommentary?.text ?? '';
    const created = (p.created as { time?: number } | undefined)?.time ?? 0;
    return { id: (p.id as string) ?? '', text, createdAt: created };
  });

  return { posts };
}
